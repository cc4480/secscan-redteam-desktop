/**
 * Campaign store (Q-CAMPAIGN, scoping N2).
 *
 * Directory-per-campaign (scoping D-2): `<campaignsDir>/<id>/campaign.json`
 * holds the one versioned record; wave plan artifacts may live alongside
 * it in `wave-<n>/` subdirectories (the planner's territory). The record
 * is the single source of truth for campaign state.
 *
 * Discipline, following the registry store's precedent:
 *  - Synchronous transact: load → mutate → validate → atomic save, so
 *    within one process two writers can never silently lose each other.
 *  - Atomic file replacement (tmp + rename): a crash mid-save leaves the
 *    prior record byte-identical, never a torn half-record.
 *  - No delete, no silent overwrite: creating over an existing campaign
 *    is an error, and a corrupt record fails loud at load (schema.ts).
 *  - Every status change is written through a transition entry — the
 *    record's audit spine cannot be skipped by a caller.
 *
 * Restart honesty (resumeCampaigns): a wave still marked "running" when
 * a new process loads the store was stranded by the old process's death.
 * It is marked "interrupted" — with when and why — and the campaign
 * returns to "awaiting-advance" for an operator decision. An interrupted
 * wave is NEVER silently counted complete, and its engagementId (what
 * was actually launched) stays on the record.
 */
import type { CampaignRecord, CampaignStatus, WaveRecord, WaveRollup, WaveSeverity } from './types.js';
export declare class CampaignStoreError extends Error {
    constructor(message: string);
}
export declare const CAMPAIGN_FILE_NAME = "campaign.json";
/** Mirror of config.ts resolution: opts → REDTEAM_CAMPAIGNS_DIR →
 *  REDTEAM_HOME/engagements/campaigns → cwd/engagements/campaigns.
 *  Campaigns sit beside the registry under the engagements home (D-6). */
export declare function resolveCampaignsDir(opts?: {
    campaignsDir?: string;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
}): string;
export declare function campaignDir(campaignsDir: string, campaignId: string): string;
export declare function campaignFile(campaignsDir: string, campaignId: string): string;
/** Validate then persist a record (normalized form is what lands). */
export declare function saveCampaignFile(path: string, rec: CampaignRecord): void;
/** Load + validate one campaign record file. Throws CampaignSchemaError
 *  on a missing, unparsable, or invalid record — fail loud, never a
 *  quietly-invented empty campaign. */
export declare function loadCampaignFile(path: string): CampaignRecord;
export declare function loadCampaign(campaignsDir: string, campaignId: string): CampaignRecord;
/** Ids of all campaigns with a record file under campaignsDir, sorted.
 *  A missing campaigns directory is an empty store, not an error. */
export declare function listCampaignIds(campaignsDir: string): string[];
export interface CreateCampaignInput {
    id: string;
    name: string;
    kind: string;
    objective: string;
    scope: {
        hosts: string[];
        verificationRef: string;
        roeRef?: string;
    };
    caps: {
        maxWaves: number;
        maxBudget?: number;
    };
    createdBy: string;
}
/**
 * Create a new campaign in "draft" with auto-advance OFF (C-1 default)
 * and the creation transition recorded. Throws if a campaign with this
 * id already exists — creation never overwrites an existing record.
 */
export declare function createCampaign(campaignsDir: string, input: CreateCampaignInput, now?: Date): CampaignRecord;
/**
 * Atomic read-modify-write transaction on one campaign record
 * (registry transact precedent). The mutator runs against the freshly
 * loaded record; the result is validated and saved atomically, with
 * updatedAt refreshed. If the mutator throws, nothing is written.
 */
export declare function transactCampaign<T>(campaignsDir: string, campaignId: string, fn: (rec: CampaignRecord) => T, now?: Date): T;
/** Append a transition entry and move the status. This is the SINGLE
 *  transition writer for campaign records: seq always equals the
 *  entry's index in transitions[] (creation is seq 0), so the audit
 *  spine stays gapless and duplicate-free no matter which module
 *  records the move. Callers outside the store (lifecycle, executor)
 *  must use this — never push transition entries by hand. */
