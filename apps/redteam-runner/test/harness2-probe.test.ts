/**
 * H2-P2: patch-layer store + section-8 offline probe harness.
 *
 * Covers: layer install/list/read/remove round-trips, the ordered active
 * manifest and fail-closed composition, the pinned-guardrail refusal, the probe
 * refusing without an explicit targets file, the held-out-set rules (8 distinct
 * targets, no leakage from the section-5 store, log gaps), the five-condition
 * gate and every verdict, approval gating (propose-only by default), the token
 * budget, token accounting, the append-only verdict log, candidate staging +
 * cleanup, probe-run ingest into the section-5 store, the probe report, and the
 * runner seam refusing to fake a layer mount.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Harness2Paths, PatchLayer, Proposal, RunMetrics } from "../src/harness2/contract.js";
import {
  activeLayerIds,
  checkLayerGuardrails,
  composeActiveLayers,
  installLayer,
  listLayers,
  readLayer,
  removeLayer,
  setActiveLayers,
} from "../src/harness2/layers.js";
import { DEFAULT_TOKEN_BUDGET, VERDICTS_FILE, type VerdictLogRecord } from "../src/harness2/probe-verdict.js";
import { loadProbeTargets, probeProposal, type ProbeRunFn, type ProbeRunInput } from "../src/harness2/probe.js";
import { createRunnerProbeSeam, probeCommand, proposeCommand } from "../src/harness2/probe-cli.js";
import { MIN_HELD_OUT_TARGETS } from "../src/harness2/scoring.js";
import { openHarness2Store, type Harness2Store, type RunBundle } from "../src/harness2/store.js";

function tempPaths(prefix: string): Harness2Paths {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    database: join(root, "harness2.db"),
    layers: join(root, "layers"),
    experience: join(root, "experience"),
    runs: join(root, "runs"),
  };
}

function sampleLayer(overrides: Partial<PatchLayer> = {}): PatchLayer {
  return {
    id: "layer-prompt-v1",
    targetClass: "wordpress",
    yaml: "- id: recon-system-prompt\n  config:\n    section: lean\n",
    adoptedAt: "2026-10-18T00:00:00.000Z",
    evidenceRunId: "probe-run-1",
    ...overrides,
  };
}

function sampleProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "layer-prompt-v1",
    targetClass: "wordpress",
    component: "system-prompt",
    yaml: "- id: recon-system-prompt\n  config:\n    section: lean\n",
    rationale: "fewer planner steps on recon without losing findings",
    ...overrides,
  };
}

function sampleMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    runId: "run-1",
    engagementId: "eng-1",
    targetClass: "wordpress",
    outcome: "partial",
    vulnsFound: 1,
    falsePositives: 0,
    exploitsSucceeded: 1,
    exploitsAttempted: 2,
    steps: 5,
    tokensIn: 100,
    tokensOut: 50,
    durationMs: 1000,
    harness: { runnerVersion: "test", layerIds: [], componentHashes: {} },
    startedAt: "2026-10-18T00:00:00.000Z",
    finishedAt: "2026-10-18T00:00:01.000Z",
    ...overrides,
  };
}

/** A section-5 store with one stored training run, the leakage reference. */
function openStoreWithTraining(paths: Harness2Paths, overrides: Partial<RunBundle> = {}): Harness2Store {
  const store = openHarness2Store(paths);
  store.upsertRows(
    {
      runId: "training-run",
      ts: 1_700_000_000_000,
      targetClass: "wordpress",
      targetSubclass: "lab",
      targetId: "seed.example.test",
      harnessVersion: "test",
      layerSet: [],
      success: false,
      vulnsFound: 0,
      claimsTotal: 0,
      falsePositives: 0,
      stepsCount: 12,
      tokensTotal: 900,
      crashed: false,
      failureMode: "missed-vuln",
      ...overrides,
    },
    [],
  );
  return store;
}

function writeTargetsFile(paths: Harness2Paths, count = MIN_HELD_OUT_TARGETS): string {
  mkdirSync(paths.runs, { recursive: true });
  const file = join(paths.runs, "probe-targets.json");
  const targets = Array.from({ length: count }, (_, index) => {
    const host = `heldout-${index + 1}.example.test`;
    return {
      target: host,
      mode: "red",
      objective: "probe the candidate harness on a lab target",
      roe: { scope: [host] },
      targetClass: "wordpress",
    };
  });
  writeFileSync(file, JSON.stringify(targets));
  return file;
}

