/**
 * Wave executor (Q-CAMPAIGN, scoping N6): the wave-to-engagement binding.
 *
 * One wave = exactly one run of the EXISTING engagement machinery
 * (D-1): this module consumes `runEngagement` as-is — it does not
 * modify the engine — and binds it to the campaign record:
 *
 *   load → (plan + arm if needed) → GATE → brief → beginWave →
 *   runEngagement → recordWaveOutcome
 *
 * The gate step is the C-1 lock made executable: `assertLaunchAllowed`
 * runs before EVERY launch, so a wave can never start without a
 * recorded operator decision behind it (a "start", an "advance" for
 * that wave, or an auto-advance authorization that still resolves).
 * The executor additionally refuses the statuses a launch makes no
 * sense from — a paused campaign is an operator hold, and no decision
 * on file overrides a hold except lifting it (resume).
 *
 * The wave's brief travels as the engagement's objective text: the
 * campaign objective, this wave's aim, and the accumulated-state
 * context block from brief.ts. The target and ROE scope come from the
 * campaign record's verified scope ONLY (C-3) — launch options can
 * tune mode/tier/battery, never the scope.
 *
 * Failure discipline (the watch-cycle precedent): an engagement that
 * returns settles through the store's own outcome mapping; anything
 * that fails AFTER the wave is marked launched — the engagement call
 * throwing, or the harvest refusing a non-terminal result — is
 * settled as a failed wave on the record first, and only then
 * re-thrown. A crashed launch never leaves a wave silently "running".
 */

import { join } from 'node:path'

import { runEngagement } from '../phases/run.js'
import type { RunOptions } from '../phases/run-options.js'
import type { EngagementInput, EngagementResult } from '../types.js'
import { buildWaveBrief, type WaveBrief } from './brief.js'
import { assertLaunchAllowed, nextWaveIndex, type LaunchEvaluation } from './gate.js'
import { getCampaignKind } from './kinds.js'
import { planCampaignWave } from './lifecycle.js'
import {
  loadWavePlan,
  planNextWave,
  writeWavePlan,
  type WavePlan,
  type WavePlannerCompletion,
} from './planner.js'
import { beginWave, loadCampaign, recordWaveOutcome, settleFailedWave } from './store.js'
import type { CampaignRecord, WaveRecord } from './types.js'

export class CampaignExecutorError extends Error {
  constructor(message: string) {
    super(`[campaign-executor] ${message}`)
    this.name = 'CampaignExecutorError'
  }
}

/** Per-launch engagement tuning. Scope is NOT here on purpose (C-3). */
export interface CampaignEngagementOptions {
  /** Engagement mode override; default is the kind's default mode. */
  mode?: EngagementInput['mode']
  /** Engagement tier (the engine's own tier rules still apply). */
  tier?: EngagementInput['tier']
  /** Full-battery posture override; default is the kind's default. */
  fullBattery?: boolean
  /** Named operator accountability string for the engagement record. */
  operatorName?: string
  /** Engagement environment label. */
  environment?: EngagementInput['environment']
  /** Production confirmation flag, forwarded to the engine's own gate. */
  confirmProduction?: boolean
  /** Tier-2 production confirmation flag, forwarded to the engine. */
  confirmTier2Production?: boolean
  /** Client label for the engagement record. */
  client?: string
}

/** Options for launchCampaignWave. */
export interface LaunchCampaignWaveOptions {
  campaignsDir: string
  campaignId: string
  /** Wave to launch; default is the next unlaunched wave. */
  waveIndex?: number
  /** Per-launch engagement tuning (never scope). */
  engagement?: CampaignEngagementOptions
  /** The engagement runner; default is the real runEngagement (tests inject a fake). */
  runFn?: typeof runEngagement
  /** Runner options forwarded to runFn (engagementId is always set by the executor). */
  runOpts?: RunOptions
  /** The planner's coordinator completion (only used if the wave is unplanned). */
  completion?: WavePlannerCompletion
  /** History digest for the planner/brief (the recall seam; optional). */
  historyDigest?: string
  /** Clock override (tests). */
  now?: Date
}

