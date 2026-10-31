/**
 * Campaign lifecycle transitions (Q-CAMPAIGN, Agent A half).
 *
 * The state machine's operator-facing moves, on top of Agent B's
 * store: plan a wave, pause, resume, stop, complete. Every move is a
 * single store transaction that also appends the transition receipt —
 * a status change without its receipt is not a legal move in this
 * layer. Wave launch and outcome recording are the executor's job
 * (executor.ts, over the store's beginWave/recordWaveOutcome); the
 * operator decision that AUTHORIZES a launch is the gate's job
 * (gate.ts). This module never launches anything.
 *
 * Idempotence: repeating a move that is already in effect (pause a
 * paused campaign, resume a running one) returns the record unchanged
 * instead of erroring — an operator double-issuing a command is not a
 * corruption event. Moves that would lose state DO error: completing
 * a campaign with an unlaunched planned wave, or stopping one whose
 * wave is mid-flight, are refused with the reason named.
 */

import { applyCampaignTransition, loadCampaign, transactCampaign } from './store.js'
import type { CampaignRecord, CampaignStatus, WaveRollup } from './types.js'

export class CampaignLifecycleError extends Error {
  constructor(message: string) {
    super(`[campaign-lifecycle] ${message}`)
    this.name = 'CampaignLifecycleError'
  }
}

function fail(why: string): never {
  throw new CampaignLifecycleError(why)
}

/** Move the record's status through the store's single transition
 *  writer (applyCampaignTransition) — the audit spine's seq discipline
 *  lives there and nowhere else. */
function pushTransition(rec: CampaignRecord, to: CampaignStatus, reason: string, now?: Date, waveIndex?: number): void {
  applyCampaignTransition(rec, to, reason, { now, ...(waveIndex !== undefined ? { waveIndex } : {}) })
}

/**
 * Record a planned wave on the campaign and move it to "armed".
 * Idempotent for the same wave index (returns the record unchanged —
 * the existing plan stands; re-planning never silently replaces an
 * aim the operator may already have read). Throws when the campaign
 * cannot take a plan (paused/terminal/running), when the plan's wave
 * index is not the next wave, or when the wave cap is already spent.
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @param plan - The wave plan (index, aim) to record.
 * @param opts - The plan artifact reference and the clock.
 * @returns The updated record.
 */
export function planCampaignWave(
  campaignsDir: string,
  campaignId: string,
  plan: { waveIndex: number; aim: string },
  opts: { planRef?: string; now?: Date } = {},
): CampaignRecord {
  const now = opts.now ?? new Date()
  return transactCampaign(
    campaignsDir,
    campaignId,
    (rec) => {
      const existing = rec.waves.find(w => w.index === plan.waveIndex)
      if (existing) {
        if (existing.status === 'planned') return rec
        fail(`wave ${plan.waveIndex} already launched (status ${existing.status}) — plan the NEXT wave`)
      }
      if (rec.status !== 'draft' && rec.status !== 'awaiting-advance' && rec.status !== 'armed') {
        fail(`cannot plan a wave while the campaign is ${rec.status}`)
      }
      const launched = rec.waves.filter(w => w.launchedAt !== undefined).length
      if (plan.waveIndex !== launched + 1) {
        fail(`wave index ${plan.waveIndex} is not the next wave (next is ${launched + 1})`)
      }
      if (launched >= rec.caps.maxWaves) {
        fail(`wave cap reached (${rec.caps.maxWaves}) — the campaign cannot plan wave ${plan.waveIndex}`)
      }
      rec.waves.push({
        index: plan.waveIndex,
        status: 'planned',
        aim: plan.aim,
        ...(opts.planRef ? { planRef: opts.planRef } : {}),
      })
      if (rec.status !== 'armed') pushTransition(rec, 'armed', `wave ${plan.waveIndex} planned`, now, plan.waveIndex)
      return rec
    },
    now,
  )
}

/**
 * Pause the campaign: an operator hold. No wave launches while paused
 * (the executor refuses the status outright). A wave already running
 * is NOT paused by this — it settles its own outcome; pausing a
 * wave-running campaign is refused.
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @param opts - The clock.
 * @returns The updated record.
 */
export function pauseCampaign(campaignsDir: string, campaignId: string, opts: { now?: Date } = {}): CampaignRecord {
  const now = opts.now ?? new Date()
  return transactCampaign(
    campaignsDir,
    campaignId,
    (rec) => {
      if (rec.status === 'paused') return rec
      if (rec.status === 'wave-running') fail('a wave is running — it settles its own outcome; pause applies between waves')
      if (rec.status === 'complete' || rec.status === 'stopped') fail(`campaign is ${rec.status} — terminal`)
      pushTransition(rec, 'paused', 'operator pause', now)
      return rec
    },
    now,
  )
}

