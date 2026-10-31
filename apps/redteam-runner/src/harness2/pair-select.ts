/**
 * Harness2 section-9 contrasted-pair selection.
 *
 * RUN SCORE: section 8's S applied per run, with the window means as TOK_base
 * and STEPS_base:
 *   S = 0.45*success - 0.30*(falsePositives/claimsTotal)
 *       - 0.15*(tokens/windowTokMean) - 0.10*(steps/windowStepsMean)
 * Runs are sorted by S desc (ts desc, runId asc break ties).
 *
 * QUARTILES: Q1 = top ceil(n/4) scores, Q4 = bottom ceil(n/4).
 *
 * PAIRS: up to 3 (MAX_PAIRS) disjoint pairs, high from Q1, low from Q4, high S
 * strictly above low S. Preference order inside a pair: same target_subclass
 * first, then the largest S gap; across pairs: a failure mode not yet used is
 * preferred. The pair's failure mode is the low run's failure_mode (or the
 * high run's when the low is "none"): "what failed" is the contrast. If a
 * quartile pool runs out before 3 pairs, the remaining runs are paired in
 * ranked order (best vs worst, still high-before-low) and the pair is noted.
 *
 * COLD START (pair-runs.ts): INSUFFICIENT_DATA -> no pairs; HARDEN /
 * REPAIR-FOUNDATION -> no contrasted pairs, but representativeRunIds cites the
 * three runs the package must show; REPAIR -> the contrasted pairs.
 */
import { asFailureMode } from "./store-rows.js";
import { computeMetrics, mean, runScore, type EvalRun } from "./scoring.js";
import {
  coldStartRunIds,
  decidePairMode,
  MAX_PAIRS,
  MIN_USABLE_RUNS,
  pickWindow,
  WINDOW_FALLBACK_DAYS,
  WINDOW_FALLBACK_MIN,
  WINDOW_SIZE,
  type PairMode,
  type PairRun,
  type PairWindow,
} from "./pair-runs.js";

export {
  coldStartRunIds,
  decidePairMode,
  isUsablePairRun,
  MAX_PAIRS,
  MIN_USABLE_RUNS,
  PAIR_MODES,
  pickWindow,
  WINDOW_FALLBACK_DAYS,
  WINDOW_FALLBACK_MIN,
  WINDOW_SIZE,
} from "./pair-runs.js";
export type { ModeDecision, PairMode, PairRun, PairWindow, WindowInput } from "./pair-runs.js";

export interface ScoredRun {
  readonly run: PairRun;
  readonly score: number;
  /** 1 = top quartile, 4 = bottom quartile; 2/3 are the middle half. */
  readonly quartile: 1 | 2 | 3 | 4;
}

export interface SelectedPair {
  readonly high: PairRun;
  readonly low: PairRun;
  readonly scoreGap: number;
  readonly sameSubclass: boolean;
  /** The contrasted failure mode: the low run's failure_mode, else the high's. */
  readonly failureMode: string;
  readonly failureModeDistinct: boolean;
  /** "quartile" or "fallback-ranked". */
  readonly source: string;
  readonly note?: string;
}

export interface PairSelection {
  readonly mode: PairMode;
  readonly modeReason: string;
  readonly window: PairWindow;
  readonly windowSize: number;
  readonly windowDays: number;
  readonly windowMethod: string;
  readonly quartileMethod: string;
  readonly baselines: { readonly tok: number; readonly steps: number };
  readonly scored: readonly ScoredRun[];
  /** S values of the Q1/Q4 boundaries, for the package's criteria statement. */
  readonly quartiles: { readonly q1Count: number; readonly q4Count: number; readonly q1Min: number; readonly q4Max: number };
  readonly pairs: readonly SelectedPair[];
  readonly representativeRunIds: readonly string[];
  readonly failureModeCoverage: readonly string[];
  /** Explicit human-readable rule statements for the package. */
  readonly criteria: readonly string[];
}

export interface PairSelectInput {
  readonly rows: readonly PairRun[];
  /** The current base harness version the window must match. */
  readonly harnessVersion: string;
  /** Clock seam; defaults to the newest run's ts (or Date.now() when empty). */
  readonly nowMs?: number;
  readonly maxPairs?: number;
  readonly windowSize?: number;
  readonly fallbackDays?: number;
  readonly fallbackMin?: number;
  readonly minUsableRuns?: number;
}

