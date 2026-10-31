/**
 * Scan-integrated Foundry capture: completed engagement → live cases.
 *
 * Called from the trajectory capture point (harness2/trajectory.ts), which
 * runEngagement's finally block reaches for every outcome. For each
 * confirmed finding, a candidate case is projected to pattern fields only,
 * sanitized fail-closed, tiered, and registered in the app-data store.
 *
 * Tier rule (project rule): BRONZE by default — a single source. SILVER
 * only when two independent mechanisms agree: the dual-exploiter cell's
 * PROVEN adjudication plus at least one independent signal (the finding's
 * separate confirmation in engagement state, or a second live finding in
 * the same family recorded under a different attack id). GOLD is never
 * assigned here; it is editor-adjudicated elsewhere.
 *
 * FAILURE ISOLATION: this module never throws. Any error is returned in
 * the result (and noted by the caller) — capture can never fail, block,
 * or delay the engagement it observes.
 */

import type { Finding } from '../types.js'
import type { LiveFinding } from '../context.js'
import { classifyFinding } from './classify.js'
import { endpointShapesFromText, payloadClassOf, sanitizePattern } from './sanitize.js'
import {
  appendSanitizerNote,
  caseContentHash,
  caseIdFor,
  registerCase,
  type CasePattern,
  type FoundryCase,
  type FoundryTier,
} from './store.js'
import { enqueueLoopCycle } from './loop.js'

/** The inputs capture reads from a finished engagement. */
export interface CaptureInput {
  engagementId: string
  target: string
  stateFindings: readonly Finding[]
  liveFindings: readonly LiveFinding[]
  /** Stack fingerprints from the engagement fingerprint (pattern-level). */
  techFingerprints: readonly string[]
  storeDir: string
  /** Clock override for tests. */
  now?: () => Date
  /** Disable the automatic Gold Loop enqueue (tests, operator tooling). */
  autoLoop?: boolean
}

/** What capture did, in counts the caller can log. */
export interface CaptureResult {
  added: number
  skippedDuplicates: number
  dropped: number
  dropReasons: string[]
  error: string | null
  caseIds: string[]
}

interface Candidate {
  pattern: CasePattern
  tier: FoundryTier
  mechanisms: string[]
  proofType: string
}

/** Build the candidate cases for one engagement (pure; no I/O). */
export function buildCandidates(input: CaptureInput): { candidates: Candidate[]; drops: Array<{ reasons: string[] }> } {
  const candidates: Candidate[] = []
  const drops: Array<{ reasons: string[] }> = []
  const stateByTitle = new Map<string, Finding>()
  for (const f of input.stateFindings) stateByTitle.set(f.title, f)

  const seenContent = new Set<string>()
  const consider = (candidate: Candidate): void => {
    const sanitized = sanitizePattern(candidate.pattern, { target: input.target })
    if (!sanitized.ok) {
      drops.push({ reasons: sanitized.reasons })
      return
    }
    const hash = caseContentHash(sanitized.pattern)
    if (seenContent.has(hash)) return
    seenContent.add(hash)
    candidates.push({ ...candidate, pattern: sanitized.pattern })
  }

  const liveFamilyCount = new Map<string, Set<string>>()
  for (const lf of input.liveFindings) {
    const { family } = classifyFinding({ vulnClass: lf.vulnClass, title: lf.title })
    const set = liveFamilyCount.get(family) ?? new Set<string>()
    set.add(lf.attackId)
    liveFamilyCount.set(family, set)
  }

  for (const lf of input.liveFindings) {
    const classification = classifyFinding({ vulnClass: lf.vulnClass, title: lf.title })
    const mechanisms: string[] = ['live-detection']
    let proofType = 'detected'
    if (lf.cellState === 'proven') {
      mechanisms.push('dual-exploiter-cell')
      proofType = 'cell-proven'
    }
    const stateTwin = stateByTitle.get(lf.title)
    if (stateTwin && stateTwin.status === 'confirmed') {
      mechanisms.push('state-confirmation')
      if (proofType === 'detected') proofType = 'state-confirmed'
    }
    const familyAttackIds = liveFamilyCount.get(classification.family)
    if (familyAttackIds && familyAttackIds.size > 1) mechanisms.push('second-finding-same-family')
    const tier: FoundryTier =
      mechanisms.includes('dual-exploiter-cell')
      && (mechanisms.includes('state-confirmation') || mechanisms.includes('second-finding-same-family'))
        ? 'SILVER'
        : 'BRONZE'
    consider({
      pattern: {
        family: classification.family,
        vulnClass: lf.vulnClass ?? classification.family,
        cwe: classification.cwe,
        severity: lf.severity,
        endpointShape: endpointShapesFromText(`${lf.evidence}\n${lf.payload ?? ''}`),
        methodMix: [],
        payloadClass: payloadClassOf(lf.payload),
        proofType,
        techFingerprints: [...input.techFingerprints],
      },
      tier,
      mechanisms,
      proofType,
    })
  }

  // Confirmed state findings with no live twin: single-source by definition.
  const liveTitles = new Set(input.liveFindings.map(f => f.title))
  for (const f of input.stateFindings) {
    if (f.status !== 'confirmed' || liveTitles.has(f.title)) continue
    const classification = classifyFinding({ title: f.title })
    consider({
      pattern: {
        family: classification.family,
        vulnClass: classification.family,
        cwe: classification.cwe,
        severity: f.severity,
        endpointShape: endpointShapesFromText(f.evidence),
        methodMix: [],
        payloadClass: 'none',
        proofType: 'state-confirmed',
        techFingerprints: [...input.techFingerprints],
      },
      tier: 'BRONZE',
      mechanisms: ['state-confirmation'],
      proofType: 'state-confirmed',
    })
  }

  return { candidates, drops }
}

