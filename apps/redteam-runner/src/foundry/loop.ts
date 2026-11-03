/**
 * The Gold Loop — in-app port (reference: loop.py + evolution.py +
 * scoring.py + challenge.py, over the app-data Foundry store).
 *
 * One cycle:
 *   1. control-validate every store case (structure + sanitizer), timing
 *      each run — the timing feeds fitness cost_efficiency;
 *   2. fitness-score the store's cases (fitness-v1.1-live port) and keep
 *      the table in loop-state.json;
 *   3. mutate the highest-fitness case seeds (operators-v1, case surface,
 *      mutate.ts) and register the survivors of the case control battery
 *      with their lineage to the seed;
 *   4. mutate the highest-fitness GOLD snapshot bundles and validate
 *      them through the foundry-gate runner (loop-bundle.ts).
 *
 * FAILURE ISOLATION: a cycle never throws. Every step records its outcome
 * in the cycle summary; a loop failure cannot affect scans (the capture
 * hook enqueues cycles fire-and-forget through enqueueLoopCycle).
 */

import { spawnSync } from 'node:child_process'
import { locateFoundry, type FoundryLocation } from './locate.js'
import { scoreStoreCases } from './fitness.js'
import { applyCaseOperator, OPERATORS, validateCaseMutant } from './mutate.js'
import { runBundleEvolution } from './loop-bundle.js'

/**
 * Pick a Python interpreter that actually runs.
 *
 * The default used to be a bare 'python3'. On Windows that name resolves to the
 * Microsoft Store alias, which EXISTS but exits non-zero — so the foundry
 * syntax gate failed on every Windows host and every generated mutant was
 * silently discarded as "syntax gate failed". An environment default that
 * cannot execute must never be mistaken for a defect in generated code.
 */
function resolvePython(configured?: string): string {
  if (configured !== undefined && configured.trim() !== '') return configured
  const fromEnv = process.env['FOUNDRY_PYTHON']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'import sys'], { windowsHide: true, timeout: 5_000 })
    if (probe.error === undefined && probe.status === 0) return candidate
  }
  return candidates[0] as string
}

import {
  loadLoopState,
  saveLoopState,
  type CaseMutantOutcome,
  type LoopCycleSummary,
} from './loop-state.js'
import { sanitizePattern } from './sanitize.js'
import {
  caseContentHash,
  caseIdFor,
  listCases,
  registerCase,
  type CasePattern,
  type FoundryCase,
} from './store.js'

export { loadLoopState, saveLoopState } from './loop-state.js'
export type { BundleMutantOutcome, CaseMutantOutcome, LoopCycleSummary, LoopState } from './loop-state.js'

function casePatternOf(foundryCase: FoundryCase): CasePattern {
  return {
    family: foundryCase.family,
    vulnClass: foundryCase.vulnClass,
    cwe: foundryCase.cwe,
    severity: foundryCase.severity,
    endpointShape: foundryCase.endpointShape,
    methodMix: foundryCase.methodMix,
    payloadClass: foundryCase.payloadClass,
    proofType: foundryCase.proofType,
    techFingerprints: foundryCase.techFingerprints,
  }
}

/** Structural + sanitizer control for one case; returns seconds taken. */
function controlValidateCase(foundryCase: FoundryCase): { pass: boolean; seconds: number } {
  const started = Date.now()
  const structureOk =
    foundryCase.id.length > 0 && foundryCase.family.length > 0 && foundryCase.payloadClass.length > 0
  const sanitized = sanitizePattern(casePatternOf(foundryCase))
  return { pass: structureOk && sanitized.ok, seconds: (Date.now() - started) / 1000 }
}

/**
 * Run one Gold Loop cycle over the store. Never throws.
 *
 * @param storeDir - the foundry store directory
 * @param opts - location override, python command, and clock (tests)
 * @returns the cycle summary (also persisted in loop-state.json)
 */