/** PairRun -> the scoring shape (store-model RunRow is not needed here). */
function evalRun(run: PairRun): EvalRun {
  return {
    runId: run.runId,
    targetId: run.runId,
    targetSubclass: run.targetSubclass,
    failureMode: asFailureMode(run.failureMode),
    success: run.success,
    vulnsFound: run.vulnsFound,
    claimsTotal: run.claimsTotal,
    falsePositives: run.falsePositives,
    steps: run.stepsCount,
    tokens: run.tokensTotal,
    crashed: run.crashed,
  };
}

interface ScoredWindow {
  readonly scored: readonly ScoredRun[];
  readonly baselines: { readonly tok: number; readonly steps: number };
  readonly quartiles: PairSelection["quartiles"];
}

/** Rank the window by run-level S and cut Q1/Q4. Pure. */
function scoreWindow(runs: readonly PairRun[]): ScoredWindow {
  const baselines = { tok: mean(runs.map((run) => run.tokensTotal)), steps: mean(runs.map((run) => run.stepsCount)) };
  const ranked = runs
    .map((run) => ({ run, score: runScore(evalRun(run), baselines) }))
    .sort((a, b) => b.score - a.score || b.run.ts - a.run.ts || a.run.runId.localeCompare(b.run.runId));
  const n = ranked.length;
  const q1Count = Math.ceil(n / 4);
  const q4Count = Math.ceil(n / 4);
  const scored: ScoredRun[] = ranked.map((entry, index) => ({
    run: entry.run,
    score: entry.score,
    quartile: index < q1Count ? 1 : index >= n - q4Count ? 4 : index < Math.ceil(n / 2) ? 2 : 3,
  }));
  return {
    scored,
    baselines,
    quartiles: {
      q1Count,
      q4Count,
      q1Min: q1Count > 0 ? scored[q1Count - 1]!.score : 0,
      q4Max: q4Count > 0 ? scored[n - q4Count]!.score : 0,
    },
  };
}

interface Combo {
  readonly high: ScoredRun;
  readonly low: ScoredRun;
  readonly scoreGap: number;
  readonly sameSubclass: boolean;
  readonly failureMode: string;
}

function pairFailureMode(high: PairRun, low: PairRun): string {
  return low.failureMode !== "none" ? low.failureMode : high.failureMode;
}

function sameSubclass(high: PairRun, low: PairRun): boolean {
  const a = high.targetSubclass ?? "";
  return a !== "" && a === (low.targetSubclass ?? "");
}

/** Greedy Q1-vs-Q4 pairs with a ranked fallback; see the file comment. */
function buildPairs(scored: readonly ScoredRun[], maxPairs: number): SelectedPair[] {
  const pairs: SelectedPair[] = [];
  const used = new Set<string>();
  const usedModes = new Set<string>();
  const highs = scored.filter((entry) => entry.quartile === 1);
  const lows = scored.filter((entry) => entry.quartile === 4);
  const combos: Combo[] = [];
  for (const high of highs) {
    for (const low of lows) {
      if (high.run.runId === low.run.runId || high.score <= low.score) continue;
      combos.push({
        high,
        low,
        scoreGap: high.score - low.score,
        sameSubclass: sameSubclass(high.run, low.run),
        failureMode: pairFailureMode(high.run, low.run),
      });
    }
  }
  const byPreference = (a: Combo, b: Combo): number =>
    Number(!usedModes.has(b.failureMode)) - Number(!usedModes.has(a.failureMode)) ||
    Number(b.sameSubclass) - Number(a.sameSubclass) ||
    b.scoreGap - a.scoreGap ||
    a.high.run.runId.localeCompare(b.high.run.runId);
  while (pairs.length < maxPairs) {
    const chosen = combos.filter((combo) => !used.has(combo.high.run.runId) && !used.has(combo.low.run.runId)).sort(byPreference)[0];
    if (chosen === undefined) break;
    const distinct = !usedModes.has(chosen.failureMode);
    used.add(chosen.high.run.runId);
    used.add(chosen.low.run.runId);
    usedModes.add(chosen.failureMode);
    pairs.push({
      high: chosen.high.run,
      low: chosen.low.run,
      scoreGap: chosen.scoreGap,
      sameSubclass: chosen.sameSubclass,
      failureMode: chosen.failureMode,
      failureModeDistinct: distinct,
      source: "quartile",
    });
  }
  // Fallback: the spec asks for up to 3 pairs; when a quartile pool is too
  // small, pair remaining runs best-vs-worst in ranked order and say so.
  const remaining = scored.filter((entry) => !used.has(entry.run.runId));
  while (pairs.length < maxPairs && remaining.length >= 2) {
    const high = remaining.shift();
    const low = remaining.pop();
    if (high === undefined || low === undefined || high.score <= low.score) break;
    pairs.push({
      high: high.run,
      low: low.run,
      scoreGap: high.score - low.score,
      sameSubclass: sameSubclass(high.run, low.run),
      failureMode: pairFailureMode(high.run, low.run),
      failureModeDistinct: !usedModes.has(pairFailureMode(high.run, low.run)),
      source: "fallback-ranked",
      note: "fallback-ranked: a quartile pool ran out; paired best vs worst of the remaining ranked runs",
    });
  }
  return pairs;
}

