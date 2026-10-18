/**
 * Harness2 section-8 composite scoring and acceptance gate.
 *
 * Six metrics per evaluation set: SR success rate, VF mean confirmed vulns,
 * FPR false positives / total claims (claims = confirmed + killed), STEPS mean
 * steps, TOK mean tokens (in + out), CR crash/hang rate.
 *
 * Composite (spec section 8, RANKING ONLY - never an acceptance reason):
 *   S = 0.45*SR - 0.30*FPR - 0.15*(TOK/TOK_base) - 0.10*(STEPS/STEPS_base)
 * TOK_base/STEPS_base are the base side's means on the same held-out set. A zero
 * baseline is neutral: ratio 1 when the candidate is non-zero and 0 at 0/0, so a
 * cold window can never divide by zero or poison the ranking.
 *
 * ACCEPTANCE GATE (spec section 8): ALL five conditions must hold.
 *   1. >= MIN_HELD_OUT_TARGETS (8) distinct held-out targets and the held-out
 *      set is disjoint from every target in the proposal's trajectories (the
 *      class's stored runs used to build the package);
 *   2. SR_cand >= SR_base + 0.05 OR (VF_cand >= 1.10*VF_base AND FPR_cand <= FPR_base);
 *   3. FPR_cand <= FPR_base + 0.02;
 *   4. TOK_cand <= 1.25*TOK_base AND STEPS_cand <= 1.25*STEPS_base;
 *   5. CR_cand <= CR_base.
 * VERDICTS: ADOPT (all five hold), REJECT (enough data, a condition failed),
 * INSUFFICIENT_DATA (fewer than 8 held-out targets, a log gap, or an empty
 * side). ADOPT is a recommendation: probe.ts still requires explicit operator
 * approval before anything is installed or activated.
 */
import type { RunMetrics } from "./contract.js";
import type { FailureMode, RunRow } from "./store-model.js";
/** A run normalized for scoring: a section-5 store row or a live probe run. */
export interface EvalRun {
    readonly runId: string;
    /** The specific target instance; used for the leakage check. */
    readonly targetId: string;
    readonly targetSubclass?: string;
    readonly failureMode: FailureMode;
    readonly success: boolean;
    readonly vulnsFound: number;
    readonly claimsTotal: number;
    readonly falsePositives: number;
    readonly steps: number;
    readonly tokens: number;
    readonly crashed: boolean;
}
/** The six section-8 metrics (plus the raw counts they are derived from). */
export interface MetricSet {
    readonly n: number;
    readonly successes: number;
    readonly claimsTotal: number;
    readonly falsePositives: number;
    readonly crashed: number;
    readonly sr: number;
    readonly vf: number;
    readonly fpr: number;
    readonly steps: number;
    readonly tok: number;
    readonly cr: number;
}
/** Composite weights, spec section 8. */
export declare const S_WEIGHTS: {
    readonly sr: 0.45;
    readonly fpr: 0.3;
    readonly tok: 0.15;
    readonly steps: 0.1;
};
/** Gate thresholds, spec section 8. */
export declare const MIN_HELD_OUT_TARGETS = 8;
export declare const MIN_SR_LIFT = 0.05;
export declare const MIN_VF_MULTIPLIER = 1.1;
export declare const MAX_FPR_REGRESSION = 0.02;
export declare const MAX_COST_MULTIPLIER = 1.25;
/** Section-8 verdict. */
export declare const VERDICT_NAMES: readonly ["ADOPT", "REJECT", "INSUFFICIENT_DATA"];
export type VerdictName = (typeof VERDICT_NAMES)[number];
/** Round for recorded output; ranking math itself stays full precision. */
export declare function round(value: number): number;
/** Arithmetic mean; 0 for an empty set. */
export declare function mean(values: readonly number[]): number;
/** Ratio with the documented zero-baseline rule. */
export declare function baselineRatio(value: number, base: number): number;
/** Compute the six metrics for one side. Pure. */
export declare function computeMetrics(runs: readonly EvalRun[]): MetricSet;
/** Composite S; `base` supplies TOK_base and STEPS_base. Ranking only. */
export declare function compositeScore(metrics: MetricSet, base: MetricSet): number;
/** Run-level S used by section-9 ranking: SR/FPR are per run, cost uses window means. */
export declare function runScore(run: EvalRun, baselines: {
    readonly tok: number;
    readonly steps: number;
}): number;
/** Normalize a stored run row into the scoring shape. */
export declare function fromRunRow(row: RunRow): EvalRun;
/** Normalize a live probe result (contract metrics) into the scoring shape. */
export declare function fromRunMetrics(metrics: RunMetrics): EvalRun;
/**
 * Normalize a target string to a comparable host key: lowercase, scheme and
 * path stripped, userinfo dropped, port stripped, trailing dots removed. An
 * entry that is not a host (empty) normalizes to "" and is ignored by leakage.
 */
export declare function targetKey(raw: string): string;
/** Held-out targets that also appear in the proposal's trajectories. */
export declare function findLeakage(heldOut: readonly string[], training: readonly string[]): string[];
/** One gate condition as recorded in the verdict log. */
export interface GateCondition {
    readonly id: number;
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
}
/** S for base and candidate, and their difference (positive = candidate better). */
export interface GateScore {
    readonly base: number;
    readonly candidate: number;
    readonly delta: number;
}
export interface GateInput {
    readonly base: MetricSet;
    readonly candidate: MetricSet;
    readonly heldOutTargets: readonly string[];
    /** Every target in the proposal's trajectories (the class's stored runs). */
    readonly trainingTargets: readonly string[];
    /** Non-empty when a required log/metrics row is missing. */
    readonly logGap?: string;
    readonly minTargets?: number;
}
export interface GateResult {
    readonly verdict: VerdictName;
    readonly conditions: readonly GateCondition[];
    readonly score: GateScore;
    readonly overlap: readonly string[];
    readonly enoughData: boolean;
}
/** Apply the five-condition section-8 gate. Pure; deterministic. */
export declare function evaluateGate(input: GateInput): GateResult;
