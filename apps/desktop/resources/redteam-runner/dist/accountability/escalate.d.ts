/**
 * Mid-run tier escalation entry point (v0.24.0) — shared by the CLI
 * (`redteam-runner escalate`) and the UI (POST /api/engagements/:id/escalate).
 * One implementation, two surfaces: the rules cannot drift between them.
 *
 * Rules (mechanical, same as the dispatcher enforces):
 *  - UP (toTier > current) requires a named operator AND a recorded reason.
 *  - DOWN (toTier < current) is allowed freely — lowering autonomy mid-run
 *    is harmless — but it is still logged with the operator's name.
 *  - Tier 2 on PRODUCTION additionally requires explicit production
 *    confirmation (--confirm-tier2-production / REDTEAM_TIER2_PROD_CONFIRM).
 *  - The approval is recorded in approvals.jsonl BEFORE tier.json is
 *    rewritten; a running dispatcher picks the new tier up on its next
 *    tool call. Agents can never call this — there is no agent tool for it.
 */
import { type AutonomyTier } from "./tiers.js";
/** Same convention as the runner config and the UI store: REDTEAM_HOME or cwd. */
export declare function resolveEngagementsDir(env?: NodeJS.ProcessEnv, override?: string): string;
/** Engagement IDs are runner-generated — accept only the safe shape (no traversal). */
export declare function isSafeEngagementId(id: string): boolean;
export interface EscalateRequest {
    engagementsDir?: string;
    engagementId: string;
    /** 0|1|2 (or observe|validate|chain) — parsed loudly, never guessed. */
    toTier: string;
    operator?: string;
    reason?: string;
    /** Explicit Tier-2-on-production confirmation (flag or env). */
    tier2ProdConfirmed?: boolean;
    env?: NodeJS.ProcessEnv;
}
export interface EscalateResult {
    engagementId: string;
    fromTier: AutonomyTier;
    toTier: AutonomyTier;
    operator: string;
    /** Engagement status from state.json — tells the caller whether a live dispatcher will pick this up. */
    engagementStatus: string;
    approvalSeq: number;
}
export declare function escalateEngagement(req: EscalateRequest): EscalateResult;
/** Human-readable one-liner for CLI output. */
export declare function describeEscalation(r: EscalateResult): string;