/** Select the window, cold-start mode and up to MAX_PAIRS contrasted pairs. Pure. */
export function selectPairs(input: PairSelectInput): PairSelection {
  const maxPairs = Math.min(MAX_PAIRS, Math.max(1, Math.trunc(input.maxPairs ?? MAX_PAIRS)));
  const minUsable = Math.max(1, Math.trunc(input.minUsableRuns ?? MIN_USABLE_RUNS));
  const window = pickWindow(input);
  const { mode, reason } = decidePairMode(window.runs, minUsable);
  const { scored, baselines, quartiles } = scoreWindow(window.runs);
  const modeReason = `${reason} (window: ${window.size} usable runs, method ${window.method}, harness ${window.harnessVersion})`;
  const coldStart = coldStartRunIds(mode, window.runs);
  const pairs = mode === "REPAIR" ? buildPairs(scored, maxPairs) : [];
  const failureModeCoverage = [...new Set(pairs.map((pair) => pair.failureMode))];
  const representativeRunIds = mode === "REPAIR" ? pairs.flatMap((pair) => [pair.high.runId, pair.low.runId]) : coldStart;
  const metrics = computeMetrics(window.runs.map(evalRun));
  const criteria = [
    `window: most recent ${input.windowSize ?? WINDOW_SIZE} usable runs with harness_version=${input.harnessVersion} (fallback: last ${input.fallbackDays ?? WINDOW_FALLBACK_DAYS} days when fewer than ${input.fallbackMin ?? WINDOW_FALLBACK_MIN} usable runs); usable = complete metrics row (steps_count > 0) and not crashed`,
    `window used: ${window.size} run(s), method ${window.method}, ${window.days} day(s)`,
    `score: S = 0.45*SR - 0.30*FPR - 0.15*(tokens/${baselines.tok.toFixed(2)}) - 0.10*(steps/${baselines.steps.toFixed(2)})`,
    `quartiles: sorted by S desc; Q1 = top ceil(n/4) = ${quartiles.q1Count} (min ${quartiles.q1Min}), Q4 = bottom ceil(n/4) = ${quartiles.q4Count} (max ${quartiles.q4Max})`,
    `pairs: up to ${maxPairs}, high from Q1 vs low from Q4, score strictly higher, same target_subclass preferred, distinct failure_mode preferred across pairs`,
    `mode: ${mode} - ${modeReason}`,
    `class metrics: n=${metrics.n} SR=${metrics.sr.toFixed(4)} VF=${metrics.vf.toFixed(4)} FPR=${metrics.fpr.toFixed(4)} STEPS=${metrics.steps.toFixed(2)} TOK=${metrics.tok.toFixed(2)} CR=${metrics.cr.toFixed(4)}`,
  ];
  return {
    mode,
    modeReason,
    window,
    windowSize: window.size,
    windowDays: window.days,
    windowMethod: window.method,
    quartileMethod: "run-level S desc; Q1 = top ceil(n/4), Q4 = bottom ceil(n/4); pair high from Q1, low from Q4",
    baselines,
    scored,
    quartiles,
    pairs,
    representativeRunIds,
    failureModeCoverage,
    criteria,
  };
}
