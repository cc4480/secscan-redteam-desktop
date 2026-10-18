/**
 * Harness2 contrasted-pair selection + aggregate metrics (H2-P2a).
 *
 * PAIR SELECTION RULE (mechanical, documented so the report can state it):
 *  - positive pool: the top maxPairs runs of the class with outcome
 *    success|partial and vulnsFound > 0, ranked by vulnsFound desc,
 *    claimsTotal desc, stepsCount asc, runId asc (highest yield first);
 *  - negative pool: every non-aborted run of the class with at least one step
 *    and outcome failure|partial, ranked by vulnsFound asc, failure before
 *    partial, claimsTotal asc, runId asc (lowest yield first). A low-yield
 *    partial run is a legitimate negative;
 *  - not comparable, skipped and noted in the instructions: aborted runs (the
 *    kill switch is not a harness signal), zero-step failures (blocked before
 *    acting), a positive that is not strictly higher-yield than the next
 *    lowest-yield candidate, and pools without a disjoint pair;
 *  - up to maxPairs (default 2) greedy pairs from the ranked pools, so a run is
 *    never reused on either side. Different layer sets ARE allowed, but the
 *    pair is noted as not layer-controlled.
 */
import type { ContrastPair, RunMetrics, TrajectoryEvent, TrajectoryRecord } from "./contract.js";
import type { Harness2Store, RunDetail, RunRow } from "./store-model.js";

/** Pairs per package unless the caller asks for more. */
export const DEFAULT_PAIR_COUNT = 2;
/** Class scan cap; the package is a contrast, not an archive. */
export const RUN_SCAN_LIMIT = 500;

function rowMetrics(row: RunRow): RunMetrics {
  const iso = row.ts > 0 ? new Date(row.ts).toISOString() : "";
  return {
    runId: row.runId,
    engagementId: row.targetId ?? row.runId,
    targetClass: row.targetClass,
    outcome: row.outcome,
    vulnsFound: row.vulnsFound,
    falsePositives: row.falsePositives,
    // Section 5 keeps one claims total and one tokens total per run, not the
    // confirmed-exploit count or the prompt/completion split.
    exploitsSucceeded: 0,
    exploitsAttempted: row.claimsTotal,
    steps: row.stepsCount,
    tokensIn: row.tokensTotal,
    tokensOut: 0,
    durationMs: 0,
    harness: { runnerVersion: row.harnessVersion, layerIds: row.layerSet, componentHashes: {} },
    startedAt: iso,
    finishedAt: iso,
  };
}

function toRecord(detail: RunDetail): TrajectoryRecord {
  const events: TrajectoryEvent[] = detail.steps.map((step) => ({
    ts: "",
    phase: step.role,
    actor: step.role,
    action: step.toolName ?? step.role,
    result: step.content,
    isToolCall: step.role === "tool",
  }));
  return { metrics: rowMetrics(detail.run), events };
}

export interface PairSelection {
  readonly pairs: readonly ContrastPair[];
  readonly notes: readonly string[];
  readonly positives: readonly RunRow[];
  readonly negatives: readonly RunRow[];
}

function byText(a: RunRow, b: RunRow): number {
  return a.runId.localeCompare(b.runId);
}

