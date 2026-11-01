/**
 * Campaign wave gate (Q-CAMPAIGN — the operator surface for Decision C-1).
 *
 * The donor's defining safety property: a wave runs only on an operator's
 * explicit advance — one wave per invocation, the human decides whether
 * the next wave exists. This module makes that property mechanical for
 * our campaign layer:
 *
 *  - Every launch authorization traces to a RECORDED operator decision
 *    in the campaign record (who / what / when) — a "start" decision for
 *    wave 1, an "advance" decision naming wave N for later waves.
 *  - Auto-advance exists only as a recorded authorization: an operator
 *    records "enable-auto-advance" with a wave cap, and launches are
 *    allowed under it only while the enabling decision resolves in the
 *    record. The DEFAULT is OFF — a fresh campaign is operator-gated,
 *    and an enabled flag whose enabling decision cannot be resolved
 *    authorizes nothing (fail-closed).
 *  - Campaign caps bind in every path: no decision and no auto-advance
 *    authorization can launch a wave past caps.maxWaves.
 *
 * The executor consults assertLaunchAllowed before EVERY wave launch.
 * There is deliberately no other way to authorize a launch, and no
 * agent-facing path records decisions: recordOperatorDecision is an
 * operator act, exactly like the accountability module's tier changes.
 *
 * An interrupted wave (resume-repair) is closed history: it counts as
 * launched. The campaign continues at the NEXT wave index under fresh
 * authorization — an interrupted wave is never silently re-run under
 * the same index, because its engagement may have partially executed.
 */
import type { CampaignRecord, OperatorDecision, OperatorDecisionKind } from './types.js';
export declare class CampaignGateError extends Error {
    constructor(message: string);
}
export type LaunchVia = 'operator-decision' | 'auto-advance';
export interface LaunchEvaluation {
    allowed: boolean;
    /** How the launch is authorized, when allowed. */
    via?: LaunchVia;
    /** Seq of the authorizing decision in the campaign record. */
    decisionSeq?: number;
    /** Human-readable basis for the verdict — recorded by callers. */
    reason: string;
}
/** The next wave index that may launch: one past the highest launched
 *  (non-"planned") wave, or 1 when nothing has launched yet. */
export declare function nextWaveIndex(rec: CampaignRecord): number;
/**
 * Pure launch evaluation for wave `waveIndex` (1-based) against a
 * campaign record. Total and deterministic: every path returns a
 * verdict with its basis, so callers can record WHY a launch was
 * refused instead of just that it was.
 */
export declare function evaluateLaunch(rec: CampaignRecord, waveIndex: number): LaunchEvaluation;
/** The executor's pre-launch check. Returns the evaluation when the
 *  launch is authorized; throws CampaignGateError with the refusal
 *  reason when it is not. */
export declare function assertLaunchAllowed(rec: CampaignRecord, waveIndex: number): LaunchEvaluation;
export interface RecordDecisionInput {
    operator: string;
    kind: OperatorDecisionKind;
    waveIndex?: number;
    maxWave?: number;
    note?: string;
}
/**
 * Record an operator decision in the campaign record — the ONLY way a
 * decision comes to exist. Validates the named operator and the
 * kind-specific fields, appends the decision with the next sequence,
 * and applies the auto-advance side effects in the same transaction,
 * so the flag and its authorizing decision can never drift apart.
 */
export declare function recordOperatorDecision(campaignsDir: string, campaignId: string, input: RecordDecisionInput, now?: Date): OperatorDecision;
