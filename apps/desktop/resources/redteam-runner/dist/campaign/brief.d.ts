/**
 * Wave brief assembly (Q-CAMPAIGN, scoping N5).
 *
 * The brief is what makes a campaign more than a loop: each wave's
 * engagement is briefed from the campaign's accumulated state — the
 * verified scope, every earlier wave's aim and outcome rollup, the
 * hypotheses earlier waves killed, and the coverage gaps that remain —
 * so wave N+1 starts where wave N stopped instead of re-deriving it.
 *
 * Knowledge boundary (scoping §1/§7): this module composes from the
 * campaign record's own wave outcomes plus an optional caller-supplied
 * history digest (the Q-MEMTIER recall seam — ranking and retrieval
 * live there when it lands). It builds NO parallel knowledge store:
 * nothing here persists, indexes, or ranks findings.
 */
import type { CampaignKind, CampaignVector } from './kinds.js';
import type { WavePlan } from './planner.js';
import type { CampaignRecord } from './types.js';
/** One earlier wave, reduced to what a later brief needs from it. */
export interface WaveHistoryLine {
    waveIndex: number;
    status: string;
    aim?: string;
    engagementStatus?: string;
    totalFindings: number;
    confirmed: number;
    killed: number;
    deferred: number;
}
/** The assembled brief for one wave: objective + context for the engagement. */
export interface WaveBrief {
    campaignId: string;
    waveIndex: number;
    kind: string;
    scopeHosts: string[];
    /** The engagement objective: campaign objective + this wave's aim. */
    objective: string;
    /** The context block: scope, prior waves, killed lines, gaps, focus. */
    context: string;
    focusVectors: string[];
    coverageGaps: string[];
    priorWaves: WaveHistoryLine[];
}
/**
 * Every launched wave of the record, oldest first, as history lines.
 * Planned-but-unlaunched waves are excluded — a plan is not history.
 * @param rec - The campaign record.
 * @returns The history lines for waves that have been launched.
 */
export declare function waveHistory(rec: CampaignRecord): WaveHistoryLine[];
/**
 * The kind's vectors that no wave has focused yet — the campaign's
 * remaining coverage gaps, in roster order.
 * @param kind - The campaign kind (its vector roster defines coverage).
 * @param focusedNames - Vector names already focused by earlier waves/plans.
 * @returns The unfocused vectors.
 */
export declare function coverageGaps(kind: CampaignKind, focusedNames: Iterable<string>): CampaignVector[];
/**
 * Assemble the brief for one planned wave.
 * @param rec - The campaign record (scope + objective + wave outcomes).
 * @param kind - The campaign kind.
 * @param plan - The wave plan this brief serves.
 * @param opts - Optional history digest (recall seam output: earlier
 *   findings and killed hypotheses in detail) and the vector names
 *   earlier waves focused (from their plan artifacts), for gap math.
 * @returns The wave brief.
 */
export declare function buildWaveBrief(rec: CampaignRecord, kind: CampaignKind, plan: WavePlan, opts?: {
    historyDigest?: string;
    priorFocusVectors?: string[];
}): WaveBrief;