interface SeamCalls {
  readonly calls: { input: ProbeRunInput; layerIds: readonly string[] }[];
  readonly runEngagement: ProbeRunFn;
}

function fakeSeam(result: (input: ProbeRunInput, layerIds: readonly string[]) => RunMetrics, onCall?: (input: ProbeRunInput) => void): SeamCalls {
  const calls: { input: ProbeRunInput; layerIds: readonly string[] }[] = [];
  return {
    calls,
    runEngagement: async (input, layerIds) => {
      calls.push({ input, layerIds: [...layerIds] });
      onCall?.(input);
      return result(input, layerIds);
    },
  };
}

/** Base partial / candidate success: a clean ADOPT at every gate condition. */
function improvedBySide(input: ProbeRunInput): RunMetrics {
  return input.side === "candidate"
    ? sampleMetrics({ outcome: "success", vulnsFound: 3, falsePositives: 0, steps: 10, tokensIn: 120, tokensOut: 60 })
    : sampleMetrics({ outcome: "partial", vulnsFound: 1, falsePositives: 1, steps: 10, tokensIn: 200, tokensOut: 100 });
}

function readVerdictLog(paths: Harness2Paths): VerdictLogRecord[] {
  const path = join(paths.root, VERDICTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as VerdictLogRecord);
}

// ---------------------------------------------------------------------------
// Layer store
// ---------------------------------------------------------------------------

describe("patch-layer store", () => {
  it("installs, lists and reads one layer atomically", () => {
    const paths = tempPaths("h2-layers-");
    const layer = sampleLayer();
    const installed = installLayer(paths, layer, { installedAt: "2026-10-18T00:00:01.000Z" });
    assert.equal(installed.layerPath, join(paths.layers, layer.id, "layer.yml"));
    assert.equal(installed.metaPath, join(paths.layers, layer.id, "meta.json"));
    assert.deepEqual(listLayers(paths), [{ ...layer }]);
    const read = readLayer(paths, layer.id)!;
    assert.equal(read.id, layer.id);
    assert.equal(read.targetClass, "wordpress");
    assert.equal(read.adoptedAt, layer.adoptedAt);
    assert.equal(read.evidenceRunId, layer.evidenceRunId);
    const meta = JSON.parse(readFileSync(installed.metaPath, "utf8")) as Record<string, unknown>;
    assert.equal(meta["installedAt"], "2026-10-18T00:00:01.000Z");
    assert.match(meta["sha256"] as string, /^[0-9a-f]{64}$/);
    assert.equal(readLayer(paths, "missing-layer"), null);
  });

  it("refuses to overwrite an installed layer without force", () => {
    const paths = tempPaths("h2-layers-force-");
    installLayer(paths, sampleLayer());
    assert.throws(() => installLayer(paths, sampleLayer({ yaml: "- id: changed\n" })), /already installed/);
    installLayer(paths, sampleLayer({ yaml: "- id: changed\n" }), { force: true });
    assert.match(readLayer(paths, "layer-prompt-v1")!.yaml, /changed/);
  });

  it("keeps the ordered active manifest and composes its layers in order", () => {
    const paths = tempPaths("h2-layers-active-");
    installLayer(paths, sampleLayer({ id: "a-layer" }));
    installLayer(paths, sampleLayer({ id: "b-layer" }));
    assert.deepEqual(activeLayerIds(paths), []);
    assert.deepEqual(composeActiveLayers(paths), []);
    assert.deepEqual(setActiveLayers(paths, ["b-layer", "a-layer"]), ["b-layer", "a-layer"]);
    assert.deepEqual(activeLayerIds(paths), ["b-layer", "a-layer"]);
    assert.deepEqual(
      composeActiveLayers(paths).map((layer) => layer.id),
      ["b-layer", "a-layer"],
      "mount order is the manifest order",
    );
    assert.throws(() => setActiveLayers(paths, ["ghost-layer"]), /not installed/);
  });

  it("fails closed when the manifest references a layer that no longer exists", () => {
    const paths = tempPaths("h2-layers-dangling-");
    mkdirSync(paths.layers, { recursive: true });
    writeFileSync(join(paths.layers, "active.json"), JSON.stringify({ layerIds: ["ghost"], updatedAt: "t" }));
    assert.throws(() => composeActiveLayers(paths), /missing layer "ghost"/);
  });

  it("removes a layer (rollback) and drops it from the manifest", () => {
    const paths = tempPaths("h2-layers-remove-");
    installLayer(paths, sampleLayer({ id: "a-layer" }));
    installLayer(paths, sampleLayer({ id: "b-layer" }));
    setActiveLayers(paths, ["a-layer", "b-layer"]);
    assert.equal(removeLayer(paths, "a-layer"), true);
    assert.deepEqual(listLayers(paths).map((layer) => layer.id), ["b-layer"]);
    assert.deepEqual(activeLayerIds(paths), ["b-layer"]);
    assert.equal(removeLayer(paths, "a-layer"), false);
  });

  it("detects a tampered layer document through meta.json", () => {
    const paths = tempPaths("h2-layers-tamper-");
    const installed = installLayer(paths, sampleLayer());
    writeFileSync(installed.layerPath, "- id: tampered\n");
    assert.throws(() => readLayer(paths, "layer-prompt-v1"), /integrity check/);
  });

  it("refuses unsafe layer ids", () => {
    const paths = tempPaths("h2-layers-id-");
    for (const id of ["../escape", "a/b", ".hidden", "with space", ""]) {
      assert.throws(() => installLayer(paths, sampleLayer({ id })), /unsafe layer id/, id);
    }
  });
});