/** What a launch produced: the settled record, the wave, and the receipts. */
export interface LaunchCampaignWaveResult {
  campaign: CampaignRecord
  wave: WaveRecord
  plan: WavePlan
  brief: WaveBrief
  gate: LaunchEvaluation
  engagement: EngagementResult
}

function priorFocusVectors(campaignDir: string, beforeWave: number): string[] {
  const out: string[] = []
  for (let i = 1; i < beforeWave; i++) {
    const p = loadWavePlan(campaignDir, i)
    if (p) out.push(...p.focusVectors)
  }
  return out
}

function assertLaunchableStatus(rec: CampaignRecord): void {
  if (rec.status === 'paused') {
    throw new CampaignExecutorError('campaign is paused — an operator hold; resume it before launching a wave')
  }
  if (rec.status === 'wave-running') {
    throw new CampaignExecutorError('a wave is already running on this campaign')
  }
  if (rec.status === 'complete' || rec.status === 'stopped') {
    throw new CampaignExecutorError(`campaign is ${rec.status} — terminal`)
  }
}

/**
 * Plan the next wave and arm the campaign (no launch, no gate — the
 * gate binds at launch time). Idempotent: an already-planned wave
 * returns its standing plan.
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @param opts - The planner completion, history digest, and clock.
 * @returns The updated record and the wave plan.
 */
export async function planNextCampaignWave(
  campaignsDir: string,
  campaignId: string,
  opts: { completion?: WavePlannerCompletion; historyDigest?: string; now?: Date } = {},
): Promise<{ campaign: CampaignRecord; plan: WavePlan }> {
  const rec = loadCampaign(campaignsDir, campaignId)
  assertLaunchableStatus(rec)
  const kind = getCampaignKind(rec.kind)
  const waveIndex = nextWaveIndex(rec)
  const campaignDir = join(campaignsDir, campaignId)
  const existing = rec.waves.find(w => w.index === waveIndex)
  let plan = loadWavePlan(campaignDir, waveIndex)
  if (!plan) {
    plan = await planNextWave(rec, kind, waveIndex, {
      completion: opts.completion,
      historyDigest: opts.historyDigest,
      priorFocusVectors: priorFocusVectors(campaignDir, waveIndex),
      now: opts.now,
    })
    const planRef = writeWavePlan(campaignDir, plan)
    const armed = planCampaignWave(campaignsDir, campaignId, plan, { planRef, now: opts.now })
    return { campaign: armed, plan }
  }
  if (!existing) {
    const armed = planCampaignWave(campaignsDir, campaignId, plan, {
      planRef: `wave-${waveIndex}/plan.json`,
      now: opts.now,
    })
    return { campaign: armed, plan }
  }
  return { campaign: rec, plan }
}

function settleFailedWaveQuietly(
  campaignsDir: string,
  campaignId: string,
  waveIndex: number,
  message: string,
  now?: Date,
): void {
  try {
    // The store's settle path: wave -> "failed" with the error as its
    // outcome; the launch error itself is what propagates to the caller.
    settleFailedWave(campaignsDir, campaignId, waveIndex, message, now)
  } catch {
    // Best-effort on top of the original failure — never mask it.
  }
}

/**
 * Launch one wave of a campaign as one engagement, through the gate.
 * Throws CampaignGateError when no recorded operator decision
 * authorizes the wave (the C-1 default), CampaignExecutorError for
 * state the launch cannot start from, and re-throws engagement-call
 * failures after settling the wave as failed.
 * @param opts - The launch options.
 * @returns The settled campaign, wave, plan, brief, gate evaluation, and engagement result.
 */
