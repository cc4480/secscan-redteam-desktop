/**
 * Tool risk profiles + trajectory arbitration (v0.34.0).
 *
 * The tier system (0/1/2) answers "how much autonomy does the operator grant the
 * agent". It does not answer "how dangerous is THIS call" — a read-only
 * `nmap_exec profiles` and a `msf_exec run` are both just tool names at tier 1.
 * This module supplies the missing per-tool risk vocabulary and an interpretable
 * scorer, ported from AlterEgo's verified arbitration layer.
 *
 * Two fixes over the source design, both found by its own verification run:
 *   1. COVERAGE — every tool resolves. Unknown tools get a fail-closed profile
 *      (system blast, recoverability 0) instead of making the scorer throw.
 *   2. NO THROWING — `scoreTrajectory` never raises on an unknown name; it
 *      scores with the conservative default and says so in the rationale.
 *
 * score = w1*(1−blast) + w2*recoverability + w3*(1−sideEffects) + w4*optionality − w5*humanCost
 * tier  = auto (>0.8) | confirm (>=0.5) | explicit_intent (<0.5)
 */
export type BlastRadius = "none" | "session" | "external" | "user_data" | "system";
export interface RiskProfile {
    blastRadius: BlastRadius;
    /** 0-10; 10 = no-op / fully reversible. */
    recoverability: number;
    sideEffects: string[];
    compensatingAction?: string;
    sensitivityTags: string[];
    /** True when this profile came from the fail-closed default, not a curated entry. */
    unknown?: boolean;
}
/** Curated profiles for the tools whose risk is not obvious from the name. */
export declare const RISK_PROFILES: Record<string, RiskProfile>;
/**
 * Resolve the risk profile for any tool name. Never throws: an unknown name gets
 * the fail-closed default (system blast, recoverability 0) with `unknown: true`.
 */
export declare function profileFor(tool: string): RiskProfile;
/** Approval posture implied by a profile (mirrors the AlterEgo tier names). */
export declare function approvalTierFor(profile: RiskProfile): "silent" | "routine" | "always_ask";
export interface TrajectoryScore {
    tools: string[];
    score: number;
    tier: "auto" | "confirm" | "explicit_intent";
    rationale: string;
    metrics: {
        blastRadius: number;
        recoverability: number;
        sideEffects: number;
        optionality: number;
        humanCost: number;
    };
    profiles: RiskProfile[];
}
/** Score a candidate tool sequence. Unknown tools are scored conservatively, never thrown on. */
export declare function scoreTrajectory(tools: string[]): TrajectoryScore;
/** Plan-style explanation: per-step risk plus a rollback plan. */
export declare function explainTrajectory(tools: string[]): {
    score: number;
    tier: TrajectoryScore["tier"];
    rationale: string;
    steps: Array<{
        tool: string;
        approval: string;
        blastRadius: BlastRadius;
        recoverability: number;
        sideEffects: string[];
        compensatingAction?: string;
    }>;
    rollbackPlan: string[];
    maxBlastRadius: BlastRadius | undefined;
};
/** Rank candidate trajectories, safest first. */
export declare function rankTrajectories(candidates: string[][]): {
    ranked: TrajectoryScore[];
    recommended?: TrajectoryScore;
};