export async function runLoopCycle(
  storeDir: string,
  opts: { location?: FoundryLocation; python?: string; now?: () => Date } = {},
): Promise<LoopCycleSummary> {
  const now = opts.now ?? (() => new Date())
  const state = loadLoopState(storeDir)
  const cycle = state.cyclesRun + 1
  const summary: LoopCycleSummary = {
    cycle,
    at: now().toISOString(),
    casesScored: 0,
    mutantsGenerated: 0,
    survivorsRegistered: 0,
    caseMutants: [],
    bundleMutants: [],
    notes: [],
    error: null,
  }
  try {
    const cases = listCases(storeDir)

    // 1 + 2: control-validate (timed) and fitness-score the store's cases.
    const validationSeconds = new Map<string, number>()
    for (const foundryCase of cases) {
      const control = controlValidateCase(foundryCase)
      validationSeconds.set(foundryCase.id, Math.max(control.seconds, 0.001))
      if (!control.pass) summary.notes.push(`control: case ${foundryCase.id} failed its control revalidation`)
    }
    const fitness = scoreStoreCases(cases, validationSeconds)
    summary.casesScored = cases.length
    for (const [id, record] of fitness) {
      state.fitness[id] = { ...record, at: summary.at }
    }

    // 3: case mutants from the highest-fitness seeds.
    const ranked = [...cases].sort((a, b) => {
      const fa = fitness.get(a.id)?.fitness ?? -1
      const fb = fitness.get(b.id)?.fitness ?? -1
      return fb - fa
    })
    ranked.slice(0, 2).forEach((seed, index) => {
      const operator = OPERATORS[(cycle - 1 + index) % OPERATORS.length]
      if (operator === undefined) return
      const outcome = applyCaseOperator(seed, operator, cycle)
      if (!outcome.ok) {
        summary.caseMutants.push({ seedId: seed.id, operator, ok: false, detail: outcome.error, caseId: null })
        return
      }
      summary.mutantsGenerated++
      const pattern = outcome.value
      const contentHash = caseContentHash(pattern)
      const mutant: FoundryCase = {
        id: caseIdFor(`loop:${seed.id}:${operator}:${cycle}`, contentHash),
        kind: 'live-case',
        origin: 'loop-mutant',
        family: pattern.family as FoundryCase['family'],
        vulnClass: pattern.vulnClass,
        cwe: pattern.cwe,
        severity: pattern.severity,
        endpointShape: pattern.endpointShape,
        methodMix: pattern.methodMix,
        payloadClass: pattern.payloadClass,
        proofType: pattern.proofType,
        mechanisms: ['loop-mutation'],
        techFingerprints: pattern.techFingerprints,
        tier: 'BRONZE',
        sourceEngagementId: seed.sourceEngagementId,
        lineage: { seedCaseId: seed.id, operator, cycle },
        createdAt: summary.at,
        contentHash,
      }
      const rederive = (): FoundryCase | null => {
        const again = applyCaseOperator(seed, operator, cycle)
        if (!again.ok) return null
        return { ...mutant, contentHash: caseContentHash(again.value) }
      }
      const validation = validateCaseMutant(mutant, cases, rederive)
      if (!validation.pass) {
        summary.caseMutants.push({
          seedId: seed.id, operator, ok: false,
          detail: `controls failed: ${validation.notes.join('; ')}`, caseId: null,
        })
        return
      }
      const added = registerCase(storeDir, mutant)
      if (added) summary.survivorsRegistered++
      summary.caseMutants.push({
        seedId: seed.id, operator, ok: true,
        detail: added ? `registered (${validation.notes.join('; ') || 'controls clean'})` : 'already registered (idempotent)',
        caseId: mutant.id,
      })
    })

    // 4: bundle mutants from the highest-fitness GOLD snapshot seeds.
    const location = opts.location ?? locateFoundry()
    if (!location.snapshotDir || !location.gateCliPath) {
      summary.notes.push(
        `bundle evolution skipped: ${!location.snapshotDir ? 'no snapshot located' : 'gate CLI not located'}`,
      )
    } else {
      const python = resolvePython(opts.python)
      const bundle = await runBundleEvolution(storeDir, location, cycle, summary.at, python)
      summary.bundleMutants = bundle.outcomes
      summary.mutantsGenerated += bundle.generated
      summary.survivorsRegistered += bundle.survivors
    }
  } catch (err) {
    summary.error = (err as Error).message
  }
  state.cyclesRun = cycle
  state.lastCycle = summary
  try {
    saveLoopState(storeDir, state)
  } catch {
    /* state persistence is best-effort; the summary still returns */
  }
  return summary
}

let inFlight: Promise<LoopCycleSummary> | null = null

/**
 * Enqueue a loop cycle (single-flight). Used by the capture hook: a cycle
 * already running absorbs the enqueue. Never rejects.
 *
 * @param storeDir - the foundry store directory
 * @returns the running cycle's summary promise
 */
export function enqueueLoopCycle(storeDir: string): Promise<LoopCycleSummary> {
  if (!inFlight) {
    inFlight = runLoopCycle(storeDir)
      .catch((err: unknown) => ({
        cycle: 0, at: new Date().toISOString(), casesScored: 0, mutantsGenerated: 0,
        survivorsRegistered: 0, caseMutants: [] as CaseMutantOutcome[], bundleMutants: [],
        notes: [], error: (err as Error).message,
      }))
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

/**
 * Resolve when no enqueued cycle is running (tests and operator tooling).
 *
 * @returns nothing
 */
export async function whenLoopIdle(): Promise<void> {
  if (inFlight) {
    try {
      await inFlight
    } catch {
      /* the cycle summary already carries the error */
    }
  }
}