export async function launchCampaignWave(opts: LaunchCampaignWaveOptions): Promise<LaunchCampaignWaveResult> {
  const { campaignsDir, campaignId } = opts
  let rec = loadCampaign(campaignsDir, campaignId)
  assertLaunchableStatus(rec)
  const kind = getCampaignKind(rec.kind)
  const waveIndex = opts.waveIndex ?? nextWaveIndex(rec)
  if (opts.waveIndex !== undefined && opts.waveIndex !== nextWaveIndex(rec)) {
    throw new CampaignExecutorError(
      `wave ${opts.waveIndex} is not the next wave (next is ${nextWaveIndex(rec)}) — waves launch in order`,
    )
  }

  // Plan + arm first when the wave has no standing plan.
  const standing = rec.waves.find(w => w.index === waveIndex)
  if (!standing || standing.status === 'planned') {
    const campaignDir = join(campaignsDir, campaignId)
    if (!loadWavePlan(campaignDir, waveIndex)) {
      const planned = await planNextCampaignWave(campaignsDir, campaignId, {
        completion: opts.completion,
        historyDigest: opts.historyDigest,
        now: opts.now,
      })
      rec = planned.campaign
    }
  }
  rec = loadCampaign(campaignsDir, campaignId)
  const campaignDir = join(campaignsDir, campaignId)
  const plan = loadWavePlan(campaignDir, waveIndex)
  if (!plan) throw new CampaignExecutorError(`wave ${waveIndex} has no plan artifact — planning failed to persist`)

  // THE GATE (C-1): no recorded operator decision, no launch.
  // assertLaunchAllowed returns the evaluation on success and throws
  // CampaignGateError with the refusal reason when it is not.
  const gate = assertLaunchAllowed(rec, waveIndex)

  const brief = buildWaveBrief(rec, kind, plan, {
    historyDigest: opts.historyDigest,
    priorFocusVectors: priorFocusVectors(campaignDir, waveIndex),
  })

  const eng = opts.engagement ?? {}
  const input: EngagementInput = {
    target: rec.scope.hosts[0] as string,
    mode: eng.mode ?? kind.defaults.mode,
    objective: `${brief.objective}\n\n${brief.context}`,
    roe: { scope: [...rec.scope.hosts] },
    ...(eng.tier !== undefined ? { tier: eng.tier } : {}),
    fullBattery: eng.fullBattery ?? kind.defaults.fullBattery,
    ...(eng.operatorName ? { operatorName: eng.operatorName } : {}),
    ...(eng.environment ? { environment: eng.environment } : {}),
    ...(eng.confirmProduction !== undefined ? { confirmProduction: eng.confirmProduction } : {}),
    ...(eng.confirmTier2Production !== undefined ? { confirmTier2Production: eng.confirmTier2Production } : {}),
    ...(eng.client ? { client: eng.client } : {}),
  }
  const engagementId = `${rec.id}-wave-${waveIndex}`
  const standingWave = rec.waves.find(w => w.index === waveIndex)
  beginWave(
    campaignsDir,
    campaignId,
    waveIndex,
    {
      engagementId,
      aim: plan.aim,
      ...(standingWave?.planRef ? { planRef: standingWave.planRef } : {}),
    },
    opts.now,
  )
  let result: EngagementResult
  let wave: WaveRecord
  try {
    result = await (opts.runFn ?? runEngagement)(input, { ...(opts.runOpts ?? {}), engagementId })
    wave = recordWaveOutcome(campaignsDir, campaignId, waveIndex, result, opts.now)
  } catch (err) {
    // One settle span for everything after beginWave (pair cross-check
    // X-8): a harvest failure — e.g. a non-terminal engagement status
    // the store rightly refuses — must strand the wave exactly like a
    // thrown run does, never leave it "running" with the campaign
    // stuck in "wave-running". beginWave itself stays outside the
    // span: its failure means THIS launch never began, and settling
    // then could settle a different launch's wave.
    settleFailedWaveQuietly(campaignsDir, campaignId, waveIndex, err instanceof Error ? err.message : String(err), opts.now)
    throw err
  }
  const settled = loadCampaign(campaignsDir, campaignId)
  return { campaign: settled, wave, plan, brief, gate, engagement: result }
}
