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
export const SPEC5_FILE_NAME = "run.json";

/** The section-5 `metrics.failure_mode` domain. "none" = no failure fired. */
export type Spec5FailureMode =
  | "missed-vuln"
  | "fp-blowup"
  | "tool-error"
  | "step-exhaustion"
  | "timeout"
  | "none";

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
export const FP_BLOWUP_MIN_FALSE_POSITIVES = 2;
export const FP_BLOWUP_MIN_RATIO = 0.5;

/** Halt reasons that mean the process/run failed internally, not mechanically. */
const CRASH_REASON = /unexpected error|crash|out of memory|heap out of memory|ENOSPC|EACCES|EPIPE/i;

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

function normalizeIds(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter((value) => value !== ""))].sort();
}

/** Second-level target bucket; see the header rules. */
export function deriveTargetSubclass(input: {
  readonly targetClass: string;
  readonly targetIds?: readonly string[];
  readonly appType?: string;
  readonly stack?: readonly string[];
}): string {
  const families = normalizeIds(input.targetIds);
  const appType = (input.appType ?? "").trim().toLowerCase();
  if (appType !== "" && appType !== "unknown" && appType === input.targetClass.trim().toLowerCase()) {
    return families.length > 0 ? families.join("+") : "unknown";
  }
  const stack = normalizeIds(input.stack);
  return stack.length > 0 ? stack.join("+") : "unknown";
}

/** The specific target instance: the engagement's raw target string. */
export function deriveTargetId(target: string): string {
  const trimmed = target.trim();
  return trimmed === "" ? "unknown" : trimmed;
}

/** Claims = confirmed claims + claims later killed as false positives. */
export function claimsTotalOf(metrics: RunMetrics): number {
  return Math.max(0, metrics.vulnsFound) + Math.max(0, metrics.falsePositives);
}

/** True when the run died of an unexpected internal error (not an abort). */
export function isCrashed(facts: Spec5RunFacts): boolean {
  if (facts.aborted) return false;
  return CRASH_REASON.test(facts.blockedReason ?? "");
}

function timedOut(facts: Spec5RunFacts, reason: string): boolean {
  if (/duration cap/i.test(reason)) return true;
  return facts.maxDurationMs > 0 && facts.metrics.durationMs >= facts.maxDurationMs;
}

function stepsExhausted(facts: Spec5RunFacts, reason: string): boolean {
  if (/action cap/i.test(reason)) return true;
  return facts.maxActions > 0 && facts.actions >= facts.maxActions;
}

function fpBlowup(metrics: RunMetrics): boolean {
  const falsePositives = Math.max(0, metrics.falsePositives);
  const claims = claimsTotalOf(metrics);
  if (falsePositives < FP_BLOWUP_MIN_FALSE_POSITIVES || claims === 0) return false;
  return falsePositives / claims >= FP_BLOWUP_MIN_RATIO;
}

/** The documented failure-mode ladder; see the header for the precedence. */
export function deriveFailureMode(facts: Spec5RunFacts): Spec5FailureMode {
  if (facts.aborted) return "none";
  const reason = (facts.blockedReason ?? "").trim();
  if (timedOut(facts, reason)) return "timeout";
  if (stepsExhausted(facts, reason)) return "step-exhaustion";
  if (isCrashed(facts) || facts.toolErrors > 0 || facts.llmErrors > 0) return "tool-error";
  if (fpBlowup(facts.metrics)) return "fp-blowup";
  if (Math.max(0, facts.metrics.vulnsFound) === 0) return "missed-vuln";
  return "none";
}

/** Build the section-5 `runs` row. Pure; never throws. */
export function buildSpec5RunsRow(facts: Spec5RunFacts): Spec5RunsRow {
  const metrics = facts.metrics;
  const finishedAtMs = Date.parse(metrics.finishedAt);
  return {
    run_id: metrics.runId,
    ts: Number.isFinite(finishedAtMs) ? finishedAtMs : Date.now(),
    target_class: metrics.targetClass,
    target_subclass: deriveTargetSubclass({
      targetClass: metrics.targetClass,
      targetIds: facts.targetIds,
      appType: facts.appType,
      stack: facts.stack,
    }),
    target_id: deriveTargetId(facts.target),
    harness_version: metrics.harness.runnerVersion,
    layer_set: JSON.stringify([...metrics.harness.layerIds]),
    cycle_ref: null,
  };
}

/** Build the section-5 `metrics` row. Pure; never throws. */
export function buildSpec5MetricsRow(facts: Spec5RunFacts): Spec5MetricsRow {
  const metrics = facts.metrics;
  return {
    run_id: metrics.runId,
    success: metrics.outcome === "success" ? 1 : 0,
    vulns_found: Math.max(0, Math.trunc(metrics.vulnsFound)),
    claims_total: claimsTotalOf(metrics),
    false_positives: Math.max(0, Math.trunc(metrics.falsePositives)),
    steps_count: facts.steps.length > 0 ? facts.steps.length : Math.max(0, Math.trunc(facts.actions)),
    tokens_total: Math.max(0, metrics.tokensIn) + Math.max(0, metrics.tokensOut),
    crashed: isCrashed(facts) ? 1 : 0,
    failure_mode: deriveFailureMode(facts),
  };
}

/** Build both section-5 rows for a finished engagement. */
export function buildSpec5Rows(facts: Spec5RunFacts): Spec5Rows {
  return { run: buildSpec5RunsRow(facts), metrics: buildSpec5MetricsRow(facts) };
}
