/**
 * Campaign wave gate (Q-CAMPAIGN — the operator surface for Decision C-1).
 *
 * The donor's defining safety property: a wave runs only on an operator's
 * explicit advance — one wave per invocation, the human decides whether
 * the next wave exists. This module makes that property mechanical for
 * our campaign layer:
 *
 *  - Every launch authorization traces to a RECORDED operator decision
 *    in the campaign record (who / what / when) — a "start" decision for
 *    wave 1, an "advance" decision naming wave N for later waves.
 *  - Auto-advance exists only as a recorded authorization: an operator
 *    records "enable-auto-advance" with a wave cap, and launches are
 *    allowed under it only while the enabling decision resolves in the
 *    record. The DEFAULT is OFF — a fresh campaign is operator-gated,
 *    and an enabled flag whose enabling decision cannot be resolved
 *    authorizes nothing (fail-closed).
 *  - Campaign caps bind in every path: no decision and no auto-advance
 *    authorization can launch a wave past caps.maxWaves.
 *
 * The executor consults assertLaunchAllowed before EVERY wave launch.
 * There is deliberately no other way to authorize a launch, and no
 * agent-facing path records decisions: recordOperatorDecision is an
 * operator act, exactly like the accountability module's tier changes.
 *
 * An interrupted wave (resume-repair) is closed history: it counts as
 * launched. The campaign continues at the NEXT wave index under fresh
 * authorization — an interrupted wave is never silently re-run under
 * the same index, because its engagement may have partially executed.
 */

import type { CampaignRecord, OperatorDecision, OperatorDecisionKind } from './types.js'
import { loadCampaign, transactCampaign } from './store.js'

export class CampaignGateError extends Error {
  constructor(message: string) {
    super(`[campaign-gate] ${message}`)
    this.name = 'CampaignGateError'
  }
}

export type LaunchVia = 'operator-decision' | 'auto-advance'

export interface LaunchEvaluation {
  allowed: boolean
  /** How the launch is authorized, when allowed. */
  via?: LaunchVia
  /** Seq of the authorizing decision in the campaign record. */
  decisionSeq?: number
  /** Human-readable basis for the verdict — recorded by callers. */
  reason: string
}

/** The next wave index that may launch: one past the highest launched
 *  (non-"planned") wave, or 1 when nothing has launched yet. */
export function nextWaveIndex(rec: CampaignRecord): number {
  let launched = 0
  for (const w of rec.waves) {
    if (w.status !== 'planned' && w.index > launched) launched = w.index
  }
  return launched + 1
}

function refused(reason: string): LaunchEvaluation {
  return { allowed: false, reason }
}

/**
 * Pure launch evaluation for wave `waveIndex` (1-based) against a
 * campaign record. Total and deterministic: every path returns a
 * verdict with its basis, so callers can record WHY a launch was
 * refused instead of just that it was.
 */
export function evaluateLaunch(rec: CampaignRecord, waveIndex: number): LaunchEvaluation {
  if (!Number.isInteger(waveIndex) || waveIndex < 1) {
    return refused(`wave index must be a positive integer, got ${JSON.stringify(waveIndex)}`)
  }
  if (rec.status === 'complete' || rec.status === 'stopped') {
    return refused(`campaign ${rec.id} is ${rec.status} — no wave can launch`)
  }
  if (waveIndex > rec.caps.maxWaves) {
    return refused(
      `wave ${waveIndex} exceeds the campaign cap of ${rec.caps.maxWaves} wave(s) — caps bind in every launch path`,
    )
  }
  const existing = rec.waves.find(w => w.index === waveIndex)
  if (existing && existing.status !== 'planned') {
    return refused(`wave ${waveIndex} was already launched (status ${existing.status})`)
  }
  const expected = nextWaveIndex(rec)
  if (waveIndex !== expected) {
    return refused(
      `wave ${waveIndex} is out of sequence — waves launch in order; the next launchable wave is ${expected}`,
    )
  }

  // Path 1: a recorded operator decision authorizing this exact wave.
  const decision = rec.decisions.find(
    d =>
      (waveIndex === 1 && d.kind === 'start') ||
      (waveIndex > 1 && d.kind === 'advance' && d.waveIndex === waveIndex),
  )
  if (decision) {
    return {
      allowed: true,
      via: 'operator-decision',
      decisionSeq: decision.seq,
      reason:
        `authorized by recorded ${decision.kind} decision #${decision.seq} ` +
        `(${decision.operator}, ${decision.ts})`,
    }
  }

  // Path 2: recorded auto-advance authorization covering this wave.
  const aa = rec.autoAdvance
  if (aa.enabled) {
    const enabler =
      aa.decisionSeq !== undefined
        ? rec.decisions.find(d => d.seq === aa.decisionSeq && d.kind === 'enable-auto-advance')
        : undefined
    if (!enabler) {
      return refused(
        'auto-advance is flagged enabled but its enabling decision does not resolve in the record — treated as unauthorized (fail-closed)',
      )
    }
    if (aa.maxWave !== undefined && waveIndex <= aa.maxWave) {
      return {
        allowed: true,
        via: 'auto-advance',
        decisionSeq: aa.decisionSeq,
        reason:
          `covered by recorded auto-advance authorization #${aa.decisionSeq} ` +
          `(cap wave ${aa.maxWave}, recorded by ${enabler.operator}, ${enabler.ts})`,
      }
    }
    return refused(
      `recorded auto-advance authorization caps at wave ${aa.maxWave} — wave ${waveIndex} needs its own recorded operator decision`,
    )
  }

  // Default posture (C-1): operator-gated, no authorization on record.
  return refused(
    `operator-gated: no recorded operator decision authorizes wave ${waveIndex} and auto-advance is off (C-1 default)`,
  )
}

