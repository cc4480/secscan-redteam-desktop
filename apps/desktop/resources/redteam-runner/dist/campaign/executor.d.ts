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
import { runEngagement } from '../phases/run.js';
import type { RunOptions } from '../phases/run-options.js';
import type { EngagementInput, EngagementResult } from '../types.js';
import { type WaveBrief } from './brief.js';
import { type LaunchEvaluation } from './gate.js';
import { type WavePlan, type WavePlannerCompletion } from './planner.js';
import type { CampaignRecord, WaveRecord } from './types.js';
export declare class CampaignExecutorError extends Error {
    constructor(message: string);
}
/** Per-launch engagement tuning. Scope is NOT here on purpose (C-3). */
export interface CampaignEngagementOptions {
    /** Engagement mode override; default is the kind's default mode. */
    mode?: EngagementInput['mode'];
    /** Engagement tier (the engine's own tier rules still apply). */
    tier?: EngagementInput['tier'];
    /** Full-battery posture override; default is the kind's default. */
    fullBattery?: boolean;
    /** Named operator accountability string for the engagement record. */
    operatorName?: string;
    /** Engagement environment label. */
    environment?: EngagementInput['environment'];
    /** Production confirmation flag, forwarded to the engine's own gate. */
    confirmProduction?: boolean;
    /** Tier-2 production confirmation flag, forwarded to the engine. */
    confirmTier2Production?: boolean;
    /** Client label for the engagement record. */
    client?: string;
}
/** Options for launchCampaignWave. */
export interface LaunchCampaignWaveOptions {
    campaignsDir: string;
    campaignId: string;
    /** Wave to launch; default is the next unlaunched wave. */
    waveIndex?: number;
    /** Per-launch engagement tuning (never scope). */
    engagement?: CampaignEngagementOptions;
    /** The engagement runner; default is the real runEngagement (tests inject a fake). */
    runFn?: typeof runEngagement;
    /** Runner options forwarded to runFn (engagementId is always set by the executor). */
    runOpts?: RunOptions;
    /** The planner's coordinator completion (only used if the wave is unplanned). */
    completion?: WavePlannerCompletion;
    /** History digest for the planner/brief (the recall seam; optional). */
    historyDigest?: string;
    /** Clock override (tests). */
    now?: Date;
}
/** What a launch produced: the settled record, the wave, and the receipts. */
export interface LaunchCampaignWaveResult {
    campaign: CampaignRecord;
    wave: WaveRecord;
    plan: WavePlan;
    brief: WaveBrief;
    gate: LaunchEvaluation;
    engagement: EngagementResult;
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
export declare function planNextCampaignWave(campaignsDir: string, campaignId: string, opts?: {
    completion?: WavePlannerCompletion;
    historyDigest?: string;
    now?: Date;
}): Promise<{
    campaign: CampaignRecord;
    plan: WavePlan;
}>;
/**
 * Launch one wave of a campaign as one engagement, through the gate.
 * Throws CampaignGateError when no recorded operator decision
 * authorizes the wave (the C-1 default), CampaignExecutorError for
 * state the launch cannot start from, and re-throws engagement-call
 * failures after settling the wave as failed.
 * @param opts - The launch options.
 * @returns The settled campaign, wave, plan, brief, gate evaluation, and engagement result.
 */
export declare function launchCampaignWave(opts: LaunchCampaignWaveOptions): Promise<LaunchCampaignWaveResult>;