/**
 * Capture an engagement's findings into the Foundry store. Never throws.
 *
 * @param input - the finished engagement's findings and store location
 * @returns counts of what was added, skipped, and dropped, plus any error
 */
export function captureFoundryCases(input: CaptureInput): CaptureResult {
  const result: CaptureResult = { added: 0, skippedDuplicates: 0, dropped: 0, dropReasons: [], error: null, caseIds: [] }
  try {
    const now = input.now ?? (() => new Date())
    const { candidates, drops } = buildCandidates(input)
    for (const drop of drops) {
      result.dropped++
      result.dropReasons.push(...drop.reasons)
      try {
        appendSanitizerNote(input.storeDir, { engagementId: input.engagementId, reasons: drop.reasons, at: now().toISOString() })
      } catch {
        /* the note is best-effort; the drop already happened */
      }
    }
    for (const candidate of candidates) {
      const contentHash = caseContentHash(candidate.pattern)
      const foundryCase: FoundryCase = {
        id: caseIdFor(input.engagementId, contentHash),
        kind: 'live-case',
        origin: 'scan',
        family: candidate.pattern.family as FoundryCase['family'],
        vulnClass: candidate.pattern.vulnClass,
        cwe: candidate.pattern.cwe,
        severity: candidate.pattern.severity,
        endpointShape: candidate.pattern.endpointShape,
        methodMix: candidate.pattern.methodMix,
        payloadClass: candidate.pattern.payloadClass,
        proofType: candidate.proofType,
        mechanisms: candidate.mechanisms,
        techFingerprints: candidate.pattern.techFingerprints,
        tier: candidate.tier,
        sourceEngagementId: input.engagementId,
        lineage: null,
        createdAt: now().toISOString(),
        contentHash,
      }
      if (registerCase(input.storeDir, foundryCase)) {
        result.added++
        result.caseIds.push(foundryCase.id)
      } else {
        result.skippedDuplicates++
      }
    }
    if (result.added > 0 && input.autoLoop !== false) {
      // Fire-and-forget: the loop is failure-isolated inside its own module
      // and single-flight; a loop problem can never reach the engagement.
      void enqueueLoopCycle(input.storeDir).catch(() => undefined)
    }
  } catch (err) {
    result.error = (err as Error).message
  }
  return result
}