/** The executor's pre-launch check. Returns the evaluation when the
 *  launch is authorized; throws CampaignGateError with the refusal
 *  reason when it is not. */
export function assertLaunchAllowed(rec: CampaignRecord, waveIndex: number): LaunchEvaluation {
  const evaluation = evaluateLaunch(rec, waveIndex)
  if (!evaluation.allowed) throw new CampaignGateError(evaluation.reason)
  return evaluation
}

export interface RecordDecisionInput {
  operator: string
  kind: OperatorDecisionKind
  waveIndex?: number
  maxWave?: number
  note?: string
}

function requireOperator(input: RecordDecisionInput): string {
  const operator = typeof input.operator === 'string' ? input.operator.trim() : ''
  if (!operator) {
    throw new CampaignGateError(
      'an operator decision must name the human operator recording it — anonymous decisions authorize nothing',
    )
  }
  return operator
}

function validateDecisionInput(rec: CampaignRecord, input: RecordDecisionInput): void {
  if (rec.status === 'complete' || rec.status === 'stopped') {
    throw new CampaignGateError(
      `campaign ${rec.id} is ${rec.status} — no further operator decisions can be recorded`,
    )
  }
  switch (input.kind) {
    case 'start':
      if (input.waveIndex !== undefined && input.waveIndex !== 1) {
        throw new CampaignGateError(`a start decision authorizes wave 1, got waveIndex ${input.waveIndex}`)
      }
      if (input.maxWave !== undefined) {
        throw new CampaignGateError('a start decision does not carry a maxWave (that belongs to enable-auto-advance)')
      }
      break
    case 'advance':
      if (!Number.isInteger(input.waveIndex) || (input.waveIndex as number) < 2) {
        throw new CampaignGateError(
          `an advance decision must name the wave it authorizes (waveIndex >= 2), got ${JSON.stringify(input.waveIndex)}`,
        )
      }
      if (input.maxWave !== undefined) {
        throw new CampaignGateError('an advance decision does not carry a maxWave (that belongs to enable-auto-advance)')
      }
      break
    case 'enable-auto-advance': {
      if (!Number.isInteger(input.maxWave) || (input.maxWave as number) < 1) {
        throw new CampaignGateError(
          `an enable-auto-advance decision must record its wave cap (maxWave >= 1), got ${JSON.stringify(input.maxWave)}`,
        )
      }
      if ((input.maxWave as number) > rec.caps.maxWaves) {
        throw new CampaignGateError(
          `auto-advance cap wave ${input.maxWave} exceeds the campaign cap of ${rec.caps.maxWaves} wave(s)`,
        )
      }
      if ((input.maxWave as number) < nextWaveIndex(rec)) {
        throw new CampaignGateError(
          `auto-advance cap wave ${input.maxWave} is already behind the next launchable wave ${nextWaveIndex(rec)} — the authorization would cover nothing`,
        )
      }
      if (rec.autoAdvance.enabled) {
        throw new CampaignGateError(
          'auto-advance is already enabled — record disable-auto-advance first so the record shows one authorization at a time',
        )
      }
      if (input.waveIndex !== undefined) {
        throw new CampaignGateError('an enable-auto-advance decision does not carry a waveIndex (it carries maxWave)')
      }
      break
    }
    case 'disable-auto-advance':
      if (!rec.autoAdvance.enabled) {
        throw new CampaignGateError('auto-advance is not enabled — there is nothing to disable')
      }
      if (input.waveIndex !== undefined || input.maxWave !== undefined) {
        throw new CampaignGateError('a disable-auto-advance decision carries neither waveIndex nor maxWave')
      }
      break
    default:
      if (input.waveIndex !== undefined || input.maxWave !== undefined) {
        throw new CampaignGateError(`a ${input.kind} decision carries neither waveIndex nor maxWave`)
      }
  }
}

/**
 * Record an operator decision in the campaign record — the ONLY way a
 * decision comes to exist. Validates the named operator and the
 * kind-specific fields, appends the decision with the next sequence,
 * and applies the auto-advance side effects in the same transaction,
 * so the flag and its authorizing decision can never drift apart.
 */
export function recordOperatorDecision(
  campaignsDir: string,
  campaignId: string,
  input: RecordDecisionInput,
  now: Date = new Date(),
): OperatorDecision {
  const operator = requireOperator(input)
  // Fail fast on a missing/corrupt record before entering the transact.
  loadCampaign(campaignsDir, campaignId)
  return transactCampaign(
    campaignsDir,
    campaignId,
    (rec) => {
      validateDecisionInput(rec, input)
      const decision: OperatorDecision = {
        seq: rec.decisions.length,
        ts: now.toISOString(),
        operator,
        kind: input.kind,
        ...(input.kind === 'advance' ? { waveIndex: input.waveIndex } : {}),
        ...(input.kind === 'enable-auto-advance' ? { maxWave: input.maxWave } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      }
      rec.decisions.push(decision)
      if (input.kind === 'enable-auto-advance') {
        rec.autoAdvance = {
          enabled: true,
          maxWave: input.maxWave as number,
          enabledBy: operator,
          enabledAt: decision.ts,
          decisionSeq: decision.seq,
        }
      } else if (input.kind === 'disable-auto-advance') {
        // The decisions[] history keeps the full enable/disable trail;
        // the live state simply returns to the gated default.
        rec.autoAdvance = { enabled: false }
      }
      return decision
    },
    now,
  )
}