export declare function applyCampaignTransition(rec: CampaignRecord, to: CampaignStatus, reason: string, opts?: {
    waveIndex?: number;
    now?: Date;
}): void;
/** Record a lifecycle status change (the executor/lifecycle's path for
 *  transitions not owned by beginWave/recordWaveOutcome — arm, pause,
 *  resume, stop, complete). */
export declare function recordTransition(campaignsDir: string, campaignId: string, to: CampaignStatus, reason: string, opts?: {
    waveIndex?: number;
    now?: Date;
}): CampaignRecord;
export interface BeginWaveInput {
    engagementId: string;
    aim?: string;
    planRef?: string;
}
/**
 * Mark a wave launched: the wave becomes "running" with its engagement
 * id and launch time; the campaign moves to "wave-running". The gate
 * (gate.ts assertLaunchAllowed) is consulted by the caller BEFORE this —
 * beginWave enforces launch bookkeeping, not authorization. Throws if
 * the wave was already launched (any non-"planned" state).
 */
export declare function beginWave(campaignsDir: string, campaignId: string, waveIndex: number, input: BeginWaveInput, now?: Date): WaveRecord;
/** The structural subset of EngagementResult the harvest consumes — the
 *  real EngagementResult satisfies it; tests may pass canned results. */
export interface EngagementResultLike {
    status: string;
    blockedReason?: string;
    reportPath?: string;
    findings: Array<{
        status: 'confirmed' | 'killed' | 'deferred';
        severity: WaveSeverity;
    }>;
}
/** Mechanical rollup over a finished engagement's findings. */
export declare function computeRollup(findings: EngagementResultLike['findings']): WaveRollup;
/**
 * Harvest a finished engagement into its wave record: outcome + rollup
 * land, the wave takes the mapped terminal status, and the campaign
 * moves to "complete" when the wave cap is reached, else
 * "awaiting-advance". Throws on a non-terminal engagement status — an
 * outcome is only ever recorded for a finished run.
 */
export declare function recordWaveOutcome(campaignsDir: string, campaignId: string, waveIndex: number, result: EngagementResultLike, now?: Date): WaveRecord;
/**
 * Settle a wave whose engagement call THREW before producing an
 * EngagementResult (the executor's failure path): the wave becomes
 * "failed" with an outcome whose engagementStatus is "error" and whose
 * blockedReason carries the thrown message — the record shows the
 * launch happened and how it died, and the wave never sits "running"
 * forever. The campaign moves on exactly as for a harvested outcome
 * (cap → "complete", else "awaiting-advance"). Returns the settled
 * wave, or null when the wave was not running (already settled).
 */
export declare function settleFailedWave(campaignsDir: string, campaignId: string, waveIndex: number, message: string, now?: Date): WaveRecord | null;
export interface ResumeRepair {
    id: string;
    interruptedWaves: number[];
    fromStatus: CampaignStatus;
    toStatus: CampaignStatus;
}
export interface ResumeReport {
    scanned: number;
    repaired: ResumeRepair[];
    /** Campaigns whose records could not be loaded — reported, never
     *  silently skipped or invented around. */
    errors: Array<{
        id: string;
        error: string;
    }>;
}
/**
 * Restart repair across the whole store. Any wave still "running" when
 * this runs was stranded by a previous process's death: it is marked
 * "interrupted" (interruptedAt + reason "process-restart") and the
 * campaign returns to "awaiting-advance" so an operator decides what
 * happens next. Idempotent — a second run over a repaired store changes
 * nothing. Repairs are persisted with transition entries (reason
 * "resume-repair: ..."), so the record itself shows what happened.
 */
export declare function resumeCampaigns(campaignsDir: string, now?: Date): ResumeReport;
