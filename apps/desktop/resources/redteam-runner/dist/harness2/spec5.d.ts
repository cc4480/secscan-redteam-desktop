/**
 * Harness2 section-5 capture rows (H2-P1 lifecycle wiring).
 *
 * The spec's WAL schema stores one `runs` row, N `steps` rows and one `metrics`
 * row per engagement. The steps are written live (see ./steps.ts); this module
 * derives the runs row and the metrics row from the finished engagement, and
 * ./trajectory-write.ts persists both as `<engagementDir>/run.json`:
 *
 *   { "run": { ...runs columns... }, "metrics": { ...metrics columns... } }
 *
 * Derivation rules, all mechanical and documented so two runs are comparable:
 *
 * runs.target_class - RunMetrics.targetClass (the existing rule: recon appType
 *   when known, else the sorted target families, else the host class).
 * runs.target_subclass - the next level down:
 *   1. when the class came from the appType: the sorted target families joined
 *      with "+" ("secscan+seclayer"), or "unknown";
 *   2. otherwise: the fingerprint stack entries joined with "+", or "unknown".
 * runs.target_id - the engagement's raw target string (the specific instance),
 *   trimmed; "unknown" when empty.
 * runs.harness_version - the harness stamp's runnerVersion.
 * runs.layer_set - JSON-encoded ordered layer-id array (exactly what the TEXT
 *   column stores), e.g. "[\"base\",\"wp-hardening\"]".
 * runs.cycle_ref - always null in Phase 1 (no tuning cycles exist yet).
 * runs.ts - finishedAt as epoch milliseconds.
 *
 * metrics.success - 1 only for a success outcome (confirmed evidence).
 * metrics.claims_total - every recorded vulnerability claim: confirmed plus
 *   killed claims (false positives), so FPR = false_positives / claims_total.
 * metrics.steps_count - captured steps rows when any exist, else the planner
 *   unit (ctx.actions), so a run without a journal still reports a count.
 * metrics.tokens_total - tokensIn + tokensOut from the per-response meter.
 * metrics.crashed - 1 when the run died of an unexpected internal error rather
 *   than a mechanical halt (operator aborts are not crashes).
 *
 * metrics.failure_mode - precedence, first rule that fires wins:
 *   1. none            - aborted by the operator (a deliberate stop is not a
 *                        harness failure);
 *   2. timeout         - the duration cap fired (halt reason or durationMs at
 *                        the configured maximum);
 *   3. step-exhaustion - the action cap fired (halt reason or ctx.actions at
 *                        the configured maximum);
 *   4. tool-error      - a tool dispatch threw, an LLM call failed, or the run
 *                        crashed with an unexpected error;
 *   5. fp-blowup       - at least 2 false positives AND FPR >= 0.5;
 *   6. missed-vuln     - the run finished with 0 confirmed vulnerabilities;
 *   7. none            - otherwise (at least one confirmed vuln, no hard error).
 */
import type { RunMetrics } from "./contract.js";
import type { StepRecord } from "./steps.js";
/** File name inside the engagement directory. */
export declare const SPEC5_FILE_NAME = "run.json";
/** The section-5 `metrics.failure_mode` domain. "none" = no failure fired. */
export type Spec5FailureMode = "missed-vuln" | "fp-blowup" | "tool-error" | "step-exhaustion" | "timeout" | "none";
/** One section-5 `runs` row. */
export interface Spec5RunsRow {
    readonly run_id: string;
    /** finishedAt as epoch milliseconds (the INTEGER ts column). */
    readonly ts: number;
    readonly target_class: string;
    readonly target_subclass: string;
    readonly target_id: string;
    readonly harness_version: string;
    /** JSON-encoded ordered layer-id array, as stored in the TEXT column. */
    readonly layer_set: string;
    readonly cycle_ref: null;
}
/** One section-5 `metrics` row. */
export interface Spec5MetricsRow {
    readonly run_id: string;
    readonly success: 0 | 1;
    readonly vulns_found: number;
    readonly claims_total: number;
    readonly false_positives: number;
    readonly steps_count: number;
    readonly tokens_total: number;
    readonly crashed: 0 | 1;
    readonly failure_mode: Spec5FailureMode;
}
/** The two section-5 rows a finished engagement produces. */
export interface Spec5Rows {
    readonly run: Spec5RunsRow;
    readonly metrics: Spec5MetricsRow;
}
/** False-positive blow-up thresholds: 2 wrong claims and half of all claims. */
export declare const FP_BLOWUP_MIN_FALSE_POSITIVES = 2;
export declare const FP_BLOWUP_MIN_RATIO = 0.5;
/** Everything the derivations need about the finished run. */
export interface Spec5RunFacts {
    readonly metrics: RunMetrics;
    readonly steps: readonly StepRecord[];
    readonly actions: number;
    readonly maxActions: number;
    readonly maxDurationMs: number;
    readonly blockedReason?: string;
    readonly aborted: boolean;
    /** Observations whose tool dispatch threw. */
    readonly toolErrors: number;
    /** LLM call failures recorded in the event log. */
    readonly llmErrors: number;
    readonly target: string;
    readonly targetIds?: readonly string[];
    readonly appType?: string;
    readonly stack?: readonly string[];
}
/** Second-level target bucket; see the header rules. */
export declare function deriveTargetSubclass(input: {
    readonly targetClass: string;
    readonly targetIds?: readonly string[];
    readonly appType?: string;
    readonly stack?: readonly string[];
}): string;
/** The specific target instance: the engagement's raw target string. */
export declare function deriveTargetId(target: string): string;
/** Claims = confirmed claims + claims later killed as false positives. */
export declare function claimsTotalOf(metrics: RunMetrics): number;
/** True when the run died of an unexpected internal error (not an abort). */
export declare function isCrashed(facts: Spec5RunFacts): boolean;
/** The documented failure-mode ladder; see the header for the precedence. */
export declare function deriveFailureMode(facts: Spec5RunFacts): Spec5FailureMode;
/** Build the section-5 `runs` row. Pure; never throws. */
export declare function buildSpec5RunsRow(facts: Spec5RunFacts): Spec5RunsRow;
/** Build the section-5 `metrics` row. Pure; never throws. */
export declare function buildSpec5MetricsRow(facts: Spec5RunFacts): Spec5MetricsRow;
/** Build both section-5 rows for a finished engagement. */
export declare function buildSpec5Rows(facts: Spec5RunFacts): Spec5Rows;
