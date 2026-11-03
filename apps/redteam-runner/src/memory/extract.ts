/**
 * Deterministic proposal extractors (brief §7.2). Free-form model text
 * is never an extractor: a model's words reach memory only as records
 * the runner already adjudicated (registry verdicts, cell outcomes) or
 * as `target-derived-claim` intake. Every projector emits DRAFTS —
 * validation, trust derivation, and sealing happen in commit.ts /
 * store.ts, and an extractor never proposes a tier.
 */

import { computeUnitId, hashRecord } from './schema.js'
import { normalizeHost, scopeKeyForHosts } from './scope.js'
import type { UnitDraft } from './store.js'
import { sourceKeyFor } from './trust.js'
import type { MemoryScope } from './types.js'
import type { LiveFinding } from '../context.js'
import type { RegistryEntry } from '../registry.js'

export { projectExperience, projectTrajectory } from './extract-projections.js'
export type { ExperienceProjectionInput, TrajectoryProjectionInput } from './extract-projections.js'
/** One extractor output: a draft unit plus the lane it belongs in. */
export interface MemoryProposal {
  /** "auto" = mechanical projection of a proof-bearing record; "proposed" = awaits a named operator (§7.3). */
  lane: 'auto' | 'proposed'
  /** The producing projector's name (the diff's per-projector skip accounting, §8 row 12). */
  projector: string
  draft: UnitDraft
}

export const EXTRACTOR_VERSIONS: Record<string, string> = {
  'registry-projector': '1',
  'trajectory-projector': '1',
  'experience-projector': '1',
  'target-derived-intake': '1',
}

export function extractor(name: string, input: unknown): { name: string; version: string; inputHash: string } {
  return { name, version: EXTRACTOR_VERSIONS[name] ?? '1', inputHash: hashRecord(input) }
}

function engagementScopeForHost(scope: MemoryScope, host: string, stack: string[], appType?: string): MemoryScope {
  const hosts = [normalizeHost(host)]
  return {
    kind: 'engagement-target',
    scopeKey: scopeKeyForHosts(hosts),
    hosts,
    stack: stack.map(s => s.toLowerCase()),
    ...(appType ? { appType } : {}),
    originEngagementIds: [...scope.originEngagementIds],
  }
}

// ---------------------------------------------------------------------------
// Registry projector — mechanical projection lane (auto-apply)
// ---------------------------------------------------------------------------

export interface RegistryProjectionInput {
  engagementId: string
  /** The engagement's derived scope (its originEngagementIds seed each unit's). */
  scope: MemoryScope
  /** This engagement's registry entries only (caller filters by engagementId). */
  entries: readonly RegistryEntry[]
  /** Live findings from the same run, for the adjudicated cellState copy. */
  liveFindings?: readonly LiveFinding[]
  nowIso: string
}

/**
 * Project every registry entry of the engagement to a `finding` /
 * `killed-hypothesis` unit. Content is a direct, field-for-field
 * projection of a proof-bearing record — no semantic transformation —
 * so these ride the auto-apply lane (§7.2). `cellState` is copied from
 * the matching live finding's adjudication, never asserted here.
 *
 * @param input - The engagement's entries and scope.
 * @returns One auto-lane proposal per entry.
 */
