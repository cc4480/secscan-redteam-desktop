/**
 * H2-P2 section 8 + 9: composite scoring, acceptance gate, pair selection.
 *
 * Covers: the six metrics and their derivations, the composite formula and its
 * zero-baseline rule, run-level S, every gate condition (including its exact
 * boundary), the ADOPT/REJECT/INSUFFICIENT_DATA precedence, held-out leakage
 * detection, target normalization, and section-9 window/quartile/cold-start
 * pair selection with the store's RunRow shape.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Harness2Paths, RunMetrics } from "../src/harness2/contract.js";
import {
  baselineRatio,
  compositeScore,
  computeMetrics,
  evaluateGate,
  findLeakage,
  fromRunMetrics,
  MIN_HELD_OUT_TARGETS,
  runScore,
  targetKey,
  type EvalRun,
  type MetricSet,
} from "../src/harness2/scoring.js";
import { openHarness2Store, type Harness2Store, type RunBundle } from "../src/harness2/store.js";
import { MAX_PAIRS, MIN_USABLE_RUNS, selectPairs, WINDOW_SIZE } from "../src/harness2/pair-select.js";
import type { PairRun } from "../src/harness2/pair-runs.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function evalRun(over: Partial<EvalRun> = {}): EvalRun {
  return {
    runId: "run",
    targetId: "t.example.test",
    targetSubclass: "lab",
    failureMode: "none",
    success: false,
    vulnsFound: 0,
    claimsTotal: 0,
    falsePositives: 0,
    steps: 10,
    tokens: 100,
    crashed: false,
    ...over,
  };
}

function metricSet(over: Partial<MetricSet> = {}): MetricSet {
  return {
    n: 8,
    successes: 4,
    claimsTotal: 8,
    falsePositives: 2,
    crashed: 1,
    sr: 0.5,
    vf: 1,
    fpr: 0.25,
    steps: 10,
    tok: 1000,
    cr: 0.125,
    ...over,
  };
}

const HELD_OUT = Array.from({ length: 8 }, (_, index) => `h${index + 1}.example.test`);

function gate(over: {
  base?: Partial<MetricSet>;
  candidate?: Partial<MetricSet>;
  heldOut?: readonly string[];
  training?: readonly string[];
  logGap?: string;
} = {}) {
  return evaluateGate({
    base: metricSet(over.base),
    candidate: metricSet(over.candidate),
    heldOutTargets: over.heldOut ?? HELD_OUT,
    trainingTargets: over.training ?? ["seed.example.test"],
    logGap: over.logGap,
  });
}

function tempPaths(prefix: string): Harness2Paths {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, database: join(root, "harness2.db"), layers: join(root, "layers"), experience: join(root, "experience"), runs: join(root, "runs") };
}

let runSequence = 0;
function pairRun(over: Partial<PairRun> = {}): PairRun {
  runSequence += 1;
  const id = String(runSequence).padStart(3, "0");
  return {
    runId: `run-${id}`,
    ts: 1_000_000_000 + runSequence * 1000,
    targetClass: "wordpress",
    targetSubclass: "lab-a",
    harnessVersion: "h-current",
    outcome: "success",
    success: true,
    vulnsFound: 3,
    claimsTotal: 3,
    falsePositives: 0,
    stepsCount: 5,
    tokensTotal: 100,
    crashed: false,
    failureMode: "none",
    ...over,
  };
}

function bundle(over: Partial<RunBundle> = {}): RunBundle {
  return {
    runId: "stored-run",
    ts: 1_700_000_000_000,
    targetClass: "wordpress",
    targetSubclass: "lab-a",
    targetId: "stored.example.test",
    harnessVersion: "h-current",
    layerSet: [],
    success: false,
    vulnsFound: 0,
    claimsTotal: 0,
    falsePositives: 0,
    stepsCount: 10,
    tokensTotal: 100,
    crashed: false,
    failureMode: "timeout",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Six metrics
// ---------------------------------------------------------------------------

describe("section-8 metrics", () => {
  it("computes SR, VF, FPR, STEPS, TOK and CR from a mixed run set", () => {
    const runs = [
      evalRun({ success: true, vulnsFound: 2, claimsTotal: 2, steps: 10, tokens: 100 }),
      evalRun({ success: true, vulnsFound: 1, claimsTotal: 2, falsePositives: 1, steps: 20, tokens: 200 }),
      evalRun({ success: false, vulnsFound: 0, claimsTotal: 0, steps: 30, tokens: 300 }),
      evalRun({ success: false, vulnsFound: 1, claimsTotal: 3, falsePositives: 2, steps: 40, tokens: 400, crashed: true }),
    ];
    const metrics = computeMetrics(runs);
    assert.equal(metrics.n, 4);
    assert.equal(metrics.successes, 2);
    assert.equal(metrics.sr, 0.5);
    assert.equal(metrics.vf, 1);
    assert.equal(metrics.claimsTotal, 7);
    assert.equal(metrics.falsePositives, 3);
    assert.ok(Math.abs(metrics.fpr - 3 / 7) < 1e-9, "FPR is false positives / total claims");
    assert.equal(metrics.steps, 25);
    assert.equal(metrics.tok, 250);
    assert.equal(metrics.crashed, 1);
    assert.equal(metrics.cr, 0.25);
  });

  it("returns an all-zero set for no runs", () => {
    const metrics = computeMetrics([]);
    assert.deepEqual(metrics, { n: 0, successes: 0, claimsTotal: 0, falsePositives: 0, crashed: 0, sr: 0, vf: 0, fpr: 0, steps: 0, tok: 0, cr: 0 });
  });

  it("maps a contract RunMetrics into the scoring shape", () => {
    const metrics: RunMetrics = {
      runId: "r1",
      engagementId: "t.example.test",
      targetClass: "wordpress",
      outcome: "success",
      vulnsFound: 2,
      falsePositives: 1,
      exploitsSucceeded: 1,
      exploitsAttempted: 2,
      steps: 7,
      tokensIn: 30,
      tokensOut: 12,
      durationMs: 5,
      harness: { runnerVersion: "test", layerIds: [], componentHashes: {} },
      startedAt: "2026-10-18T00:00:00.000Z",
      finishedAt: "2026-10-18T00:00:01.000Z",
    };
    const run = fromRunMetrics(metrics);
    assert.equal(run.claimsTotal, 3);
    assert.equal(run.tokens, 42);
    assert.equal(run.success, true);
    assert.equal(run.crashed, false);
    assert.equal(fromRunMetrics({ ...metrics, outcome: "aborted" }).crashed, true);
    assert.equal(fromRunMetrics({ ...metrics, outcome: "failure", vulnsFound: 0 }).failureMode, "missed-vuln");
  });
});

// ---------------------------------------------------------------------------
// Composite score
// ---------------------------------------------------------------------------

describe("section-8 composite score", () => {
  it("applies S = 0.45*SR - 0.30*FPR - 0.15*TOK/TOKb - 0.10*STEPS/STEPSb", () => {
    const base = metricSet({ sr: 0.5, fpr: 0.2, steps: 10, tok: 1000 });
    const candidate = metricSet({ sr: 0.75, fpr: 0.1, steps: 10, tok: 1000 });
    // 0.45*0.75 - 0.30*0.1 - 0.15*1 - 0.10*1 = 0.0575
    assert.equal(compositeScore(candidate, base), 0.0575);
    // base scored against itself normalises both cost terms to 1: -.085.
    assert.equal(compositeScore(base, base), -0.085);
  });

  it("penalises cost regressions through the base ratios", () => {
    const base = metricSet({ sr: 0.5, fpr: 0, steps: 10, tok: 1000 });
    const cheaper = compositeScore(metricSet({ sr: 0.5, fpr: 0, steps: 5, tok: 500 }), base);
    const dearer = compositeScore(metricSet({ sr: 0.5, fpr: 0, steps: 20, tok: 2000 }), base);
    assert.ok(cheaper > dearer, "fewer tokens/steps scores higher");
  });

  it("treats a zero baseline as neutral, never NaN", () => {
    assert.equal(baselineRatio(0, 0), 0);
    assert.equal(baselineRatio(5, 0), 1);
    assert.equal(baselineRatio(5, 10), 0.5);
    const base = metricSet({ tok: 0, steps: 0 });
    assert.ok(Number.isFinite(compositeScore(metricSet({ tok: 0, steps: 0 }), base)));
  });

  it("scores a run with the window means as cost baselines", () => {
    const baselines = { tok: 100, steps: 10 };
    const good = runScore(evalRun({ success: true, vulnsFound: 2, claimsTotal: 2, steps: 5, tokens: 50 }), baselines);
    const bad = runScore(evalRun({ success: false, vulnsFound: 0, claimsTotal: 2, falsePositives: 2, steps: 20, tokens: 200 }), baselines);
    assert.ok(good > bad);
  });
});

// ---------------------------------------------------------------------------
// Leakage
// ---------------------------------------------------------------------------

describe("held-out leakage", () => {
  it("normalizes schemes, ports, paths, userinfo and case", () => {
    assert.equal(targetKey("https://Shop.Example.TEST:8443/x?y=1"), "shop.example.test");
    assert.equal(targetKey("shop.example.test."), "shop.example.test");
    assert.equal(targetKey("user@shop.example.test"), "shop.example.test");
    assert.equal(targetKey(""), "");
  });

  it("detects a held-out target that appears in the proposal's trajectories", () => {
    assert.deepEqual(findLeakage(["h1.example.test"], ["https://H1.example.test/lab"]), ["h1.example.test"]);
    assert.deepEqual(findLeakage(["h2.example.test"], ["h1.example.test"]), []);
  });
});

// ---------------------------------------------------------------------------
// Acceptance gate
// ---------------------------------------------------------------------------

describe("section-8 acceptance gate", () => {
  it("ADOPTs only when all five conditions hold", () => {
    const result = gate({ candidate: { sr: 0.6, fpr: 0.1, steps: 10, tok: 1000, cr: 0 } });
    assert.equal(result.verdict, "ADOPT");
    assert.equal(result.conditions.length, 5);
    assert.deepEqual(result.conditions.map((condition) => condition.passed), [true, true, true, true, true]);
    assert.equal(result.score.delta > 0, true);
  });

  it("REJECTs when the outcome lift condition fails", () => {
    const result = gate({ candidate: { sr: 0.5, vf: 1, fpr: 0.25, steps: 10, tok: 1000, cr: 0.125 } });
    assert.equal(result.verdict, "REJECT");
    assert.equal(result.conditions[1]!.passed, false);
  });

  it("accepts the VF x1.10 alternative when SR does not lift", () => {
    const result = gate({ base: { sr: 0.6, vf: 1, fpr: 0.1 }, candidate: { sr: 0.6, vf: 1.1, fpr: 0.1, cr: 0.125 } });
    assert.equal(result.conditions[1]!.passed, true);
    assert.equal(result.verdict, "ADOPT");
  });

  it("rejects a VF lift that also worsens FPR", () => {
    const result = gate({ base: { sr: 0.6, vf: 1, fpr: 0.1 }, candidate: { sr: 0.6, vf: 1.5, fpr: 0.12, cr: 0.125 } });
    assert.equal(result.conditions[1]!.passed, false);
    assert.equal(result.verdict, "REJECT");
  });

  it("rejects a false-positive regression worse than +0.02 even with a lift", () => {
    const result = gate({ candidate: { sr: 0.9, fpr: 0.28 } });
    assert.equal(result.conditions[2]!.passed, false);
    assert.equal(result.verdict, "REJECT");
  });

  it("rejects a cost regression above 1.25x", () => {
    const result = gate({ candidate: { sr: 0.9, fpr: 0.1, tok: 1251, steps: 10 } });
    assert.equal(result.conditions[3]!.passed, false);
    const fast = gate({ candidate: { sr: 0.9, fpr: 0.1, tok: 1000, steps: 12.6 } });
    assert.equal(fast.conditions[3]!.passed, false);
  });

  it("rejects a crash-rate regression", () => {
    const result = gate({ candidate: { sr: 0.9, fpr: 0.1, cr: 0.25 } });
    assert.equal(result.conditions[4]!.passed, false);
    assert.equal(result.verdict, "REJECT");
  });

  it("accepts every threshold exactly at its boundary", () => {
    // SR base 0.5 -> 0.55; FPR base 0.25 -> 0.27; TOK/STEPS exactly 1.25x; CR equal.
    const result = gate({ candidate: { sr: 0.55, fpr: 0.27, tok: 1250, steps: 12.5, cr: 0.125 } });
    assert.deepEqual(result.conditions.map((condition) => condition.passed), [true, true, true, true, true]);
    assert.equal(result.verdict, "ADOPT");
  });

  it("reports INSUFFICIENT_DATA for fewer than 8 held-out targets", () => {
    const result = gate({ heldOut: HELD_OUT.slice(0, MIN_HELD_OUT_TARGETS - 1) });
    assert.equal(result.verdict, "INSUFFICIENT_DATA");
    assert.equal(result.conditions[0]!.passed, false);
  });

  it("reports INSUFFICIENT_DATA for a log gap", () => {
    const result = gate({ logGap: "candidate run 3 has no metrics row" });
    assert.equal(result.verdict, "INSUFFICIENT_DATA");
  });

  it("REJECTs a leaked held-out set before looking at metrics", () => {
    const result = gate({ training: ["h3.example.test"], candidate: { sr: 0.9, fpr: 0.1 } });
    assert.equal(result.verdict, "REJECT");
    assert.deepEqual(result.overlap, ["h3.example.test"]);
    assert.equal(result.conditions[0]!.passed, false);
  });
});

// ---------------------------------------------------------------------------
// Section 9: window
// ---------------------------------------------------------------------------

describe("section-9 window", () => {
  it("takes the most recent 50 usable runs of the current harness version", () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      pairRun({ ts: 2_000_000 + index * 1000, harnessVersion: "h-current", runId: `cur-${index}` }),
    ).concat([pairRun({ ts: 9_999_999, harnessVersion: "h-old", runId: "old-newest" })]);
    const selection = selectPairs({ rows, harnessVersion: "h-current" });
    assert.equal(selection.windowMethod, "harness-version");
    assert.equal(selection.windowSize, WINDOW_SIZE);
    assert.equal(selection.window.runs.some((run) => run.runId === "old-newest"), false);
    // The 50 newest of the current version: cur-10 .. cur-59.
    assert.equal(selection.window.runs.some((run) => run.runId === "cur-9"), false);
    assert.equal(selection.window.runs.some((run) => run.runId === "cur-10"), true);
  });

  it("falls back to 90 days when the current version has fewer than 10 usable runs", () => {
    const now = 4_000_000_000_000;
    const day = 86_400_000;
    const rows = [
      pairRun({ ts: now - day, harnessVersion: "h-current", runId: "cur-1" }),
      pairRun({ ts: now - day, harnessVersion: "h-current", runId: "cur-2" }),
      pairRun({ ts: now - day, harnessVersion: "h-current", runId: "cur-3" }),
      pairRun({ ts: now - 2 * day, harnessVersion: "h-old", runId: "old-1" }),
      pairRun({ ts: now - 3 * day, harnessVersion: "h-old", runId: "old-2" }),
      pairRun({ ts: now - 200 * day, harnessVersion: "h-old", runId: "ancient" }),
    ];
    const selection = selectPairs({ rows, harnessVersion: "h-current", nowMs: now });
    assert.equal(selection.windowMethod, "fallback-90d");
    assert.equal(selection.windowSize, 5);
    assert.equal(selection.window.runs.some((run) => run.runId === "ancient"), false);
  });

  it("excludes crashed and zero-step runs from the window", () => {
    const rows = [
      pairRun({ runId: "ok-1" }),
      pairRun({ runId: "ok-2" }),
      pairRun({ runId: "ok-3" }),
      pairRun({ runId: "ok-4" }),
      pairRun({ runId: "crashed", crashed: true, outcome: "aborted" }),
      pairRun({ runId: "zero-step", stepsCount: 0 }),
    ];
    const selection = selectPairs({ rows, harnessVersion: "h-current" });
    assert.equal(selection.windowSize, 4);
    assert.deepEqual(selection.window.runs.map((run) => run.runId).sort(), ["ok-1", "ok-2", "ok-3", "ok-4"]);
  });

  it("accepts store rows structurally (RunRow from the section-5 store)", () => {
    const paths = tempPaths("h2-pairs-store-");
    const store: Harness2Store = openHarness2Store(paths);
    try {
      for (let index = 0; index < 6; index++) {
        store.upsertRows(
          bundle({
            runId: `stored-${index}`,
            ts: 1_700_000_000_000 + index * 1000,
            success: index < 3,
            failureMode: index < 3 ? "none" : "missed-vuln",
          }),
          [],
        );
      }
      const rows = store.listRuns({ targetClass: "wordpress", limit: 50 });
      const selection = selectPairs({ rows, harnessVersion: "h-current" });
      assert.equal(selection.mode, "REPAIR");
      assert.equal(selection.windowSize, 6);
      assert.equal(selection.criteria.some((line) => line.startsWith("window:")), true);
    } finally {
      store.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Section 9: cold start
// ---------------------------------------------------------------------------

describe("section-9 cold start", () => {
  it("reports INSUFFICIENT_DATA and no pairs under 4 usable runs", () => {
    const rows = Array.from({ length: MIN_USABLE_RUNS - 1 }, (_, index) => pairRun({ runId: `few-${index}` }));
    const selection = selectPairs({ rows, harnessVersion: "h-current" });
    assert.equal(selection.mode, "INSUFFICIENT_DATA");
    assert.deepEqual(selection.pairs, []);
    assert.deepEqual(selection.representativeRunIds, []);
    assert.match(selection.modeReason, /at least 4 are needed/);
  });

  it("HARDENs an all-pass window with fastest, median and slowest runs by tokens", () => {
    const rows = [
      pairRun({ runId: "t-300", tokensTotal: 300 }),
      pairRun({ runId: "t-100", tokensTotal: 100 }),
      pairRun({ runId: "t-400", tokensTotal: 400 }),
      pairRun({ runId: "t-200", tokensTotal: 200 }),
    ];
    const selection = selectPairs({ rows, harnessVersion: "h-current" });
    assert.equal(selection.mode, "HARDEN");
    assert.deepEqual(selection.pairs, [], "HARDEN cites successful runs, not contrasted pairs");
    assert.deepEqual(selection.representativeRunIds, ["t-100", "t-200", "t-400"]);
    assert.match(selection.modeReason, /cite three successful runs/);
  });

  it("REPAIR-FOUNDATIONs an all-fail window with distinct failure modes", () => {
    const rows = [
      pairRun({ runId: "f-1", success: false, outcome: "failure", failureMode: "missed-vuln" }),
      pairRun({ runId: "f-2", success: false, outcome: "failure", failureMode: "missed-vuln" }),
      pairRun({ runId: "f-3", success: false, outcome: "failure", failureMode: "timeout" }),
      pairRun({ runId: "f-4", success: false, outcome: "failure", failureMode: "tool-error" }),
      pairRun({ runId: "f-5", success: false, outcome: "failure", failureMode: "fp-blowup" }),
    ];
    const selection = selectPairs({ rows, harnessVersion: "h-current" });
    assert.equal(selection.mode, "REPAIR-FOUNDATION");
    assert.deepEqual(selection.pairs, []);
    assert.equal(selection.representativeRunIds.length, 3);
    const modes = selection.representativeRunIds.map((runId) => rows.find((run) => run.runId === runId)!.failureMode);
    assert.equal(new Set(modes).size, 3, `distinct failure modes, got ${modes.join(",")}`);
  });
});

// ---------------------------------------------------------------------------
// Section 9: pairs
// ---------------------------------------------------------------------------

describe("section-9 contrasted pairs", () => {
  function repairRows(): PairRun[] {
    const good = Array.from({ length: 6 }, (_, index) =>
      pairRun({ runId: `good-${index}`, targetSubclass: "shop", tokensTotal: 100, stepsCount: 5, vulnsFound: 3, claimsTotal: 3 }),
    );
    const modes = ["missed-vuln", "fp-blowup", "timeout", "missed-vuln", "fp-blowup", "timeout"];
    const bad = Array.from({ length: 6 }, (_, index) =>
      pairRun({
        runId: `bad-${index}`,
        targetSubclass: index % 2 === 0 ? "shop" : "blog",
        ts: 2_000_000_000 + index * 1000,
        success: false,
        outcome: "failure",
        failureMode: modes[index]!,
        vulnsFound: 0,
        claimsTotal: 2,
        falsePositives: 2,
        tokensTotal: 500,
        stepsCount: 50,
      }),
    );
    return [...good, ...bad];
  }

  it("forms up to 3 Q1-high vs Q4-low disjoint pairs with distinct failure modes", () => {
    const rows = repairRows();
    const selection = selectPairs({ rows, harnessVersion: "h-current" });
    assert.equal(selection.mode, "REPAIR");
    assert.equal(selection.pairs.length, MAX_PAIRS);
    const quartileOf = new Map(selection.scored.map((entry) => [entry.run.runId, entry.quartile]));
    const scoreOf = new Map(selection.scored.map((entry) => [entry.run.runId, entry.score]));
    const used = new Set<string>();
    for (const pair of selection.pairs) {
      assert.equal(quartileOf.get(pair.high.runId), 1, `${pair.high.runId} comes from Q1`);
      assert.equal(quartileOf.get(pair.low.runId), 4, `${pair.low.runId} comes from Q4`);
      assert.ok(scoreOf.get(pair.high.runId)! > scoreOf.get(pair.low.runId)!, "high S is strictly above low S");
      assert.equal(pair.scoreGap > 0, true);
      assert.equal(used.has(pair.high.runId), false);
      assert.equal(used.has(pair.low.runId), false);
      used.add(pair.high.runId);
      used.add(pair.low.runId);
      assert.equal(pair.source, "quartile");
    }
    assert.equal(selection.failureModeCoverage.length, 3, "distinct failure_mode across pairs");
    assert.match(selection.quartileMethod, /Q1 = top ceil\(n\/4\)/);
    assert.equal(selection.representativeRunIds.length, MAX_PAIRS * 2);
  });

  it("prefers the same target_subclass inside a pair", () => {
    const rows = [
      pairRun({ runId: "g-shop", targetSubclass: "shop", tokensTotal: 50 }),
      pairRun({ runId: "g-blog", targetSubclass: "blog", tokensTotal: 60 }),
      pairRun({ runId: "g-shop-2", targetSubclass: "shop", tokensTotal: 70 }),
      pairRun({ runId: "g-blog-2", targetSubclass: "blog", tokensTotal: 80 }),
      pairRun({ runId: "b-shop", targetSubclass: "shop", success: false, outcome: "failure", failureMode: "timeout", tokensTotal: 500, stepsCount: 50, claimsTotal: 2, falsePositives: 2, vulnsFound: 0 }),
      pairRun({ runId: "b-blog", targetSubclass: "blog", success: false, outcome: "failure", failureMode: "timeout", tokensTotal: 600, stepsCount: 50, claimsTotal: 2, falsePositives: 2, vulnsFound: 0 }),
      pairRun({ runId: "b-shop-2", targetSubclass: "shop", success: false, outcome: "failure", failureMode: "missed-vuln", tokensTotal: 900, stepsCount: 60, claimsTotal: 2, falsePositives: 2, vulnsFound: 0 }),
      pairRun({ runId: "b-blog-2", targetSubclass: "blog", success: false, outcome: "failure", failureMode: "missed-vuln", tokensTotal: 800, stepsCount: 60, claimsTotal: 2, falsePositives: 2, vulnsFound: 0 }),
    ];
    const selection = selectPairs({ rows, harnessVersion: "h-current" });
    assert.equal(selection.mode, "REPAIR");
    assert.ok(selection.pairs.length >= 1);
    assert.equal(selection.pairs[0]!.sameSubclass, true, "a same-subclass combination exists and is preferred");
  });

  it("falls back to ranked pairings when a quartile pool runs out", () => {
    const good = Array.from({ length: 3 }, (_, index) => pairRun({ runId: `g-${index}`, tokensTotal: 100 + index * 10 }));
    const bad = Array.from({ length: 3 }, (_, index) =>
      pairRun({ runId: `b-${index}`, success: false, outcome: "failure", failureMode: "timeout", tokensTotal: 500 + index * 10, stepsCount: 50, claimsTotal: 2, falsePositives: 2, vulnsFound: 0 }),
    );
    // n=6: Q1=2, Q4=2 -> two quartile pairs; the remaining 2 runs are ranked-paired.
    const selection = selectPairs({ rows: [...good, ...bad], harnessVersion: "h-current" });
    assert.equal(selection.pairs.length, MAX_PAIRS);
    assert.deepEqual(selection.pairs.map((pair) => pair.source), ["quartile", "quartile", "fallback-ranked"]);
  });

  it("states the window, mode and criteria explicitly", () => {
    const selection = selectPairs({ rows: repairRows(), harnessVersion: "h-current" });
    const text = selection.criteria.join("\n");
    assert.match(text, /window: most recent 50 usable runs with harness_version=h-current/);
    assert.match(text, /0\.45\*SR - 0\.30\*FPR - 0\.15\*\(tokens\//);
    assert.match(text, /mode: REPAIR - /);
    assert.equal(typeof selection.modeReason, "string");
    assert.equal(selection.window.harnessVersion, "h-current");
  });
});
