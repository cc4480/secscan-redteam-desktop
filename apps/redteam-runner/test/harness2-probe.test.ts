/**
 * H2-P2b: patch-layer store + offline probe harness.
 *
 * Covers: layer install/list/read/remove round-trips, the ordered active
 * manifest and fail-closed composition, the pinned-guardrail refusal, the probe
 * refusing without an explicit targets file, the adoption rule (better/worse/
 * tie/inconsistent), approval gating (propose-only by default), token
 * accounting, N<2 refusing before any run, candidate staging + cleanup, the
 * probe report, and the runner seam refusing to fake a layer mount.
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
import { MIN_RUNS_PER_SIDE, loadProbeTargets, probeProposal, type ProbeRunFn, type ProbeRunInput } from "../src/harness2/probe.js";
import { createRunnerProbeSeam, probeCommand, proposeCommand } from "../src/harness2/probe-cli.js";

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

function writeTargetsFile(paths: Harness2Paths, targets: readonly Record<string, unknown>[] = [{}]): string {
  mkdirSync(paths.runs, { recursive: true });
  const file = join(paths.runs, "probe-targets.json");
  const defaults = {
    target: "shop.example.test",
    mode: "red",
    objective: "probe the candidate harness on a lab target",
    roe: { scope: ["shop.example.test"] },
    targetClass: "wordpress",
  };
  writeFileSync(file, JSON.stringify(targets.map((entry) => ({ ...defaults, ...entry }))));
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

function bySide(input: ProbeRunInput, values: { base: Partial<RunMetrics>; candidate: Partial<RunMetrics> }): RunMetrics {
  return sampleMetrics(input.side === "candidate" ? values.candidate : values.base);
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
// Safety gates: explicit targets file + propose-only
// ---------------------------------------------------------------------------

describe("probe safety gates", () => {
  it("refuses to run without an explicit probe-targets file", async () => {
    const paths = tempPaths("h2-probe-notargets-");
    const seam = fakeSeam(() => sampleMetrics());
    for (const targetsFile of [undefined, "", join(paths.root, "nope.json")]) {
      await assert.rejects(
        probeProposal({ paths, proposal: sampleProposal(), targetsFile, runEngagement: seam.runEngagement }),
        /probe-targets file/,
      );
    }
    assert.equal(seam.calls.length, 0, "no run may happen without a targets file");
  });

  it("refuses an empty, non-list or invalid targets file", async () => {
    const paths = tempPaths("h2-probe-badtargets-");
    const seam = fakeSeam(() => sampleMetrics());
    const file = writeTargetsFile(paths, []);
    await assert.rejects(probeProposal({ paths, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement }), /lists no targets/);
    writeFileSync(file, JSON.stringify({ target: "x" }));
    await assert.rejects(probeProposal({ paths, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement }), /must be a JSON list/);
    writeFileSync(file, JSON.stringify([{ target: "x", roe: { scope: [] } }]));
    await assert.rejects(probeProposal({ paths, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement }), /roe\.scope/);
    writeFileSync(file, "{not json");
    await assert.rejects(probeProposal({ paths, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement }), /not valid JSON/);
    assert.equal(seam.calls.length, 0);
  });

  it("loadProbeTargets exposes the gate the CLI relies on", () => {
    const paths = tempPaths("h2-probe-loadtargets-");
    assert.throws(() => loadProbeTargets(undefined), /explicit probe-targets file is required/);
    const targets = loadProbeTargets(writeTargetsFile(paths));
    assert.equal(targets.length, 1);
    assert.equal(targets[0]!.target, "shop.example.test");
  });

  it("refuses a proposal that targets the pinned guardrails", async () => {
    const paths = tempPaths("h2-probe-pinned-");
    const file = writeTargetsFile(paths);
    const seam = fakeSeam(() => sampleMetrics());
    await assert.rejects(
      probeProposal({
        paths,
        proposal: sampleProposal({ component: "guardrails" }),
        targetsFile: file,
        runEngagement: seam.runEngagement,
      }),
      /pinned guardrails component/,
    );
    await assert.rejects(
      probeProposal({
        paths,
        proposal: sampleProposal({ yaml: "- target: src/safety/halts.ts\n" }),
        targetsFile: file,
        runEngagement: seam.runEngagement,
      }),
      /pinned guardrails/,
    );
    assert.equal(seam.calls.length, 0);
  });

  it("discards N<2 before spending any run", async () => {
    const paths = tempPaths("h2-probe-fewruns-");
    const seam = fakeSeam(() => sampleMetrics());
    for (const runsPerSide of [1, 0, 1.5]) {
      const verdict = await probeProposal({
        paths,
        proposal: sampleProposal(),
        targetsFile: writeTargetsFile(paths),
        runEngagement: seam.runEngagement,
        runsPerSide,
      });
      assert.equal(verdict.adopted, false);
      assert.equal(verdict.baseRuns, 0);
      assert.equal(verdict.candidateRuns, 0);
      assert.equal(verdict.tokensSpent, 0);
      assert.match(verdict.reason, /N runs per side must be an integer/);
    }
    assert.equal(seam.calls.length, 0);
    assert.equal(MIN_RUNS_PER_SIDE, 2);
  });
});

// ---------------------------------------------------------------------------
// The adoption rule
// ---------------------------------------------------------------------------

describe("probe verdict and approval gate", () => {
  it("adopts a measurably better candidate only with explicit approval", async () => {
    const paths = tempPaths("h2-probe-adopt-");
    const seam = fakeSeam((input) => bySide(input, { base: { vulnsFound: 1 }, candidate: { vulnsFound: 3, tokensIn: 200, tokensOut: 80 } }));
    const unapproved = await probeProposal({
      paths,
      proposal: sampleProposal(),
      targetsFile: writeTargetsFile(paths),
      runEngagement: seam.runEngagement,
    });
    assert.equal(unapproved.adopted, false);
    assert.equal(unapproved.reason, "approval required", "default is propose-only");
    assert.equal(unapproved.deltas.vulnsFound, 2);
    assert.equal(unapproved.baseRuns, 2);
    assert.equal(unapproved.candidateRuns, 2);
    assert.equal(
      unapproved.tokensSpent,
      2 * (100 + 50) + 2 * (200 + 80),
      "tokensSpent sums every measured run",
    );
    assert.equal(unapproved.deltas.tokensIn, 100 - 200, "positive delta means fewer tokens");

    const approved = await probeProposal({
      paths,
      proposal: sampleProposal(),
      targetsFile: writeTargetsFile(paths),
      runEngagement: seam.runEngagement,
      approve: true,
    });
    assert.equal(approved.adopted, true);
    assert.match(approved.reason, /^adopted: candidate is better on vulnsFound/);
    assert.equal(approved.deltas.vulnsFound, 2);
  });

  it("stages the candidate for the candidate runs and cleans it up afterwards", async () => {
    const paths = tempPaths("h2-probe-staging-");
    const proposal = sampleProposal();
    const seen: { side: string; staged: boolean; layerIds: readonly string[] }[] = [];
    const seam = fakeSeam(
      (input) => bySide(input, { base: { vulnsFound: 1 }, candidate: { vulnsFound: 2 } }),
      (input) => {
        if (input.side === "candidate") {
          const layer = readLayer(paths, proposal.id);
          seen.push({ side: input.side, staged: layer !== null, layerIds: [proposal.id] });
        } else {
          seen.push({ side: input.side, staged: readLayer(paths, proposal.id) !== null, layerIds: [] });
        }
      },
    );
    const verdict = await probeProposal({ paths, proposal, targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement });
    assert.equal(verdict.adopted, false, "still propose-only");
    assert.deepEqual(
      seen.map((entry) => entry.side),
      ["base", "base", "candidate", "candidate"],
    );
    assert.deepEqual(seen.filter((entry) => entry.side === "base").map((entry) => entry.staged), [false, false]);
    assert.deepEqual(seen.filter((entry) => entry.side === "candidate").map((entry) => entry.staged), [true, true]);
    assert.deepEqual(seam.calls.filter((call) => call.input.side === "candidate").map((call) => call.layerIds), [
      [proposal.id],
      [proposal.id],
    ]);
    assert.deepEqual(seam.calls.filter((call) => call.input.side === "base").map((call) => call.layerIds), [[], []]);
    assert.equal(new Set(seam.calls.map((call) => call.input.engagementId)).size, 4, "each run is a fresh engagement");
    assert.equal(readLayer(paths, proposal.id), null, "the staged candidate is removed after the probe");
    const report = JSON.parse(readFileSync(join(paths.runs, proposal.id, "probe.json"), "utf8")) as {
      verdict: { proposalId: string };
      runs: unknown[];
    };
    assert.equal(report.verdict.proposalId, proposal.id);
    assert.equal(report.runs.length, 4);
  });

  it("discards a worse candidate even with approval", async () => {
    const paths = tempPaths("h2-probe-worse-");
    const seam = fakeSeam((input) => bySide(input, { base: { vulnsFound: 3 }, candidate: { vulnsFound: 1 } }));
    const verdict = await probeProposal({
      paths,
      proposal: sampleProposal(),
      targetsFile: writeTargetsFile(paths),
      runEngagement: seam.runEngagement,
      approve: true,
    });
    assert.equal(verdict.adopted, false);
    assert.match(verdict.reason, /^discarded: candidate is worse on vulnsFound/);
    assert.equal(verdict.deltas.vulnsFound, -2);
  });

  it("uses the falsePositives then steps tie-breaks", async () => {
    const paths = tempPaths("h2-probe-tiebreak-");
    const fpSeam = fakeSeam((input) => bySide(input, { base: { vulnsFound: 2, falsePositives: 2 }, candidate: { vulnsFound: 2, falsePositives: 0 } }));
    const fp = await probeProposal({ paths, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: fpSeam.runEngagement, approve: true });
    assert.equal(fp.adopted, true);
    assert.match(fp.reason, /better on falsePositives/);
    assert.equal(fp.deltas.falsePositives, 2);

    const stepSeam = fakeSeam((input) => bySide(input, { base: { vulnsFound: 2, steps: 9 }, candidate: { vulnsFound: 2, steps: 4 } }));
    const steps = await probeProposal({ paths, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: stepSeam.runEngagement, approve: true });
    assert.equal(steps.adopted, true);
    assert.match(steps.reason, /better on steps/);
    assert.equal(steps.deltas.steps, 5);
  });

  it("discards when every metric ties", async () => {
    const paths = tempPaths("h2-probe-tie-");
    const seam = fakeSeam(() => sampleMetrics());
    const verdict = await probeProposal({
      paths,
      proposal: sampleProposal(),
      targetsFile: writeTargetsFile(paths),
      runEngagement: seam.runEngagement,
      approve: true,
    });
    assert.equal(verdict.adopted, false);
    assert.equal(verdict.reason, "discarded: no measurable improvement: vulnsFound, falsePositives and steps all tie");
  });

  it("discards an overall win that regresses one probe target", async () => {
    const paths = tempPaths("h2-probe-inconsistent-");
    const file = writeTargetsFile(paths, [{ target: "a.example.test", roe: { scope: ["a.example.test"] } }, { target: "b.example.test", roe: { scope: ["b.example.test"] } }]);
    const seam = fakeSeam((input) => {
      // a.example.test: the candidate wins big; b.example.test: it regresses.
      const base = input.target.startsWith("a.") ? 1 : 3;
      const candidate = input.target.startsWith("a.") ? 4 : 2;
      return sampleMetrics(input.side === "candidate" ? { vulnsFound: candidate } : { vulnsFound: base });
    });
    const verdict = await probeProposal({ paths, proposal: sampleProposal(), targetsFile: file, runEngagement: seam.runEngagement, approve: true });
    assert.equal(verdict.adopted, false);
    assert.match(verdict.reason, /inconsistent direction: candidate is worse on vulnsFound for probe target #2/);
  });

  it("refuses to compare a run that carries no usable metrics", async () => {
    const paths = tempPaths("h2-probe-unmeasured-");
    const seam = fakeSeam(() => sampleMetrics({ tokensIn: Number.NaN }));
    await assert.rejects(
      probeProposal({ paths, proposal: sampleProposal(), targetsFile: writeTargetsFile(paths), runEngagement: seam.runEngagement }),
      /no usable "tokensIn"/,
    );
    assert.equal(readLayer(paths, "layer-prompt-v1"), null, "the staged candidate is cleaned up after a failed probe");
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
    const lines: string[] = [];
    const errors: string[] = [];
    const code = await probeCommand(
      ["--proposal", proposalFile],
      { out: (line) => lines.push(line), err: (line) => errors.push(line) },
      { DSH_HARNESS2_ROOT: paths.root },
    );
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /explicit probe-targets file is required/);
    assert.deepEqual(lines, []);
  });

  it("probeCommand refuses a real probe while the runner has no layer mount", async () => {
    const paths = tempPaths("h2-probe-cli-nomount-");
    mkdirSync(paths.runs, { recursive: true });
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
