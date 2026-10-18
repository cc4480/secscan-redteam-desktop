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
export const S_WEIGHTS = { sr: 0.45, fpr: 0.3, tok: 0.15, steps: 0.1 } as const;
/** Gate thresholds, spec section 8. */
export const MIN_HELD_OUT_TARGETS = 8;
export const MIN_SR_LIFT = 0.05;
export const MIN_VF_MULTIPLIER = 1.1;
export const MAX_FPR_REGRESSION = 0.02;
export const MAX_COST_MULTIPLIER = 1.25;

/** Section-8 verdict. */
export const VERDICT_NAMES = ["ADOPT", "REJECT", "INSUFFICIENT_DATA"] as const;
export type VerdictName = (typeof VERDICT_NAMES)[number];

/** Round for recorded output; ranking math itself stays full precision. */
export function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Arithmetic mean; 0 for an empty set. */
export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Ratio with the documented zero-baseline rule. */
export function baselineRatio(value: number, base: number): number {
  if (base > 0) return value / base;
  return value > 0 ? 1 : 0;
}

/** Compute the six metrics for one side. Pure. */
export function computeMetrics(runs: readonly EvalRun[]): MetricSet {
  const n = runs.length;
  const successes = runs.filter((run) => run.success).length;
  const crashed = runs.filter((run) => run.crashed).length;
  const claimsTotal = runs.reduce((sum, run) => sum + run.claimsTotal, 0);
  const falsePositives = runs.reduce((sum, run) => sum + run.falsePositives, 0);
  return {
    n,
    successes,
    claimsTotal,
    falsePositives,
    crashed,
    sr: n === 0 ? 0 : successes / n,
    vf: mean(runs.map((run) => run.vulnsFound)),
    fpr: claimsTotal === 0 ? 0 : falsePositives / claimsTotal,
    steps: mean(runs.map((run) => run.steps)),
    tok: mean(runs.map((run) => run.tokens)),
    cr: n === 0 ? 0 : crashed / n,
  };
}

/** Composite S; `base` supplies TOK_base and STEPS_base. Ranking only. */
export function compositeScore(metrics: MetricSet, base: MetricSet): number {
  const value =
    S_WEIGHTS.sr * metrics.sr -
    S_WEIGHTS.fpr * metrics.fpr -
    S_WEIGHTS.tok * baselineRatio(metrics.tok, base.tok) -
    S_WEIGHTS.steps * baselineRatio(metrics.steps, base.steps);
  return round(value);
}

/** Run-level S used by section-9 ranking: SR/FPR are per run, cost uses window means. */
export function runScore(run: EvalRun, baselines: { readonly tok: number; readonly steps: number }): number {
  const claims = Math.max(0, run.claimsTotal);
  const fpr = claims === 0 ? 0 : Math.max(0, run.falsePositives) / claims;
  const value =
    S_WEIGHTS.sr * (run.success ? 1 : 0) -
    S_WEIGHTS.fpr * fpr -
    S_WEIGHTS.tok * baselineRatio(run.tokens, baselines.tok) -
    S_WEIGHTS.steps * baselineRatio(run.steps, baselines.steps);
  return round(value);
}

/** Normalize a stored run row into the scoring shape. */
export function fromRunRow(row: RunRow): EvalRun {
  return {
    runId: row.runId,
    targetId: row.targetId ?? row.runId,
    targetSubclass: row.targetSubclass,
    failureMode: row.failureMode,
    success: row.success,
    vulnsFound: row.vulnsFound,
    claimsTotal: row.claimsTotal,
    falsePositives: row.falsePositives,
    steps: row.stepsCount,
    tokens: row.tokensTotal,
    crashed: row.crashed,
  };
}

/** Normalize a live probe result (contract metrics) into the scoring shape. */
export function fromRunMetrics(metrics: RunMetrics): EvalRun {
  const vulnsFound = Math.max(0, metrics.vulnsFound);
  const falsePositives = Math.max(0, metrics.falsePositives);
  const failed = metrics.outcome === "failure" && vulnsFound === 0;
  return {
    runId: metrics.runId,
    targetId: metrics.engagementId,
    failureMode: failed ? "missed-vuln" : "none",
    success: metrics.outcome === "success",
    vulnsFound,
    claimsTotal: vulnsFound + falsePositives,
    falsePositives,
    steps: Math.max(0, metrics.steps),
    tokens: Math.max(0, metrics.tokensIn) + Math.max(0, metrics.tokensOut),
    crashed: metrics.outcome === "aborted",
  };
}