describe("patch-layer guardrail guard", () => {
  it("refuses YAML that targets a pinned guardrail path", () => {
    const paths = tempPaths("h2-layers-guard-");
    for (const yaml of ["- id: x\n  target: src/safety/halts.ts\n", "- target: src\\policy\\scope.ts\n", "- id: auth-gate\n"]) {
      assert.equal(checkLayerGuardrails(yaml).allowed, false, yaml);
      assert.throws(() => installLayer(paths, sampleLayer({ yaml })), /pinned guardrails/);
    }
    assert.equal(existsSync(join(paths.layers, "layer-prompt-v1")), false, "a refused layer writes nothing");
  });

  it("refuses a YAML row that targets the pinned guardrails component", () => {
    const yaml = "- id: secscan-redteam\n  component: guardrails\n  config: {}\n";
    assert.deepEqual(checkLayerGuardrails(yaml).pinned, ["guardrails"]);
    assert.throws(() => installLayer(tempPaths("h2-layers-comp-"), sampleLayer({ yaml })), /pinned guardrails/);
  });

  it("allows an ordinary editable-component layer", () => {
    assert.deepEqual(checkLayerGuardrails(sampleLayer().yaml), { allowed: true, pinned: [] });
  });
});

// ---------------------------------------------------------------------------
// Safety gates: explicit targets file + held-out set rules
// ---------------------------------------------------------------------------

