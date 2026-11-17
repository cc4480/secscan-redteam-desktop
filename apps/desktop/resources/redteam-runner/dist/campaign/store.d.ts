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
import type { CampaignRecord, CampaignStatus } from './types.js';
export { CampaignStoreError, CAMPAIGN_FILE_NAME, resolveCampaignsDir, campaignDir, campaignFile, saveCampaignFile, loadCampaignFile, loadCampaign, listCampaignIds, transactCampaign, applyCampaignTransition, recordTransition, } from './store-io.js';
export { beginWave, computeRollup, recordWaveOutcome, settleFailedWave } from './store-wave.js';
export type { BeginWaveInput, EngagementResultLike } from './store-wave.js';
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
