/**
 * Campaign store — the wave lifecycle.
 *
 * Extracted verbatim from store.ts in a structural split (no file under
 * src/ may exceed 300 lines): launch bookkeeping (beginWave), the
 * mechanical rollup, outcome harvest (recordWaveOutcome) and the
 * executor's failure settlement (settleFailedWave). Every function keeps
 * its original body, ordering and status mapping; the record spine and
 * I/O it runs on lives in store-io.ts. No logic changed in the move.
 */
import type { WaveRecord, WaveRollup, WaveSeverity } from './types.js';
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