describe("probe safety gates", () => {
  it("refuses to run without an explicit probe-targets file", async () => {
    const paths = tempPaths("h2-probe-notargets-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam(() => sampleMetrics());
      for (const targetsFile of [undefined, "", join(paths.root, "nope.json")]) {
        await assert.rejects(
          probeProposal({ paths, store, proposal: sampleProposal(), targetsFile, runEngagement: seam.runEngagement }),
          /probe-targets file/,
        );
      }
      assert.equal(seam.calls.length, 0, "no run may happen without a targets file");
    } finally {
      store.close();
    }
  });

  it("refuses an empty, non-list or invalid targets file", async () => {
    const paths = tempPaths("h2-probe-badtargets-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam(() => sampleMetrics());
      const file = writeTargetsFile(paths, 0);
      await assert.rejects(probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement }), /lists no targets/);
      writeFileSync(file, JSON.stringify({ target: "x" }));
      await assert.rejects(probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement }), /must be a JSON list/);
      writeFileSync(file, JSON.stringify([{ target: "x", roe: { scope: [] } }]));
      await assert.rejects(probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement }), /roe\.scope/);
      writeFileSync(file, "{not json");
      await assert.rejects(probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement }), /not valid JSON/);
      assert.equal(seam.calls.length, 0);
    } finally {
      store.close();
    }
  });

  it("loadProbeTargets exposes the gate the CLI relies on", () => {
    const paths = tempPaths("h2-probe-loadtargets-");
    assert.throws(() => loadProbeTargets(undefined), /explicit probe-targets file is required/);
    const targets = loadProbeTargets(writeTargetsFile(paths));
    assert.equal(targets.length, MIN_HELD_OUT_TARGETS);
    assert.equal(targets[0]!.target, "heldout-1.example.test");
  });

  it("refuses a proposal that targets the pinned guardrails", async () => {
    const paths = tempPaths("h2-probe-pinned-");
    const store = openStoreWithTraining(paths);
    try {
      const file = writeTargetsFile(paths);
      const seam = fakeSeam(() => sampleMetrics());
      await assert.rejects(
        probeProposal({ paths, store, proposal: sampleProposal({ component: "guardrails" }), targetsFile: file, runEngagement: seam.runEngagement }),
        /pinned guardrails component/,
      );
      await assert.rejects(
        probeProposal({ paths, store, proposal: sampleProposal({ yaml: "- target: src/safety/halts.ts\n" }), targetsFile: file, runEngagement: seam.runEngagement }),
        /pinned guardrails/,
      );
      assert.equal(seam.calls.length, 0);
    } finally {
      store.close();
    }
  });

  it("reports INSUFFICIENT_DATA without spending tokens under 8 held-out targets", async () => {
    const paths = tempPaths("h2-probe-fewtargets-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam(() => sampleMetrics());
      const verdict = await probeProposal({
        paths,
        store,
        proposal: sampleProposal(),
        targetsFile: writeTargetsFile(paths, MIN_HELD_OUT_TARGETS - 1),
        runEngagement: seam.runEngagement,
      });
      assert.equal(verdict.verdict, "INSUFFICIENT_DATA");
      assert.equal(verdict.adopted, false);
      assert.match(verdict.reason, /distinct held-out target/);
      assert.equal(seam.calls.length, 0, "the held-out rule is checked before any run");
      assert.equal(verdict.tokensSpent, 0);
      const log = readVerdictLog(paths);
      assert.equal(log.length, 1);
      assert.equal(log[0]!.verdict, "INSUFFICIENT_DATA");
      assert.equal(log[0]!.heldOut.n, 7);
    } finally {
      store.close();
    }
  });

  it("reports INSUFFICIENT_DATA (log gap) when the store has no runs for the class", async () => {
    const paths = tempPaths("h2-probe-log-gap-");
    const store = openHarness2Store(paths);
    try {
      const seam = fakeSeam(() => sampleMetrics());
      const verdict = await probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement });
      assert.equal(verdict.verdict, "INSUFFICIENT_DATA");
      assert.match(verdict.reason, /log gap/);
      assert.equal(seam.calls.length, 0);
    } finally {
      store.close();
    }
  });

  it("REJECTs a held-out set that leaks from the proposal's trajectories, before any run", async () => {
    const paths = tempPaths("h2-probe-leak-");
    const store = openStoreWithTraining(paths, { targetId: "heldout-3.example.test" });
    try {
      const seam = fakeSeam(() => sampleMetrics());
      const verdict = await probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement });
      assert.equal(verdict.verdict, "REJECT");
      assert.deepEqual(verdict.conditions[0]!.passed, false);
      assert.match(verdict.conditions[0]!.detail, /LEAKED: heldout-3\.example\.test/);
      assert.equal(seam.calls.length, 0);
      const log = readVerdictLog(paths);
      assert.equal(log[0]!.verdict, "REJECT");
      assert.deepEqual(log[0]!.heldOut.overlaps, ["heldout-3.example.test"]);
    } finally {
      store.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The gate, verdicts, approval, budget, logging
// ---------------------------------------------------------------------------

describe("section-8 probe verdict and approval gate", () => {
  it("ADOPTs a winning candidate only with explicit approval, logging all six metrics", async () => {
    const paths = tempPaths("h2-probe-adopt-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam(improvedBySide);
      const unapproved = await probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement });
      assert.equal(unapproved.verdict, "ADOPT");
      assert.equal(unapproved.adopted, false, "default is propose-only");
      assert.equal(unapproved.reason, "approval required");
      assert.equal(unapproved.baseRuns, 8);
      assert.equal(unapproved.candidateRuns, 8);
      assert.equal(unapproved.conditions.length, 5);
      assert.deepEqual(unapproved.conditions.map((condition) => condition.passed), [true, true, true, true, true]);
      assert.equal(unapproved.tokensSpent, 8 * 300 + 8 * 180, "tokensSpent sums every measured run");
      assert.equal(unapproved.base.sr, 0);
      assert.equal(unapproved.candidate.sr, 1);
      assert.equal(unapproved.base.fpr, 0.5);
      assert.equal(unapproved.candidate.fpr, 0);
      assert.equal(unapproved.base.tok, 300);
      assert.equal(unapproved.candidate.tok, 180);
      assert.equal(unapproved.deltas.vulnsFound, 2, "deltas keep positive-is-better semantics");

      const log = readVerdictLog(paths);
      assert.equal(log.length, 1);
      assert.equal(log[0]!.base.n, 8);
      assert.equal(log[0]!.base.sr, 0);
      assert.equal(log[0]!.candidate.sr, 1);
      assert.equal(log[0]!.base.fpr, 0.5);
      assert.equal(log[0]!.candidate.tok, 180);
      assert.equal(log[0]!.tokensSpent, unapproved.tokensSpent);
      assert.equal(log[0]!.tokenBudget, DEFAULT_TOKEN_BUDGET);
      assert.equal(log[0]!.conditions.length, 5);

      const approved = await probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement, approve: true });
      assert.equal(approved.verdict, "ADOPT");
      assert.equal(approved.adopted, true);
      assert.match(approved.reason, /^adopted: all five section-8 gate conditions hold/);
      assert.equal(readVerdictLog(paths).length, 2);
      assert.equal(readVerdictLog(paths)[1]!.adopted, true);
    } finally {
      store.close();
    }
  });

  it("REJECTs when the outcome lift condition fails, even with approval", async () => {
    const paths = tempPaths("h2-probe-nolift-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam(() => sampleMetrics());
      const verdict = await probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement, approve: true });
      assert.equal(verdict.verdict, "REJECT");
      assert.equal(verdict.adopted, false);
      assert.match(verdict.reason, /^rejected: outcome lift/);
      assert.equal(verdict.conditions[1]!.passed, false);
    } finally {
      store.close();
    }
  });

  it("REJECTs a cost regression above 1.25x", async () => {
    const paths = tempPaths("h2-probe-cost-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam((input) =>
        input.side === "candidate"
          ? sampleMetrics({ outcome: "success", vulnsFound: 3, steps: 10, tokensIn: 400, tokensOut: 50 })
          : sampleMetrics({ outcome: "partial", vulnsFound: 1, falsePositives: 1, steps: 10, tokensIn: 200, tokensOut: 100 }),
      );
      const verdict = await probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement, approve: true });
      assert.equal(verdict.verdict, "REJECT");
      assert.equal(verdict.conditions[3]!.passed, false);
      assert.match(verdict.reason, /cost guard/);
    } finally {
      store.close();
    }
  });

  it("REJECTs a crash-rate regression", async () => {
    const paths = tempPaths("h2-probe-crash-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam((input) => {
        if (input.side === "candidate" && input.targetIndex === 0) return sampleMetrics({ outcome: "aborted" });
        return improvedBySide(input);
      });
      const verdict = await probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement, approve: true });
      assert.equal(verdict.verdict, "REJECT");
      assert.equal(verdict.conditions[4]!.passed, false);
      assert.equal(verdict.candidate.cr, 1 / 8);
    } finally {
      store.close();
    }
  });

  it("stops on the token budget and reports INSUFFICIENT_DATA with the budget logged", async () => {
    const paths = tempPaths("h2-probe-budget-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam(() => sampleMetrics({ tokensIn: 200, tokensOut: 100 }));
      const verdict = await probeProposal({
        paths,
        store,
        proposal: sampleProposal(),
        targetsFile: writeTargetsFile(paths),
        runEngagement: seam.runEngagement,
        tokenBudget: 100,
      });
      assert.equal(verdict.verdict, "INSUFFICIENT_DATA");
      assert.match(verdict.reason, /token budget exhausted/);
      assert.equal(verdict.baseRuns, 1, "one run already started before the budget was hit");
      assert.equal(verdict.candidateRuns, 0);
      assert.equal(verdict.tokensSpent, 300);
      const log = readVerdictLog(paths);
      assert.equal(log[0]!.tokenBudget, 100);
      assert.equal(log[0]!.tokensSpent, 300);
    } finally {
      store.close();
    }
  });

  it("stages the candidate only for candidate runs, then cleans it up and ingests every run", async () => {
    const paths = tempPaths("h2-probe-staging-");
    const store = openStoreWithTraining(paths);
    try {
      const proposal = sampleProposal();
      const seen: { side: string; staged: boolean }[] = [];
      const seam = fakeSeam(improvedBySide, (input) => {
        seen.push({ side: input.side, staged: readLayer(paths, proposal.id) !== null });
      });
      const verdict = await probeProposal({ paths, store, proposal, targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement, approve: true });
      assert.equal(verdict.adopted, true);
      assert.equal(seen.length, 16);
      assert.deepEqual(seen.filter((entry) => entry.side === "base").map((entry) => entry.staged), Array(8).fill(false));
      assert.deepEqual(seen.filter((entry) => entry.side === "candidate").map((entry) => entry.staged), Array(8).fill(true));
      assert.deepEqual(seam.calls.filter((call) => call.input.side === "candidate").map((call) => call.layerIds), Array(8).fill([proposal.id]));
      assert.deepEqual(seam.calls.filter((call) => call.input.side === "base").map((call) => call.layerIds), Array(8).fill([]));
      assert.equal(new Set(seam.calls.map((call) => call.input.engagementId)).size, 16, "each run is a fresh engagement");
      assert.equal(readLayer(paths, proposal.id), null, "the staged candidate is removed after the probe");

      const report = JSON.parse(readFileSync(join(paths.runs, proposal.id, "probe.json"), "utf8")) as { verdict: { verdict: string; adopted: boolean }; runs: unknown[] };
      assert.equal(report.verdict.verdict, "ADOPT");
      assert.equal(report.verdict.adopted, true);
      assert.equal(report.runs.length, 16);

      const stored = store.listRuns({ limit: 100 });
      assert.equal(stored.length, 17, "one training run + 16 ingested probe runs");
      const candidateRuns = stored.filter((run) => run.runId.includes("-candidate-"));
      assert.equal(candidateRuns.length, 8);
      assert.deepEqual(candidateRuns[0]!.layerSet, [proposal.id], "the stored run is stamped with the composition that ran");
      assert.equal(candidateRuns[0]!.targetClass, "wordpress");
    } finally {
      store.close();
    }
  });

  it("refuses to compare a run that carries no usable metrics, cleaning up the candidate", async () => {
    const paths = tempPaths("h2-probe-unmeasured-");
    const store = openStoreWithTraining(paths);
    try {
      const seam = fakeSeam(() => sampleMetrics({ tokensIn: Number.NaN }));
      await assert.rejects(
        probeProposal({ paths, store, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement }),
        /no usable "tokensIn"/,
      );
      assert.equal(readLayer(paths, "layer-prompt-v1"), null, "the staged candidate is cleaned up after a failed probe");
    } finally {
      store.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The runner seam + CLI handlers
// ---------------------------------------------------------------------------

describe("runner seam", () => {
  it("refuses to fake a layer mount and names the exact integration point", () => {
    const paths = tempPaths("h2-probe-seam-");
    const seam = createRunnerProbeSeam({ paths });
    assert.doesNotThrow(() => seam.assertLayersMountable([]));
    assert.throws(() => seam.assertLayersMountable(["layer-prompt-v1"]), (err: Error) => {
      assert.match(err.message, /no harness-composition mount/);
      assert.match(err.message, /src\/phases\/run\.ts/);
      assert.match(err.message, /harnessLayers/);
      assert.match(err.message, /DSH_HARNESS2_LAYERS is a stamp only/);
      return true;
    });
  });

  it("probeCommand refuses without a targets file and exits 1", async () => {
    const paths = tempPaths("h2-probe-cli-notargets-");
    mkdirSync(paths.runs, { recursive: true });
    const proposalFile = join(paths.runs, "proposal.json");
    writeFileSync(proposalFile, JSON.stringify(sampleProposal()));
    const errors: string[] = [];
    const code = await probeCommand(
      ["--proposal", proposalFile],
      { out: () => undefined, err: (line) => errors.push(line) },
      { DSH_HARNESS2_ROOT: paths.root },
    );
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /explicit probe-targets file is required/);
  });

  it("probeCommand refuses a real probe while the runner has no layer mount", async () => {
    const paths = tempPaths("h2-probe-cli-nomount-");
    mkdirSync(paths.runs, { recursive: true });
    const store = openStoreWithTraining(paths);
    store.close();
    const proposalFile = join(paths.runs, "proposal.json");
    writeFileSync(proposalFile, JSON.stringify(sampleProposal()));
    const targetsFile = writeTargetsFile(paths);
    const errors: string[] = [];
    const code = await probeCommand(
      ["--proposal", proposalFile, "--targets", targetsFile],
      { out: () => undefined, err: (line) => errors.push(line) },
      { DSH_HARNESS2_ROOT: paths.root },
    );
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /no harness-composition mount/);
    assert.equal(readLayer(paths, "layer-prompt-v1"), null, "nothing was staged or run");
  });
});

describe("propose command", () => {
  it("records a valid proposal and stays propose-only", () => {
    const paths = tempPaths("h2-propose-");
    mkdirSync(paths.runs, { recursive: true });
    const proposalFile = join(paths.runs, "incoming.json");
    writeFileSync(proposalFile, JSON.stringify(sampleProposal()));
    const lines: string[] = [];
    const code = proposeCommand(["--proposal", proposalFile], { out: (line) => lines.push(line), err: () => undefined }, { DSH_HARNESS2_ROOT: paths.root });
    assert.equal(code, 0);
    const stored = join(paths.runs, "layer-prompt-v1", "proposal.json");
    assert.equal(existsSync(stored), true);
    assert.equal(JSON.parse(readFileSync(stored, "utf8")).id, "layer-prompt-v1");
    const output = JSON.parse(lines[0]!) as { proposeOnly: boolean };
    assert.equal(output.proposeOnly, true);
    assert.equal(readLayer(paths, "layer-prompt-v1"), null, "propose never installs a layer");
  });

  it("rejects a proposal that touches pinned guardrails or the pinned component", () => {
    const paths = tempPaths("h2-propose-guard-");
    mkdirSync(paths.runs, { recursive: true });
    const proposalFile = join(paths.runs, "incoming.json");
    const errors: string[] = [];
    const io = { out: () => undefined, err: (line: string) => errors.push(line) };
    writeFileSync(proposalFile, JSON.stringify(sampleProposal({ yaml: "- target: auth-gate\n" })));
    assert.equal(proposeCommand(["--proposal", proposalFile], io, { DSH_HARNESS2_ROOT: paths.root }), 1);
    assert.match(errors.join("\n"), /pinned guardrails/);
    writeFileSync(proposalFile, JSON.stringify(sampleProposal({ component: "guardrails" })));
    assert.equal(proposeCommand(["--proposal", proposalFile], io, { DSH_HARNESS2_ROOT: paths.root }), 1);
    assert.match(errors.join("\n"), /guardrails is pinned/);
    assert.equal(existsSync(join(paths.runs, "layer-prompt-v1", "proposal.json")), false);
  });

  it("rejects unknown options and malformed proposals", () => {
    const paths = tempPaths("h2-propose-bad-");
    mkdirSync(paths.runs, { recursive: true });
    const proposalFile = join(paths.runs, "incoming.json");
    writeFileSync(proposalFile, JSON.stringify({ ...sampleProposal(), yaml: "" }));
    const errors: string[] = [];
    const io = { out: () => undefined, err: (line: string) => errors.push(line) };
    assert.equal(proposeCommand(["--bogus", "x"], io, { DSH_HARNESS2_ROOT: paths.root }), 1);
    assert.match(errors.join("\n"), /unknown option --bogus/);
    assert.equal(proposeCommand(["--proposal", proposalFile], io, { DSH_HARNESS2_ROOT: paths.root }), 1);
    assert.match(errors.join("\n"), /"yaml" must be a non-empty string/);
  });
});