/**
 * Resume a paused campaign to the status its waves imply: "armed"
 * when a planned wave is waiting, "awaiting-advance" when waves have
 * launched and none is planned, "draft" when nothing has launched.
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @param opts - The clock.
 * @returns The updated record.
 */
export function resumeCampaign(campaignsDir: string, campaignId: string, opts: { now?: Date } = {}): CampaignRecord {
  const now = opts.now ?? new Date()
  return transactCampaign(
    campaignsDir,
    campaignId,
    (rec) => {
      if (rec.status !== 'paused') {
        if (rec.status === 'wave-running' || rec.status === 'complete' || rec.status === 'stopped') {
          fail(`campaign is ${rec.status} — nothing to resume`)
        }
        return rec
      }
      const hasPlanned = rec.waves.some(w => w.status === 'planned')
      const hasLaunched = rec.waves.some(w => w.launchedAt !== undefined)
      const to: CampaignStatus = hasPlanned ? 'armed' : hasLaunched ? 'awaiting-advance' : 'draft'
      pushTransition(rec, to, 'operator resume', now)
      return rec
    },
    now,
  )
}

/**
 * Stop the campaign (operator decision): terminal, append-only —
 * the record and its wave history stay on disk (Decision C-6).
 * Refused while a wave is running.
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @param opts - The clock.
 * @returns The updated record.
 */
export function stopCampaign(campaignsDir: string, campaignId: string, opts: { now?: Date } = {}): CampaignRecord {
  const now = opts.now ?? new Date()
  return transactCampaign(
    campaignsDir,
    campaignId,
    (rec) => {
      if (rec.status === 'stopped') return rec
      if (rec.status === 'wave-running') fail('a wave is running — it settles its own outcome before the campaign can stop')
      if (rec.status === 'complete') fail('campaign is already complete')
      pushTransition(rec, 'stopped', 'operator stop', now)
      return rec
    },
    now,
  )
}

/**
 * Complete the campaign early (operator decision): every wave the
 * operator intended has run, before the cap. Refused while a planned
 * wave is still unlaunched — completing over a standing plan would
 * silently discard it; launch it or stop the campaign instead.
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @param opts - The clock.
 * @returns The updated record.
 */
export function completeCampaign(campaignsDir: string, campaignId: string, opts: { now?: Date } = {}): CampaignRecord {
  const now = opts.now ?? new Date()
  return transactCampaign(
    campaignsDir,
    campaignId,
    (rec) => {
      if (rec.status === 'complete') return rec
      if (rec.status === 'wave-running') fail('a wave is running — it settles its own outcome')
      if (rec.status === 'stopped') fail('campaign is stopped — terminal')
      if (rec.waves.some(w => w.status === 'planned')) {
        fail('a planned wave is still unlaunched — launch it or stop the campaign; completing would discard the plan silently')
      }
      pushTransition(rec, 'complete', 'operator complete', now)
      return rec
    },
    now,
  )
}

/** The campaign-level rollup: every wave's outcome, aggregated. */
export interface CampaignRollup {
  wavesLaunched: number
  wavesComplete: number
  wavesHalted: number
  wavesFailed: number
  wavesInterrupted: number
  totalFindings: number
  confirmed: number
  killed: number
  deferred: number
  bySeverity: Record<string, number>
}

/**
 * Aggregate the campaign record's per-wave rollups into one campaign
 * rollup. Mechanical derivation from the recorded wave outcomes —
 * nothing here estimates or re-judges a finding.
 * @param rec - The campaign record.
 * @returns The aggregated rollup.
 */
export function computeCampaignRollup(rec: CampaignRecord): CampaignRollup {
  const out: CampaignRollup = {
    wavesLaunched: 0,
    wavesComplete: 0,
    wavesHalted: 0,
    wavesFailed: 0,
    wavesInterrupted: 0,
    totalFindings: 0,
    confirmed: 0,
    killed: 0,
    deferred: 0,
    bySeverity: {},
  }
  for (const w of rec.waves) {
    if (w.launchedAt === undefined) continue
    out.wavesLaunched += 1
    if (w.status === 'complete') out.wavesComplete += 1
    else if (w.status === 'halted') out.wavesHalted += 1
    else if (w.status === 'failed') out.wavesFailed += 1
    else if (w.status === 'interrupted') out.wavesInterrupted += 1
    if (!w.outcome) continue
    const r: WaveRollup = w.outcome.rollup
    out.totalFindings += r.totalFindings
    out.confirmed += r.confirmed
    out.killed += r.killed
    out.deferred += r.deferred
    for (const [sev, n] of Object.entries(r.bySeverity)) out.bySeverity[sev] = (out.bySeverity[sev] ?? 0) + n
  }
  return out
}

/**
 * Load a campaign record (re-exported convenience for A's callers).
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @returns The record.
 */
export function getCampaign(campaignsDir: string, campaignId: string): CampaignRecord {
  return loadCampaign(campaignsDir, campaignId)
}