export function projectRegistryEntries(input: RegistryProjectionInput): MemoryProposal[] {
  const proposals: MemoryProposal[] = []
  for (const entry of input.entries) {
    const scope = engagementScopeForHost(input.scope, entry.target.host, entry.target.stack, entry.target.appType)
    const base = {
      schemaVersion: 1 as const,
      scope,
      provenance: {
        sourceClass: 'registry' as const,
        sourceEngagementId: input.engagementId,
        sourceRefs: [
          { kind: 'registry-entry' as const, uri: 'engagements/registry.json', registryEntryId: entry.id },
        ],
        derivedFromUnitIds: [] as string[],
        extractor: extractor('registry-projector', entry),
        createdAt: input.nowIso,
        createdBy: 'runner',
      },
      corroboration: { independentCount: 0, sourceKeys: [sourceKeyFor('registry', input.engagementId)] },
      contentClass: 'normal' as const,
      attackIds: entry.attackId ? [entry.attackId.toUpperCase()] : [],
      stack: entry.target.stack.map(s => s.toLowerCase()),
    }
    if (entry.kind === 'confirmed') {
      const live = (input.liveFindings ?? []).find(
        f => f.vulnClass === entry.vulnClass && f.attackId === entry.attackId,
      )
      const proven = live?.cellState === 'proven'
      const auditRef = `${input.engagementId}/events.jsonl`
      const claim = `${entry.vulnClass} confirmed on ${entry.target.host} — ${entry.technique}`
      proposals.push({
        lane: 'auto',
        projector: 'registry-projector',
        draft: {
          ...base,
          unitId: computeUnitId(scope.scopeKey, 'finding', claim, `registry-entry:${entry.id}`),
          kind: 'finding',
          claim,
          body: [
            `Technique: ${entry.technique}`,
            `Payload pattern: ${entry.payloadPattern}`,
            `Evidence: ${entry.evidenceRef}`,
            `Severity: ${entry.severity}`,
            ...(entry.owasp ? [`OWASP: ${entry.owasp}`] : []),
            `Recorded: ${entry.date}`,
          ].join('\n'),
          proof: proven
            ? {
              state: 'proven',
              receipts: [
                { kind: 'evidence' as const, ref: entry.evidenceRef },
                { kind: 'negative-control' as const, ref: auditRef },
              ],
              registryEntryId: entry.id,
              cellState: 'proven',
              negativeControlReceiptRef: auditRef,
            }
            : {
              state: 'confirmed',
              receipts: [{ kind: 'registry-entry' as const, ref: entry.evidenceRef }],
              registryEntryId: entry.id,
              ...(live?.cellState ? { cellState: live.cellState } : {}),
            },
          tags: [entry.vulnClass],
          vulnClass: entry.vulnClass,
        },
      })
    } else {
      const claim = entry.hypothesis
      proposals.push({
        lane: 'auto',
        projector: 'registry-projector',
        draft: {
          ...base,
          unitId: computeUnitId(scope.scopeKey, 'killed-hypothesis', claim, `registry-entry:${entry.id}`),
          kind: 'killed-hypothesis',
          claim,
          body: [`Killing observation: ${entry.killingObservation}`, `Recorded: ${entry.date}`].join('\n'),
          proof: {
            state: 'killed',
            receipts: [{ kind: 'registry-entry' as const, ref: entry.id }],
            registryEntryId: entry.id,
          },
          tags: entry.vulnClass ? [entry.vulnClass] : [],
          ...(entry.vulnClass ? { vulnClass: entry.vulnClass } : {}),
        },
      })
    }
  }
  return proposals
}

// ---------------------------------------------------------------------------
// Trajectory projector — one lesson per engagement
// ---------------------------------------------------------------------------

export interface TargetDerivedClaimInput {
  /** What the target asserted (page text, response string, banner, doc). */
  text: string
  /** The in-scope host the content came from. */
  host: string
  /** Where the content was captured (engagement-relative ref). */
  sourceUri: string
  engagementId: string
  nowIso: string
}

/**
 * Intake one target-asserted claim. The ONLY shape target content may
 * enter memory in: `target-derived-claim`, engagement-target scope,
 * `target-derived-untrusted` content class, unproven — it keeps the
 * §4.3 hard cap until independent corroboration exists. The claim is
 * the normalized text capped at the §4.1 budget; the body carries the
 * fuller capture.
 *
 * @param input - The captured claim and its origin.
 * @returns One proposed-lane, untrusted proposal.
 */
export function intakeTargetDerivedClaim(input: TargetDerivedClaimInput): MemoryProposal {
  const normalized = input.text.trim().replace(/\s+/g, ' ')
  const hosts = [normalizeHost(input.host)]
  const scope: MemoryScope = {
    kind: 'engagement-target',
    scopeKey: scopeKeyForHosts(hosts),
    hosts,
    stack: [],
    originEngagementIds: [input.engagementId],
  }
  const claim = normalized.slice(0, 2000)
  return {
    lane: 'proposed',
    projector: 'target-derived-intake',
    draft: {
      schemaVersion: 1,
      unitId: computeUnitId(scope.scopeKey, 'target-derived-claim', claim, input.sourceUri),
      kind: 'target-derived-claim',
      claim,
      body: normalized.slice(0, 20000),
      scope,
      provenance: {
        sourceClass: 'target-content',
        sourceEngagementId: input.engagementId,
        sourceRefs: [{ kind: 'target-response', uri: input.sourceUri }],
        derivedFromUnitIds: [],
        extractor: extractor('target-derived-intake', { uri: input.sourceUri, text: normalized }),
        createdAt: input.nowIso,
        createdBy: 'runner',
      },
      proof: { state: 'unproven', receipts: [] },
      corroboration: {
        independentCount: 0,
        sourceKeys: [sourceKeyFor('target-content', input.engagementId)],
      },
      contentClass: 'target-derived-untrusted',
      tags: [],
      attackIds: [],
      stack: [],
    },
  }
}