/**
 * Normalize a target string to a comparable host key: lowercase, scheme and
 * path stripped, userinfo dropped, port stripped, trailing dots removed. An
 * entry that is not a host (empty) normalizes to "" and is ignored by leakage.
 */
export function targetKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return "";
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const authority = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
  const hostPort = authority.split("@").pop() ?? authority;
  const host = hostPort
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  return host !== "" ? host : trimmed.replace(/\/+$/, "");
}

/** Held-out targets that also appear in the proposal's trajectories. */
export function findLeakage(heldOut: readonly string[], training: readonly string[]): string[] {
  const seen = new Set(training.map(targetKey).filter((key) => key !== ""));
  return heldOut.filter((target) => {
    const key = targetKey(target);
    return key !== "" && seen.has(key);
  });
}

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
const pct = (value: number): string => value.toFixed(4);

/** Apply the five-condition section-8 gate. Pure; deterministic. */
export function evaluateGate(input: GateInput): GateResult {
  const { base, candidate } = input;
  const minTargets = input.minTargets ?? MIN_HELD_OUT_TARGETS;
  const heldOut = [...new Set(input.heldOutTargets.map(targetKey).filter((key) => key !== ""))];
  const overlap = findLeakage(input.heldOutTargets, input.trainingTargets);
  const logGap = (input.logGap ?? "").trim();
  const enoughTargets = heldOut.length >= minTargets;
  const structural = enoughTargets && logGap === "";
  const enoughData = structural && overlap.length === 0 && base.n > 0 && candidate.n > 0;

  const srLift = candidate.sr >= base.sr + MIN_SR_LIFT;
  const vfLift = candidate.vf >= MIN_VF_MULTIPLIER * base.vf;
  const fprNotWorse = candidate.fpr <= base.fpr;
  const lift = srLift || (vfLift && fprNotWorse);
  const fprGuard = candidate.fpr <= base.fpr + MAX_FPR_REGRESSION;
  const tokGuard = candidate.tok <= MAX_COST_MULTIPLIER * base.tok;
  const stepsGuard = candidate.steps <= MAX_COST_MULTIPLIER * base.steps;
  const crashGuard = candidate.cr <= base.cr;

  const conditions: GateCondition[] = [
    {
      id: 1,
      name: "held-out sufficiency + no leakage",
      passed: enoughTargets && overlap.length === 0 && logGap === "",
      detail:
        `${heldOut.length}/${minTargets} distinct held-out targets` +
        (overlap.length === 0 ? ", disjoint from proposal trajectories" : `, LEAKED: ${overlap.join(", ")}`) +
        (logGap === "" ? "" : `, log gap: ${logGap}`),
    },
    {
      id: 2,
      name: "outcome lift (SR +0.05 or VF x1.10)",
      passed: lift,
      detail: `SR ${pct(candidate.sr)} vs ${pct(base.sr)}; VF ${pct(candidate.vf)} vs ${pct(base.vf)} (x${MIN_VF_MULTIPLIER}); FPR ${pct(candidate.fpr)} vs ${pct(base.fpr)}`,
    },
    {
      id: 3,
      name: "false-positive guard (+0.02)",
      passed: fprGuard,
      detail: `FPR ${pct(candidate.fpr)} vs ${pct(base.fpr)} + ${MAX_FPR_REGRESSION}`,
    },
    {
      id: 4,
      name: "cost guard (TOK and STEPS x1.25)",
      passed: tokGuard && stepsGuard,
      detail: `TOK ${pct(candidate.tok)} vs ${pct(base.tok)}; STEPS ${pct(candidate.steps)} vs ${pct(base.steps)} (x${MAX_COST_MULTIPLIER})`,
    },
    {
      id: 5,
      name: "crash guard (CR not worse)",
      passed: crashGuard,
      detail: `CR ${pct(candidate.cr)} vs ${pct(base.cr)}`,
    },
  ];

  const score: GateScore = (() => {
    const baseScore = compositeScore(base, base);
    const candidateScore = compositeScore(candidate, base);
    return { base: baseScore, candidate: candidateScore, delta: round(candidateScore - baseScore) };
  })();

  let verdict: VerdictName;
  if (!structural) verdict = "INSUFFICIENT_DATA";
  else if (overlap.length > 0) verdict = "REJECT";
  else if (base.n === 0 || candidate.n === 0) verdict = "INSUFFICIENT_DATA";
  else if (conditions.every((condition) => condition.passed)) verdict = "ADOPT";
  else verdict = "REJECT";
  return { verdict, conditions, score, overlap, enoughData };
}
