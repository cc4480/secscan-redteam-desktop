/**
 * Campaign store — file I/O and the record-audit spine.
 *
 * Extracted verbatim from store.ts in a structural split (no file under
 * src/ may exceed 300 lines). This module owns the primitives every
 * campaign writer shares: campaigns-dir resolution, the atomic
 * write/load/validate pair, the synchronous read-modify-write
 * transaction, and the single transition writer that keeps the audit
 * spine gapless. store.ts (creation, resume repair) and store-wave.ts
 * (wave lifecycle) are both built on it. No logic changed in the move.
 */
import type { CampaignRecord, CampaignStatus } from './types.js';
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
/** Timestamp helper, exported for the wave module (same format everywhere). */
export declare function iso(now: Date): string;
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