/** Rank runs by yield and greedily pair highest-yield vs lowest-yield of the class. */
export function selectPairs(store: Harness2Store, targetClass: string, maxPairs: number): PairSelection {
  const notes: string[] = [];
  const rows = store.listRuns({ targetClass, limit: RUN_SCAN_LIMIT });
  const aborted = rows.filter((row) => row.outcome === "aborted").length;
  if (aborted > 0) notes.push(`${aborted} aborted run(s) ignored: the kill switch is not a harness signal.`);
  const blocked = rows.filter((row) => row.outcome === "failure" && row.stepsCount === 0).length;
  if (blocked > 0) notes.push(`${blocked} zero-step failure(s) ignored: a run blocked before acting is not comparable.`);
  const positives = rows
    .filter((row) => (row.outcome === "success" || row.outcome === "partial") && row.vulnsFound > 0)
    .sort((a, b) => b.vulnsFound - a.vulnsFound || b.claimsTotal - a.claimsTotal || a.stepsCount - b.stepsCount || byText(a, b))
    .slice(0, maxPairs);
  const negatives = rows
    .filter((row) => row.outcome !== "aborted" && row.stepsCount > 0 && (row.outcome === "failure" || row.outcome === "partial"))
    .sort(
      (a, b) =>
        a.vulnsFound - b.vulnsFound ||
        (a.outcome === "failure" ? 0 : 1) - (b.outcome === "failure" ? 0 : 1) ||
        a.claimsTotal - b.claimsTotal ||
        byText(a, b),
    );
  if (positives.length === 0) notes.push("no positive run with a confirmed finding: nothing to contrast yet.");
  if (negatives.length === 0) notes.push("no comparable negative run (needs an at-least-one-step failure/partial run on this class).");
  const pairs: ContrastPair[] = [];
  const contrasted: RunRow[] = [];
  const used = new Set<string>();
  let cursor = 0;
  for (const positive of positives) {
    if (pairs.length >= maxPairs) break;
    let negative: RunRow | undefined;
    while (cursor < negatives.length) {
      const candidate = negatives[cursor];
      cursor += 1;
      if (candidate === undefined || candidate.runId === positive.runId || used.has(candidate.runId)) continue;
      if (positive.vulnsFound <= candidate.vulnsFound) {
        notes.push(`no further contrast: the next lowest-yield run (${candidate.runId}) is not below positive run ${positive.runId}.`);
        cursor = negatives.length;
        break;
      }
      negative = candidate;
      break;
    }
    if (negative === undefined) break;
    const positiveDetail = store.getRun(positive.runId);
    const negativeDetail = store.getRun(negative.runId);
    if (positiveDetail === null || negativeDetail === null) continue;
    pairs.push({ positive: toRecord(positiveDetail), negative: toRecord(negativeDetail) });
    used.add(positive.runId);
    used.add(negative.runId);
    contrasted.push(negative);
  }
  const layerKey = (layerIds: readonly string[]): string => [...layerIds].sort().join(",");
  pairs.forEach((pair, pairIndex) => {
    const positiveLayers = layerKey(pair.positive.metrics.harness.layerIds);
    const negativeLayers = layerKey(pair.negative.metrics.harness.layerIds);
    if (positiveLayers !== negativeLayers) {
      notes.push(
        `pair ${pairIndex + 1}: layer sets differ (positive [${positiveLayers || "base"}] vs negative [${negativeLayers || "base"}]); allowed, but not layer-controlled.`,
      );
    }
  });
  return { pairs, notes, positives, negatives: contrasted };
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
}

/** Aggregate per-class metrics: class means, the positive pool means, and the contrasted negatives. */
export function buildMetrics(rows: readonly RunRow[], positives: readonly RunRow[], negatives: readonly RunRow[]): Record<string, number> {
  return {
    runs: rows.length,
    successRate: average(rows.map((row) => (row.outcome === "success" ? 1 : 0))),
    positiveRuns: positives.length,
    negativeRuns: negatives.length,
    vulnsFoundMean: average(rows.map((row) => row.vulnsFound)),
    falsePositivesMean: average(rows.map((row) => row.falsePositives)),
    claimsTotalMean: average(rows.map((row) => row.claimsTotal)),
    stepsMean: average(rows.map((row) => row.stepsCount)),
    tokensTotalMean: average(rows.map((row) => row.tokensTotal)),
    positiveVulnsMean: average(positives.map((row) => row.vulnsFound)),
    positiveStepsMean: average(positives.map((row) => row.stepsCount)),
    negativeVulnsMean: average(negatives.map((row) => row.vulnsFound)),
    negativeStepsMean: average(negatives.map((row) => row.stepsCount)),
  };
}
