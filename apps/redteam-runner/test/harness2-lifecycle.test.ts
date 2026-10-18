/**
 * Harness2 section-11 layer lifecycle, permanent archive + auto-rollback
 * monitor (H2-P3).
 *
 * Pins the safety-critical properties:
 *  - at most 5 ACTIVE layers can ever be composed; a 6th adoption needs
 *    consolidation first;
 *  - consolidation ADOPTS only through the section-8 gate AND explicit
 *    approval, archives the whole old stack with a manifest (ids/dates/metrics)
 *    and activates the merged layer as layer 1; a REJECT/INSUFFICIENT_DATA
 *    freezes the class, flags the operator and changes nothing;
 *  - rollback is an active-set edit + a permanent archive move + a reverted
 *    EXPERIENCE.md lesson, and a layer or an archive is NEVER deleted;
 *  - the 10-run monitor rolls back on an S drop > 0.08, an immediate CR rise
 *    > 0.03 and immediately deactivates/flags a guardrail-touch incident, and
 *    logs every evaluation.
 *
 * Every test works under a temp DSH_HARNESS2_ROOT, so the real
 * E:\secscan-harness2 tree is never touched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveHarness2Paths, type Harness2Paths, type PatchLayer } from "../src/harness2/contract.js";
import { MAX_ACTIVE_LAYERS, activeLayerIds, installLayer, readLayer, setActiveLayers } from "../src/harness2/layers.js";
import { applyLayerHeader, readLayerHeader, stripLayerHeader, LAYER_HEADER_BEGIN } from "../src/harness2/layer-headers.js";
import { archiveRoot, listArchiveDirs, readArchiveManifest, uniqueArchivePath } from "../src/harness2/layer-archive.js";
import { LifecycleError, assertAdoptionCapacity, consolidateLayers, type ConsolidateInput } from "../src/harness2/lifecycle.js";
import { RollbackRefusedError, rollbackLayerToArchive } from "../src/harness2/layer-rollback.js";
import { findAdoption, isFrozen, readFlags, readIncidents, recordAdoption } from "../src/harness2/lifecycle-state.js";
import {
  CR_RISE_THRESHOLD,
  S_DROP_THRESHOLD,
  guardrailTouches,
  readMonitorEvaluations,
  runAutoRollbackMonitor,
} from "../src/harness2/monitor.js";
import { readExperience, resolveExperiencePath } from "../src/harness2/experience.js";
import { openHarness2Store } from "../src/harness2/store.js";
import type { MetricSet } from "../src/harness2/scoring.js";

const DAY = "2026-10-18";
const NOW = new Date("2026-10-18T10:00:00.000Z");
const ADOPTED_MS = 1_000;

let root: string;
let paths: Harness2Paths;

function yamlFor(id: string): string {
  return `# patch layer ${id}\npatches:\n  - id: ${id}\n    kind: insert\n`;
}

function layerFor(id: string, over: Partial<PatchLayer> = {}): PatchLayer {
  return { id, targetClass: "webapp", yaml: yamlFor(id), adoptedAt: `${DAY}T09:00:00.000Z`, evidenceRunId: `run-${id}`, ...over };
}

function installAndActivate(ids: readonly string[]): void {
  for (const id of ids) installLayer(paths, layerFor(id), { installedAt: `${DAY}T09:00:00.000Z` });
  setActiveLayers(paths, ids);
}

function fiveIds(): string[] {
  return ["wp-l1", "wp-l2", "wp-l3", "wp-l4", "wp-l5"];
}

function metricSet(over: Partial<MetricSet> = {}): MetricSet {
  return { n: 8, successes: 4, claimsTotal: 8, falsePositives: 2, crashed: 0, sr: 0.5, vf: 2, fpr: 0.25, steps: 10, tok: 1000, cr: 0, ...over };
}

function heldOut(): string[] {
  return Array.from({ length: 8 }, (_, index) => `heldout-${index}.example`);
}

function adoptGate(over: { base?: Partial<MetricSet>; candidate?: Partial<MetricSet>; heldOutTargets?: string[] } = {}) {
  return {
    base: metricSet(over.base),
    candidate: metricSet({ successes: 6, sr: 0.75, falsePositives: 1, fpr: 0.125, steps: 9, tok: 900, ...over.candidate }),
    heldOutTargets: over.heldOutTargets ?? heldOut(),
    trainingTargets: ["train-1.example"],
  };
}

function consolidate(over: Partial<ConsolidateInput> = {}) {
  return consolidateLayers({
    paths,
    targetClass: "webapp",
    mergedLayer: layerFor("wp-merged"),
    gate: adoptGate(),
    approve: true,
    cycleId: "cycle-1",
    date: DAY,
    now: NOW,
    ...over,
  });
}

function experienceText(targetClass = "webapp"): string {
  const path = resolveExperiencePath(paths, targetClass);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function latestArchive(kind: string): string | undefined {
  return listArchiveDirs(paths).find((dir) => dir.includes(`-${kind}`));
}

/** Write a layer directory directly (bypasses installLayer) with a valid meta.json. */
function writeRawLayer(id: string, yaml: string, metaOver: Record<string, unknown> = {}): string {
  const dir = join(paths.layers, id);
  mkdirSync(dir, { recursive: true });
  const body = yaml.endsWith("\n") ? yaml : `${yaml}\n`;
  writeFileSync(join(dir, "layer.yml"), body);
  const meta = {
    id,
    targetClass: "webapp",
    adoptedAt: `${DAY}T09:00:00.000Z`,
    evidenceRunId: "run-raw",
    installedAt: `${DAY}T09:00:00.000Z`,
    sha256: createHash("sha256").update(body).digest("hex"),
    ...metaOver,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return dir;
}

interface SeedRun {
  runId: string;
  ts: number;
  success?: boolean;
  crashed?: boolean;
  vulns?: number;
  claims?: number;
  fps?: number;
  steps?: number;
  tokens?: number;
}

function seedRuns(runs: readonly SeedRun[]): void {
  const store = openHarness2Store(paths);
  try {
    for (const run of runs) {
      store.upsertRows(
        {
          runId: run.runId,
          ts: run.ts,
          targetClass: "webapp",
          harnessVersion: "0.37.1",
          layerSet: ["lay-monitored"],
          success: run.success ?? false,
          vulnsFound: run.vulns ?? 0,
          claimsTotal: run.claims ?? 1,
          falsePositives: run.fps ?? 1,
          stepsCount: run.steps ?? 10,
          tokensTotal: run.tokens ?? 1000,
          crashed: run.crashed ?? false,
          failureMode: run.crashed ? "timeout" : "none",
        },
        [],
      );
    }
  } finally {
    store.close();
  }
}

/** Install + activate a layer and register its adoption baseline (monitor input). */
function setupMonitoredLayer(id: string, sAtAdoption?: number, crAtAdoption?: number): void {
  installLayer(paths, layerFor(id), { installedAt: new Date(ADOPTED_MS).toISOString() });
  setActiveLayers(paths, [...activeLayerIds(paths), id]);
  recordAdoption(paths, {
    layerId: id,
    targetClass: "webapp",
    cycleId: "cycle-1",
    adoptedAtMs: ADOPTED_MS,
    adoptedAtIso: new Date(ADOPTED_MS).toISOString(),
    ...(sAtAdoption !== undefined ? { sAtAdoption } : {}),
    ...(crAtAdoption !== undefined ? { crAtAdoption } : {}),
  });
}

function badRuns(count: number, start = 2000): SeedRun[] {
  return Array.from({ length: count }, (_, index) => ({ runId: `bad-${index}`, ts: start + index, claims: 1, fps: 1 }));
}

function goodRuns(count: number, start = 2000): SeedRun[] {
  return Array.from({ length: count }, (_, index) => ({ runId: `good-${index}`, ts: start + index, success: true, vulns: 2, claims: 2, fps: 0 }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "harness2-lifecycle-"));
  paths = resolveHarness2Paths({ DSH_HARNESS2_ROOT: root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Max 5 active layers
// ---------------------------------------------------------------------------

describe("section 11.1: max 5 active layers", () => {
  it("caps the active set at five and refuses a sixth with a consolidation error", () => {
    const ids = fiveIds();
    installAndActivate(ids);
    installLayer(paths, layerFor("wp-l6"), { installedAt: `${DAY}T09:00:00.000Z` });
    assert.equal(MAX_ACTIVE_LAYERS, 5);
    assert.equal(activeLayerIds(paths).length, 5);
    assert.throws(() => setActiveLayers(paths, [...ids, "wp-l6"]), /at most 5|consolidate/i);
    assert.deepEqual(activeLayerIds(paths), ids, "the refused activation must not change the manifest");
  });

  it("assertAdoptionCapacity allows below the cap and refuses at the cap", () => {
    installAndActivate(fiveIds().slice(0, 4));
    assert.doesNotThrow(() => assertAdoptionCapacity(paths));
    installLayer(paths, layerFor("wp-l5"), { installedAt: `${DAY}T09:00:00.000Z` });
    setActiveLayers(paths, fiveIds());
    assert.throws(
      () => assertAdoptionCapacity(paths),
      (err: unknown) => err instanceof LifecycleError && /consolidate/.test(err.message),
    );
  });
});

// ---------------------------------------------------------------------------
// Layer file headers (section 11.4)
// ---------------------------------------------------------------------------

describe("section 11.4: layer file headers", () => {
  it("renders and parses every header field", () => {
    const body = applyLayerHeader(yamlFor("wp-a"), {
      layerId: "wp-a",
      date: DAY,
      parents: ["wp-1", "wp-2"],
      cycleId: "cycle-9",
      metricDeltas: "S +0.100; SR +0.100",
      status: "active",
    });
    assert.ok(body.startsWith(`${LAYER_HEADER_BEGIN}\n`), "header opens the layer file");
    const header = readLayerHeader(body);
    assert.ok(header);
    assert.equal(header.layerId, "wp-a");
    assert.equal(header.date, DAY);
    assert.deepEqual(header.parents, ["wp-1", "wp-2"]);
    assert.equal(header.cycleId, "cycle-9");
    assert.equal(header.metricDeltas, "S +0.100; SR +0.100");
    assert.equal(header.status, "active");
    assert.equal(stripLayerHeader(body), yamlFor("wp-a"));
  });

  it("is idempotent: re-applying a header replaces it instead of duplicating it", () => {
    const header = { layerId: "wp-a", date: DAY, parents: [], cycleId: "cycle-1", metricDeltas: "n/a", status: "active" };
    const once = applyLayerHeader(yamlFor("wp-a"), header);
    const twice = applyLayerHeader(once, header);
    assert.equal(twice, once);
    const markers = twice.split("\n").filter((line) => line === LAYER_HEADER_BEGIN).length;
    assert.equal(markers, 1);
    assert.equal(readLayerHeader(twice)?.parents.length, 0);
  });

  it("keeps the layer store's integrity check valid on a headered file", () => {
    const headered = applyLayerHeader(yamlFor("wp-h"), {
      layerId: "wp-h",
      date: DAY,
      parents: [],
      cycleId: "cycle-1",
      metricDeltas: "n/a",
      status: "active",
    });
    installLayer(paths, layerFor("wp-h", { yaml: headered }), { installedAt: `${DAY}T09:00:00.000Z` });
    const parsed = readLayer(paths, "wp-h");
    assert.ok(parsed);
    assert.ok(parsed.yaml.includes(LAYER_HEADER_BEGIN));
    assert.equal(readLayerHeader(parsed.yaml)?.layerId, "wp-h");
  });
});

// ---------------------------------------------------------------------------
// Consolidation (section 11.2)
// ---------------------------------------------------------------------------

describe("section 11.2: consolidation", () => {
  it("ADOPTs through the section-8 gate: archives the 5 with a manifest and activates the merged layer as layer 1", () => {
    const ids = fiveIds();
    installAndActivate(ids);
    const result = consolidate();
    assert.equal(result.status, "ADOPTED");
    assert.equal(result.verdict, "ADOPT");
    assert.equal(result.activationIndex, 1);
    assert.equal(result.mergedLayerId, "wp-merged");
    assert.deepEqual(result.activeIds, ["wp-merged"]);
    assert.deepEqual(result.archivedLayerIds, ids);

    // the merged layer is the ONLY active layer, i.e. layer 1 of the new cycle
    assert.deepEqual(activeLayerIds(paths), ["wp-merged"]);
    assert.deepEqual(result.archiveDir, latestArchive("consolidated"));
    assert.ok(result.archiveDir && existsSync(result.archiveDir));

    // the 5 old layer dirs are GONE from the active store but PRESENT in the archive
    for (const id of ids) {
      assert.equal(existsSync(join(paths.layers, id)), false, `${id} must no longer be installed`);
      assert.ok(existsSync(join(result.archiveDir!, id, "layer.yml")), `${id} must be archived, never deleted`);
      assert.ok(existsSync(join(result.archiveDir!, id, "meta.json")));
    }

    // the manifest records ids, dates and metrics
    const manifest = readArchiveManifest(result.archiveDir!);
    assert.ok(manifest);
    assert.equal(manifest.kind, "consolidated");
    assert.deepEqual(manifest.layerIds, ids);
    const layers = manifest.layers as Array<Record<string, unknown>>;
    assert.equal(layers.length, 5);
    for (const layer of layers) {
      assert.equal(typeof layer.adoptedAt, "string");
      assert.notEqual(layer.adoptedAt, "");
      assert.equal(String(layer.sha256).length, 64);
    }
    const metrics = manifest.metrics as { base: MetricSet; candidate: MetricSet; sBase: number; sCandidate: number };
    assert.ok(Number.isFinite(metrics.sBase));
    assert.ok(Number.isFinite(metrics.sCandidate));
    assert.deepEqual(manifest.activeAfter, ["wp-merged"]);
    assert.equal((manifest.gate as { verdict: string }).verdict, "ADOPT");

    // section 11.4 header on the merged layer, parented on the 5
    const merged = readLayer(paths, "wp-merged");
    assert.ok(merged);
    const header = readLayerHeader(merged.yaml);
    assert.ok(header);
    assert.equal(header.layerId, "wp-merged");
    assert.equal(header.status, "active");
    assert.equal(header.cycleId, "cycle-1");
    assert.deepEqual(header.parents, ids);
    assert.match(header.metricDeltas, /S [+-]/);

    // section 11.5: the merged adoption is registered for the monitor
    const adoption = findAdoption(paths, "wp-merged");
    assert.ok(adoption);
    assert.equal(adoption.targetClass, "webapp");
    assert.equal(typeof adoption.sAtAdoption, "number");

    // section-7 lesson: the merged layer's active entry exists
    assert.match(experienceText(), /Status: active/);
    assert.match(experienceText(), /wp-merged/);
  });

  it("frees capacity after consolidation (a 6th layer can be adopted again)", () => {
    installAndActivate(fiveIds());
    consolidate();
    assert.doesNotThrow(() => assertAdoptionCapacity(paths));
    installLayer(paths, layerFor("wp-next"), { installedAt: `${DAY}T09:00:00.000Z` });
    assert.deepEqual(setActiveLayers(paths, ["wp-merged", "wp-next"]), ["wp-merged", "wp-next"]);
  });

  it("FREEZES on REJECT: the 5 stay active, nothing is archived or installed, operator is flagged", () => {
    const ids = fiveIds();
    installAndActivate(ids);
    const archivesBefore = listArchiveDirs(paths).length;
    const result = consolidate({ gate: adoptGate({ candidate: { successes: 2, sr: 0.25, falsePositives: 8, fpr: 0.9 } }) });
    assert.equal(result.status, "FROZEN");
    assert.equal(result.verdict, "REJECT");
    assert.deepEqual(activeLayerIds(paths), ids, "the stack must never exceed or lose layers on a reject");
    assert.equal(listArchiveDirs(paths).length, archivesBefore, "nothing may be archived on a reject");
    assert.equal(readLayer(paths, "wp-merged"), null, "the merged layer must not be installed on a reject");
    assert.equal(isFrozen(paths, "webapp"), true);
    const freeze = result.freeze;
    assert.ok(freeze);
    assert.match(freeze.reason, /REJECT/);
    assert.ok(readFlags(paths).some((flag) => flag.kind === "consolidation-freeze" && flag.targetClass === "webapp"));
  });

  it("FREEZES on INSUFFICIENT_DATA (too few held-out targets) without touching the stack", () => {
    installAndActivate(fiveIds());
    const result = consolidate({ gate: adoptGate({ heldOutTargets: ["only-1.example", "only-2.example"] }) });
    assert.equal(result.status, "FROZEN");
    assert.equal(result.verdict, "INSUFFICIENT_DATA");
    assert.equal(activeLayerIds(paths).length, 5);
    assert.equal(isFrozen(paths, "webapp"), true);
  });

  it("FREEZES without explicit operator approval even when the gate says ADOPT", () => {
    installAndActivate(fiveIds());
    const result = consolidate({ approve: false });
    assert.equal(result.status, "FROZEN");
    assert.match(result.freeze?.reason ?? "", /approval/);
    assert.equal(activeLayerIds(paths).length, 5);
    assert.equal(readLayer(paths, "wp-merged"), null);
  });

  it("refuses to consolidate an empty stack", () => {
    assert.throws(() => consolidate(), (err: unknown) => err instanceof LifecycleError && /no active layer stack/.test(err.message));
  });
});

// ---------------------------------------------------------------------------
// Permanent archive: rollback (section 11.3)
// ---------------------------------------------------------------------------

describe("section 11.3: rollback to the permanent archive", () => {
  it("edits the active set, archives the files and appends a reverted lesson with measured deltas", () => {
    installAndActivate(["wp-a", "wp-b"]);
    const result = rollbackLayerToArchive({
      paths,
      layerId: "wp-b",
      reason: "regression on auth paths",
      date: DAY,
      now: NOW,
      runIds: ["run-1", "run-2"],
      deltas: { vulnsFound: -2, falsePositives: 1, steps: -1, tokensIn: -100, tokensOut: 0 },
      baseRuns: 4,
      candidateRuns: 4,
    });
    assert.deepEqual(result.activeBefore, ["wp-a", "wp-b"]);
    assert.deepEqual(result.activeIds, ["wp-a"]);
    assert.deepEqual(activeLayerIds(paths), ["wp-a"]);
    assert.match(result.archiveDir, /-rollback-regression-on-auth-paths$/);
    assert.equal(existsSync(join(result.archiveDir, "wp-b", "layer.yml")), true);
    assert.equal(readFileSync(join(result.archiveDir, "wp-b", "layer.yml"), "utf8"), yamlFor("wp-b"));
    assert.equal(existsSync(join(paths.layers, "wp-b")), false);
    const manifest = readArchiveManifest(result.archiveDir);
    assert.equal(manifest?.kind, "rollback");
    assert.equal(manifest?.reason, "regression on auth paths");
    assert.deepEqual(manifest?.activeBefore, ["wp-a", "wp-b"]);
    assert.deepEqual(manifest?.activeIds, ["wp-a"]);
    assert.equal(result.experiencePath, resolveExperiencePath(paths, "webapp"));
    const text = experienceText();
    assert.match(text, /Status: reverted \(regression on auth paths, 2026-10-18\)/);
    assert.match(text, /vulnsFound -2/);
    assert.match(text, /wp-b/);
    assert.equal(readExperience(paths, "webapp").some((entry) => entry.layerId === "wp-b" && entry.status.kind === "reverted"), true);
  });

  it("refuses a nonexistent layer", () => {
    assert.throws(
      () => rollbackLayerToArchive({ paths, layerId: "ghost", reason: "test" }),
      (err: unknown) => err instanceof RollbackRefusedError && /no installed layer/.test(err.message),
    );
  });

  it("NEVER deletes: a second rollback of the same id is refused and the archive is intact", () => {
    installAndActivate(["wp-a", "wp-b"]);
    const first = rollbackLayerToArchive({ paths, layerId: "wp-b", reason: "regression", date: DAY, now: NOW });
    const archivedYaml = readFileSync(join(first.archiveDir, "wp-b", "layer.yml"), "utf8");
    const archives = listArchiveDirs(paths).length;
    assert.throws(
      () => rollbackLayerToArchive({ paths, layerId: "wp-b", reason: "again" }),
      (err: unknown) => err instanceof RollbackRefusedError && /already archived/.test(err.message),
    );
    assert.equal(listArchiveDirs(paths).length, archives);
    assert.equal(readFileSync(join(first.archiveDir, "wp-b", "layer.yml"), "utf8"), archivedYaml);
  });

  it("archives an inactive installed layer without changing the active set", () => {
    installAndActivate(["wp-a"]);
    installLayer(paths, layerFor("wp-idle"), { installedAt: `${DAY}T09:00:00.000Z` });
    const result = rollbackLayerToArchive({ paths, layerId: "wp-idle", reason: "operator cleanup", date: DAY, now: NOW });
    assert.deepEqual(activeLayerIds(paths), ["wp-a"]);
    assert.deepEqual(result.activeBefore, ["wp-a"]);
    assert.deepEqual(result.activeIds, ["wp-a"]);
    assert.ok(existsSync(join(result.archiveDir, "wp-idle", "layer.yml")));
  });

  it("flags a guardrail-touch rollback as an INCIDENT and archives it under the incident kind", () => {
    writeRawLayer("wp-tampered", "patches:\n  - component: guardrails\n    target: src/safety\n");
    setActiveLayers(paths, ["wp-tampered"]);
    const result = rollbackLayerToArchive({
      paths,
      layerId: "wp-tampered",
      reason: "guardrail-touch",
      incident: true,
      incidentDetail: "active layer references pinned guardrail src/safety",
      pinned: ["src/safety"],
      date: DAY,
      now: NOW,
    });
    assert.equal(result.incident, true);
    assert.match(result.archiveDir, /-incident-guardrail-touch$/);
    assert.equal(readArchiveManifest(result.archiveDir)?.kind, "incident");
    const incidents = readIncidents(paths);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0]!.kind, "guardrail-touch");
    assert.deepEqual(incidents[0]!.pinned, ["src/safety"]);
    assert.ok(readFlags(paths).some((flag) => flag.kind === "guardrail-incident" && flag.layerId === "wp-tampered"));
    assert.match(experienceText(), /Status: reverted \(guardrail-touch/);
  });

  it("creates unique archive directories so two same-day operations never overwrite each other", () => {
    const first = uniqueArchivePath(archiveRoot(paths), `${DAY}-rollback-x`);
    mkdirSync(first, { recursive: true });
    const second = uniqueArchivePath(archiveRoot(paths), `${DAY}-rollback-x`);
    assert.notEqual(first, second);
    assert.match(second, /-2$/);
  });
});

// ---------------------------------------------------------------------------
// Auto-rollback monitor (section 11.5)
// ---------------------------------------------------------------------------

describe("section 11.5: auto-rollback monitor", () => {
  it("rolls back when the 10-run S drops more than 0.08 below the at-adoption S", () => {
    setupMonitoredLayer("lay-s", -0.1, 0);
    seedRuns(badRuns(10));
    const result = runAutoRollbackMonitor({ paths, now: new Date(5000) });
    assert.equal(result.actions.length, 1);
    assert.deepEqual(result.actions[0], { ...result.actions[0], layerId: "lay-s", action: "rolled-back", reason: "s-drop" });
    assert.match(result.actions[0]!.archiveDir ?? "", /-rollback-s-drop$/);
    assert.deepEqual(activeLayerIds(paths), []);
    assert.equal(readArchiveManifest(result.actions[0]!.archiveDir!)?.reason, "s-drop");
    const evaluation = result.evaluations.find((entry) => entry.layerId === "lay-s");
    assert.ok(evaluation);
    assert.equal(evaluation.window, 10);
    assert.equal(evaluation.rules.sDrop, true);
    assert.equal(evaluation.action, "rolled-back");
    assert.match(evaluation.note, /s-drop rule fired/);
    assert.ok(evaluation.sWindow !== null && evaluation.sAtAdoption !== null);
    assert.ok(evaluation.sWindow < evaluation.sAtAdoption - S_DROP_THRESHOLD);
    assert.match(experienceText(), /Status: reverted \(s-drop/);
    assert.equal(readExperience(paths, "webapp").some((entry) => entry.layerId === "lay-s" && entry.status.kind === "reverted"), true);
    assert.ok(findAdoption(paths, "lay-s")?.closedAtMs !== undefined, "adoption monitoring closes after the rollback");
  });

  it("rolls back IMMEDIATELY when CR rises more than 0.03 (no 10-run wait)", () => {
    setupMonitoredLayer("lay-cr", 0.5, 0);
    seedRuns([{ runId: "crash-1", ts: 2000, crashed: true }]);
    const result = runAutoRollbackMonitor({ paths, now: new Date(5000) });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0]!.reason, "cr-rise");
    assert.match(result.actions[0]!.archiveDir ?? "", /-rollback-cr-rise$/);
    assert.deepEqual(activeLayerIds(paths), []);
    const evaluation = result.evaluations.find((entry) => entry.layerId === "lay-cr");
    assert.ok(evaluation);
    assert.equal(evaluation.window, 1, "the CR rule fires on the first followed run");
    assert.equal(evaluation.rules.crRise, true);
    assert.ok(evaluation.crWindow > CR_RISE_THRESHOLD);
  });

  it("logs a partial window and takes no action before 10 runs", () => {
    setupMonitoredLayer("lay-part", 0.2, 0);
    seedRuns(goodRuns(3));
    const result = runAutoRollbackMonitor({ paths, now: new Date(5000) });
    assert.deepEqual(result.actions, []);
    assert.deepEqual(activeLayerIds(paths), ["lay-part"]);
    const evaluation = result.evaluations.find((entry) => entry.layerId === "lay-part");
    assert.ok(evaluation);
    assert.equal(evaluation.window, 3);
    assert.equal(evaluation.action, "none");
    assert.match(evaluation.note, /partial window \(3\/10 runs\)/);
    assert.equal(readMonitorEvaluations(paths).length, 1);
  });

  it("closes the window with no rollback when the full 10-run window holds up", () => {
    setupMonitoredLayer("lay-ok", -0.2, 0);
    seedRuns(goodRuns(10));
    const result = runAutoRollbackMonitor({ paths, now: new Date(5000) });
    assert.deepEqual(result.actions, []);
    assert.deepEqual(activeLayerIds(paths), ["lay-ok"]);
    const evaluation = result.evaluations.find((entry) => entry.layerId === "lay-ok");
    assert.match(evaluation?.note ?? "", /window complete/);
    assert.equal(findAdoption(paths, "lay-ok")?.closeReason, "window complete: 10 runs, no rule triggered");
  });

  it("immediately deactivates and flags an active layer that touches a pinned guardrail", () => {
    writeRawLayer("lay-tampered", "patches:\n  - component: guardrails\n    target: src/safety\n");
    setActiveLayers(paths, ["lay-tampered"]);
    assert.equal(guardrailTouches(paths).length, 1, "the tamper must be detected before deactivation");
    const result = runAutoRollbackMonitor({ paths, now: new Date(5000) });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0]!.action, "deactivated-incident");
    assert.equal(result.actions[0]!.reason, "guardrail-touch");
    assert.match(result.actions[0]!.archiveDir ?? "", /-incident-guardrail-touch$/);
    assert.deepEqual(activeLayerIds(paths), [], "the dangerous layer must not stay active");
    assert.equal(result.incidents.length, 1);
    assert.deepEqual(result.incidents[0]!.pinned, ["src/safety", "guardrails"]);
    assert.ok(readFlags(paths).some((flag) => flag.kind === "guardrail-incident"));
    assert.equal(guardrailTouches(paths).length, 0);
    const evaluation = result.evaluations.find((entry) => entry.layerId === "lay-tampered");
    assert.equal(evaluation?.rules.guardrailTouch, true);
    assert.equal(evaluation?.action, "deactivated-incident");
    assert.match(experienceText(), /Status: reverted \(guardrail-touch/);
  });

  it("also deactivates an active layer whose files no longer verify (integrity incident)", () => {
    setupMonitoredLayer("lay-broken", 0, 0);
    writeFileSync(join(paths.layers, "lay-broken", "layer.yml"), `${yamlFor("lay-broken")}\n# tampered\n`);
    const result = runAutoRollbackMonitor({ paths, now: new Date(5000) });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0]!.reason, "unreadable-layer");
    assert.match(result.actions[0]!.archiveDir ?? "", /-incident-unreadable-layer$/);
    assert.deepEqual(activeLayerIds(paths), []);
    assert.equal(result.incidents.length, 1);
    assert.equal(result.incidents[0]!.kind, "unreadable-layer");
    assert.ok(existsSync(join(result.actions[0]!.archiveDir!, "lay-broken", "layer.yml")), "the evidence bytes are archived");
  });

  it("dry run evaluates and logs without changing any state", () => {
    setupMonitoredLayer("lay-s", -0.1, 0);
    seedRuns(badRuns(10));
    const result = runAutoRollbackMonitor({ paths, now: new Date(5000), apply: false });
    assert.deepEqual(result.actions, []);
    assert.deepEqual(activeLayerIds(paths), ["lay-s"]);
    assert.equal(listArchiveDirs(paths).length, 0);
    const evaluation = result.evaluations.find((entry) => entry.layerId === "lay-s");
    assert.equal(evaluation?.action, "none");
    assert.match(evaluation?.note ?? "", /WOULD fire/);
    assert.equal(readMonitorEvaluations(paths).length, 1);
  });

  it("logs every evaluation across repeated passes (append-only audit trail)", () => {
    setupMonitoredLayer("lay-part", 0.2, 0);
    seedRuns(goodRuns(2));
    runAutoRollbackMonitor({ paths, now: new Date(5000) });
    runAutoRollbackMonitor({ paths, now: new Date(6000) });
    const log = readMonitorEvaluations(paths);
    assert.equal(log.length, 2);
    for (const entry of log) {
      assert.equal(typeof entry.note, "string");
      assert.notEqual(entry.note, "");
      assert.equal(entry.layerId, "lay-part");
    }
  });

  it("auto-registers an active layer adoption it has never seen before", () => {
    installLayer(paths, layerFor("lay-new"), { installedAt: new Date(10_000).toISOString() });
    setActiveLayers(paths, ["lay-new"]);
    seedRuns([{ runId: "after-1", ts: 20_000, success: true, vulns: 2, claims: 2, fps: 0 }]);
    const result = runAutoRollbackMonitor({ paths, now: new Date(30_000) });
    const adoption = findAdoption(paths, "lay-new");
    assert.ok(adoption, "monitoring must cover an adoption made through the ordinary adopt path");
    assert.equal(adoption.targetClass, "webapp");
    assert.equal(adoption.adoptedAtMs, 10_000);
    assert.ok(result.evaluations.some((entry) => entry.layerId === "lay-new" && entry.window === 1));
  });
});
