/**
 * Memory projections — extracted from extract.ts to keep the extractor module
 * under the 300-line budget. Deterministic: records in, drafts out. Nothing
 * here proposes a trust tier; sealing happens in commit.ts / store.ts.
 */
import { computeUnitId } from './schema.js'
import { scopeKeyForClass } from './scope.js'
import { sourceKeyFor } from './trust.js'
import type { MemoryScope } from './types.js'
import type { ExperienceRecord } from '../harness2/experience-record.js'
import { extractor, type MemoryProposal } from './extract.js'

export interface TrajectoryProjectionInput {
  engagementId: string
  targetClass: string
  outcome: string
  /** The run's failure mode; absent or "none" for a clean run. */
  failureMode?: string
  haltReason?: string
  steps?: number
  confirmedCount: number
  killedCount: number
  nowIso: string
}

/**
 * Project the run's outcome to at most one `trajectory-lesson` unit,
 * class-scoped by the caller's `deriveTargetClass` result. A pure
 * failure-mode record (failure mode + mechanical counts) is a direct
 * projection and rides the auto lane; an outcome lesson is an
 * interpretation and waits for an operator (§7.2). Claim and body carry
 * no host-specific values — the class scope binding (§4.2) forbids them;
 * the target class itself lives in the scope fields only.
 *
 * @param input - The run's outcome facts.
 * @returns Zero or one proposal.
 */
export function projectTrajectory(input: TrajectoryProjectionInput): MemoryProposal[] {
  const failed = !!input.failureMode && input.failureMode !== 'none'
  const claim = failed
    ? `Engagement ended ${input.outcome}: failure mode ${input.failureMode} (${input.confirmedCount} confirmed / ${input.killedCount} killed)`
    : `Engagement ended ${input.outcome} (${input.confirmedCount} confirmed / ${input.killedCount} killed)`
  const scope: MemoryScope = {
    kind: 'target-class',
    scopeKey: scopeKeyForClass(input.targetClass),
    hosts: [],
    targetClass: input.targetClass,
    stack: [],
    originEngagementIds: [input.engagementId],
  }
  return [
    {
      lane: failed ? 'auto' : 'proposed',
      projector: 'trajectory-projector',
      draft: {
        schemaVersion: 1,
        unitId: computeUnitId(scope.scopeKey, 'trajectory-lesson', claim, `trajectory:${input.engagementId}`),
        kind: 'trajectory-lesson',
        claim,
        body: [
          `Outcome: ${input.outcome}`,
          `Failure mode: ${input.failureMode ?? 'none'}`,
          ...(input.haltReason ? [`Halt reason: ${input.haltReason}`] : []),
          ...(input.steps !== undefined ? [`Steps: ${input.steps}`] : []),
          `Confirmed: ${input.confirmedCount} · Killed: ${input.killedCount}`,
        ].join('\n'),
        scope,
        targetClass: input.targetClass,
        provenance: {
          sourceClass: 'trajectory',
          sourceEngagementId: input.engagementId,
          sourceRefs: [{ kind: 'trajectory', uri: `${input.engagementId}/trajectory.json` }],
          derivedFromUnitIds: [],
          extractor: extractor('trajectory-projector', input),
          createdAt: input.nowIso,
          createdBy: 'runner',
        },
        proof: { state: 'unproven', receipts: [] },
        corroboration: { independentCount: 0, sourceKeys: [sourceKeyFor('trajectory', input.engagementId)] },
        contentClass: 'normal',
        tags: [],
        attackIds: [],
        stack: [],
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Experience projector — proposed lane
// ---------------------------------------------------------------------------

export interface ExperienceProjectionInput {
  /** Parsed EXPERIENCE.md records (the parser's skipped count rides the commit input, not the drafts). */
  records: readonly ExperienceRecord[]
  /** URI of the EXPERIENCE.md file the records came from. */
  fileUri: string
  nowIso: string
}

/**
 * Project adopted (status `active`) EXPERIENCE.md records that have no
 * unit yet to `experience-lesson` units, class-scoped by the record's
 * target class. Proposed lane: a lesson is an interpretation until a
 * named operator approves it (§7.2). Reverted/superseded records are not
 * projected in v1; the commit records each as a DELETE_NOT_SUPPORTED_V1
 * skip in the diff (v1 has no delete op — see commit.ts).
 *
 * @param input - The parsed records and their file URI.
 * @returns One proposed-lane proposal per active record.
 */
export function projectExperience(input: ExperienceProjectionInput): MemoryProposal[] {
  const proposals: MemoryProposal[] = []
  for (const record of input.records) {
    if (record.status.kind !== 'active') continue
    const claim = record.changed
    const scope: MemoryScope = {
      kind: 'target-class',
      scopeKey: scopeKeyForClass(record.targetClass),
      hosts: [],
      targetClass: record.targetClass,
      stack: [],
      originEngagementIds: [],
    }
    const refUri = `experience-record:${record.targetClass}/${record.date}/${record.layerId ?? 'general'}/${record.cycleId}`
    proposals.push({
      lane: 'proposed',
      projector: 'experience-projector',
      draft: {
        schemaVersion: 1,
        unitId: computeUnitId(scope.scopeKey, 'experience-lesson', claim, refUri),
        kind: 'experience-lesson',
        claim,
        body: [
          `Changed: ${record.changed}`,
          `Why: ${record.why}`,
          `Measured effect: ${record.measuredEffect}`,
          `Recorded: ${record.date} · Cycle: ${record.cycleId}`,
        ].join('\n'),
        scope,
        targetClass: record.targetClass,
        provenance: {
          sourceClass: 'experience',
          sourceRefs: [{ kind: 'experience-record', uri: input.fileUri }],
          derivedFromUnitIds: [],
          extractor: extractor('experience-projector', record),
          createdAt: input.nowIso,
          createdBy: 'runner',
        },
        proof: { state: 'unproven', receipts: [] },
        corroboration: { independentCount: 0, sourceKeys: [sourceKeyFor('experience', record.targetClass)] },
        contentClass: 'normal',
        tags: [],
        attackIds: [],
        stack: [],
      },
    })
  }
  return proposals
}

// ---------------------------------------------------------------------------
// Target-derived intake — proposed lane, untrusted by construction (§4.3)
// ---------------------------------------------------------------------------

