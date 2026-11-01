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
import type { CampaignRecord } from './types.js';
export declare class CampaignLifecycleError extends Error {
    constructor(message: string);
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
export declare function planCampaignWave(campaignsDir: string, campaignId: string, plan: {
    waveIndex: number;
    aim: string;
}, opts?: {
    planRef?: string;
    now?: Date;
}): CampaignRecord;
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
export declare function pauseCampaign(campaignsDir: string, campaignId: string, opts?: {
    now?: Date;
}): CampaignRecord;
/**
 * Resume a paused campaign to the status its waves imply: "armed"
 * when a planned wave is waiting, "awaiting-advance" when waves have
 * launched and none is planned, "draft" when nothing has launched.
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @param opts - The clock.
 * @returns The updated record.
 */
export declare function resumeCampaign(campaignsDir: string, campaignId: string, opts?: {
    now?: Date;
}): CampaignRecord;
/**
 * Stop the campaign (operator decision): terminal, append-only —
 * the record and its wave history stay on disk (Decision C-6).
 * Refused while a wave is running.
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @param opts - The clock.
 * @returns The updated record.
 */
export declare function stopCampaign(campaignsDir: string, campaignId: string, opts?: {
    now?: Date;
}): CampaignRecord;
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
export declare function completeCampaign(campaignsDir: string, campaignId: string, opts?: {
    now?: Date;
}): CampaignRecord;
/** The campaign-level rollup: every wave's outcome, aggregated. */
export interface CampaignRollup {
    wavesLaunched: number;
    wavesComplete: number;
    wavesHalted: number;
    wavesFailed: number;
    wavesInterrupted: number;
    totalFindings: number;
    confirmed: number;
    killed: number;
    deferred: number;
    bySeverity: Record<string, number>;
}
/**
 * Aggregate the campaign record's per-wave rollups into one campaign
 * rollup. Mechanical derivation from the recorded wave outcomes —
 * nothing here estimates or re-judges a finding.
 * @param rec - The campaign record.
 * @returns The aggregated rollup.
 */
export declare function computeCampaignRollup(rec: CampaignRecord): CampaignRollup;
/**
 * Load a campaign record (re-exported convenience for A's callers).
 * @param campaignsDir - The campaigns directory.
 * @param campaignId - The campaign id.
 * @returns The record.
 */
export declare function getCampaign(campaignsDir: string, campaignId: string): CampaignRecord;
