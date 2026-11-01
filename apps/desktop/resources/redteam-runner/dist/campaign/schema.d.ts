/**
 * Campaign record validation (Q-CAMPAIGN, scoping N1).
 *
 * File-boundary validation per repo rule: a campaign record read from
 * disk is untrusted until it passes validateCampaignRecord. Fail loud
 * with path-specific messages — a corrupt or foreign record must surface
 * as an error, never be silently repaired into a different campaign.
 * (Restart repair of *stranded waves* is a different, explicit act —
 * see resumeCampaigns in store.ts — and is recorded in the record when
 * it happens.)
 */
import type { CampaignRecord, CampaignStatus, OperatorDecisionKind, WaveSeverity, WaveStatus } from './types.js';
export declare class CampaignSchemaError extends Error {
    constructor(message: string);
}
export declare const CAMPAIGN_STATUSES: readonly CampaignStatus[];
export declare const WAVE_STATUSES: readonly WaveStatus[];
export declare const OPERATOR_DECISION_KINDS: readonly OperatorDecisionKind[];
export declare const WAVE_SEVERITIES: readonly WaveSeverity[];
export declare function isSafeCampaignId(id: unknown): id is string;
/** The one kind name that must never exist in this product: the donor's
 *  /ad kind is forbidden by the canonical manifest, Part C. Enforced
 *  here at the file boundary and at creation, not just by convention. */
export declare function isForbiddenKind(kind: unknown): boolean;
/**
 * Validate an untrusted value as a CampaignRecord. Returns a normalized
 * record (only known fields survive). Throws CampaignSchemaError on any
 * violation — including an unknown version: a record written by newer
 * code fails loud here instead of silently downgrading.
 */
export declare function validateCampaignRecord(raw: unknown): CampaignRecord;
