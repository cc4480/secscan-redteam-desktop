/**
 * Harness2 trajectory store (H2-P1b).
 *
 * Pins what the tuner depends on: idempotent migration, a faithful round-trip
 * (including token counts, which the paper's metrics never had), ordered
 * events, re-ingest without duplication, class/outcome aggregation, and
 * tolerance of half-written and pre-H2-P1a directories.
 *
 * Every test opens the store on a temp DSH_HARNESS2_ROOT, so the real
 * E:\secscan-harness2 database is never touched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveHarness2Paths, type RunMetrics, type TrajectoryEvent, type TrajectoryRecord } from "../src/harness2/contract.js";
import { ingestEngagementDir, ingestRoot } from "../src/harness2/store.js";
import { openHarness2Store } from "../src/harness2/store.js";
import type { Harness2Store } from "../src/harness2/store.js";
import { dispatchCli, type CliIo } from "../src/harness2/cli.js";

let root: string;
let previousRoot: string | undefined;
let store: Harness2Store;

function sampleMetrics(over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    runId: "run-alpha",
    engagementId: "eng-alpha",
    targetClass: "wordpress",
    outcome: "success",
    vulnsFound: 3,
    falsePositives: 1,
    exploitsSucceeded: 2,
    exploitsAttempted: 4,
    steps: 12,
    tokensIn: 1000,
    tokensOut: 500,
    durationMs: 60000,
    harness: { runnerVersion: "0.37.1", layerIds: ["base", "wp-hardening"], componentHashes: { memory: "aa", skills: "bb" } },
    startedAt: "2026-10-18T10:00:00.000Z",
    finishedAt: "2026-10-18T10:01:00.000Z",
    ...over,
  };
}

function sampleEvent(seq: number, over: Partial<TrajectoryEvent> = {}): TrajectoryEvent {
  const base: TrajectoryEvent = {
    ts: `2026-10-18T10:00:0${seq}.000Z`,
    phase: "recon",
    actor: "recon",
    action: `probe_${seq}`,
    attackId: "T1046",
    target: "example.test",
    result: `probe ${seq} ok`,
    isToolCall: true,
  };
  return { ...base, ...over };
}

function sampleRecord(over: Partial<RunMetrics> = {}, events: TrajectoryEvent[] = [sampleEvent(1), sampleEvent(2)]): TrajectoryRecord {
  return { metrics: sampleMetrics(over), events };
}

/** Write an engagement directory holding the given files. */
function writeRunDir(parent: string, name: string, files: Record<string, string>): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
  return dir;
}

/** An events.jsonl line in the runner's EngagementEvent shape. */
function eventLine(seq: number): string {
  return JSON.stringify({
    ts: `2026-10-18T10:00:0${seq}.000Z`,
    seq,
    engagementId: "eng-legacy",
    phase: "recon",
    actor: "recon",
    action: `probe_${seq}`,
    attackId: "T1046",
    target: "example.test",
    result: `probe ${seq} ok`,
  });
}

/** Run one CLI command in-process and capture its output. */
function cli(...args: string[]): { code: number; out: string } {
  const lines: string[] = [];
  const io: CliIo = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
  return { code: dispatchCli(args, io), out: lines.join("\n") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "harness2-store-"));
  previousRoot = process.env.DSH_HARNESS2_ROOT;
  process.env.DSH_HARNESS2_ROOT = root;
  store = openHarness2Store(resolveHarness2Paths());
});

afterEach(() => {
  store.close();
  if (previousRoot === undefined) delete process.env.DSH_HARNESS2_ROOT;
  else process.env.DSH_HARNESS2_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

describe("harness2 store", () => {
  it("migrates idempotently and keeps data across a reopen", () => {
    store.migrate();
    store.upsertRun(sampleRecord());
    store.migrate();
    store.close();
    store = openHarness2Store(resolveHarness2Paths());
    assert.equal(store.listRuns().length, 1, "migrate must not drop rows");
  });

  it("round-trips a run including token counts, components and outcomes", () => {
    store.upsertRun(sampleRecord());
    const detail = store.getRun("run-alpha");
    assert.ok(detail, "run is stored");
    assert.equal(detail.run.targetClass, "wordpress");
    assert.equal(detail.run.outcome, "success");
    assert.equal(detail.run.tokensIn, 1000);
    assert.equal(detail.run.tokensOut, 500);
    assert.equal(detail.run.steps, 12);
    assert.deepEqual([...detail.run.layerIds], ["base", "wp-hardening"]);
    assert.deepEqual({ ...detail.run.componentHashes }, { memory: "aa", skills: "bb" });
    assert.deepEqual(detail.components.map((entry) => entry.component), ["memory", "skills"]);
    assert.equal(detail.events.length, 2);
    assert.equal(detail.outcomes["tokens_in"], 1000);
    assert.equal(store.getRun("run-missing"), null);
  });

  it("lists runs by class, outcome and limit", () => {
    store.upsertRun(sampleRecord());
    store.upsertRun(sampleRecord({ runId: "run-beta", engagementId: "eng-beta", targetClass: "nginx", outcome: "failure" }));
    store.upsertRun(sampleRecord({ runId: "run-gamma", engagementId: "eng-gamma", outcome: "failure" }));
    assert.equal(store.listRuns().length, 3);
    assert.equal(store.listRuns({ targetClass: "wordpress" }).length, 2);
    assert.equal(store.listRuns({ outcome: "failure" }).length, 2);
    assert.equal(store.listRuns({ targetClass: "wordpress", outcome: "failure" }).length, 1);
    assert.equal(store.listRuns({ limit: 1 }).length, 1);
  });

  it("keeps trajectory events in seq order", () => {
    store.upsertRun(sampleRecord({}, [sampleEvent(1), sampleEvent(2), sampleEvent(3)]));
    assert.equal(store.insertEvents("run-alpha", [sampleEvent(4, { action: "tail_4" })]), 1);
    const detail = store.getRun("run-alpha");
    assert.ok(detail);
    assert.deepEqual(detail.events.map((event) => event.seq), [1, 2, 3, 4]);
    assert.deepEqual(detail.events.map((event) => event.action), ["probe_1", "probe_2", "probe_3", "tail_4"]);
  });

  it("re-ingesting the same run does not duplicate", () => {
    const dir = writeRunDir(root, "eng-alpha", {
      "trajectory.json": JSON.stringify(sampleRecord()),
      "metrics.json": JSON.stringify(sampleMetrics()),
    });
    assert.equal(ingestEngagementDir(store, dir).ingested, true);
    assert.equal(ingestEngagementDir(store, dir).ingested, true);
    assert.equal(store.listRuns().length, 1, "one run row, not two");
    const detail = store.getRun("run-alpha");
    assert.ok(detail);
    assert.equal(detail.events.length, 2, "events are replaced, not appended");
    assert.equal(detail.components.length, 2);
    assert.equal(detail.outcomes["tokens_in"], 1000);
  });

  it("aggregates stats by target class and outcome", () => {
    store.upsertRun(sampleRecord());
    store.upsertRun(
      sampleRecord({ runId: "run-beta", engagementId: "eng-beta", outcome: "failure", vulnsFound: 0, steps: 5, tokensIn: 200, tokensOut: 100 }),
    );
    store.upsertRun(
      sampleRecord({ runId: "run-gamma", engagementId: "eng-gamma", targetClass: "nginx", vulnsFound: 2, steps: 7, tokensIn: 400, tokensOut: 200 }),
    );
    const stats = store.runStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.totalTokensIn, 1600);
    assert.equal(stats.totalTokensOut, 800);
    const wordpress = stats.byTargetClass.find((entry) => entry.targetClass === "wordpress");
    assert.ok(wordpress);
    assert.equal(wordpress.runs, 2);
    assert.equal(wordpress.tokensIn, 1200);
    assert.equal(wordpress.successRate, 0.5);
    assert.equal(stats.byTargetClass.find((entry) => entry.targetClass === "nginx")?.runs, 1);
    assert.equal(stats.byOutcome.find((entry) => entry.outcome === "success")?.runs, 2);
    assert.equal(stats.byOutcome.find((entry) => entry.outcome === "failure")?.runs, 1);
  });

  it("is tolerant of a corrupt trajectory.json", () => {
    const dir = writeRunDir(root, "eng-corrupt", {
      "trajectory.json": "{ not valid json",
      "metrics.json": JSON.stringify(sampleMetrics()),
      "events.jsonl": `${eventLine(1)}\n{broken line\n`,
    });
    const result = ingestEngagementDir(store, dir);
    assert.equal(result.ingested, true);
    assert.equal(result.source, "metrics", "falls through to metrics.json");
    assert.ok(result.warnings.some((warning) => warning.includes("trajectory.json unreadable")));
    assert.ok(result.warnings.some((warning) => warning.includes("events.jsonl")));
    assert.equal(result.events, 1);
    assert.equal(store.getRun("run-alpha")?.run.tokensIn, 1000);
  });

  it("ignores a UTF-8 BOM on JSON artifacts", () => {
    const dir = writeRunDir(root, "eng-bom", {
      "trajectory.json": `\uFEFF${JSON.stringify(sampleRecord())}`,
      "metrics.json": `\uFEFF${JSON.stringify(sampleMetrics())}`,
    });
    const result = ingestEngagementDir(store, dir);
    assert.equal(result.ingested, true);
    assert.equal(result.source, "trajectory", "a BOM does not make the file unreadable");
    assert.equal(result.warnings.length, 0);
    assert.equal(store.getRun("run-alpha")?.run.tokensIn, 1000);
  });

  it("falls back to events.jsonl for legacy runs without trajectory files", () => {
    const dir = writeRunDir(root, "eng-legacy", {
      "state.json": JSON.stringify({
        engagementId: "eng-legacy",
        target: "https://shop.example.test/checkout",
        status: "complete",
        findings: [{ title: "one" }, { title: "two" }],
        startedAt: "2026-10-18T10:00:00.000Z",
        updatedAt: "2026-10-18T10:05:00.000Z",
      }),
      "events.jsonl": `${eventLine(1)}\n${eventLine(2)}\n`,
    });
    const result = ingestEngagementDir(store, dir);
    assert.equal(result.ingested, true);
    assert.equal(result.source, "events");
    assert.equal(result.events, 2);
    assert.ok(result.warnings.some((warning) => warning.includes("metrics derived from state.json")));
    const detail = store.getRun("eng-legacy");
    assert.ok(detail);
    assert.equal(detail.run.targetClass, "shop.example.test");
    assert.equal(detail.run.outcome, "success");
    assert.equal(detail.run.vulnsFound, 2);
    assert.equal(detail.run.exploitsAttempted, 2, "tool calls counted from the event log");
    assert.equal(detail.run.tokensIn, 0, "legacy runs honestly report zero tokens");
  });

  it("walks live and archive, then skips unchanged runs", () => {
    const tree = join(root, "engagements-tree");
    writeRunDir(join(tree, "engagements", "live"), "eng-one", { "trajectory.json": JSON.stringify(sampleRecord()) });
    writeRunDir(join(tree, "engagements", "archive"), "eng-two", {
      "trajectory.json": JSON.stringify(sampleRecord({ runId: "run-two", engagementId: "eng-two" })),
    });
    const first = ingestRoot(store, tree);
    assert.equal(first.scanned, 2);
    assert.equal(first.ingested, 2);
    const second = ingestRoot(store, tree);
    assert.equal(second.ingested, 0);
    assert.equal(second.skipped, 2, "unchanged mtimes are skipped");
    const changed = join(tree, "engagements", "live", "eng-one", "trajectory.json");
    const later = new Date(Date.now() + 60000);
    utimesSync(changed, later, later);
    const third = ingestRoot(store, tree);
    assert.equal(third.ingested, 1, "a touched run is re-ingested");
    assert.equal(third.skipped, 1);
    assert.equal(store.listRuns().length, 2);
  });

  it("dispatches CLI commands and rejects bad input with exit 1", () => {
    store.upsertRun(sampleRecord());
    store.close();
    const list = cli("list");
    assert.equal(list.code, 0);
    assert.match(list.out, /RUN ID/);
    assert.match(list.out, /run-alpha/);
    const get = cli("get", "run-alpha");
    assert.equal(get.code, 0);
    assert.equal(JSON.parse(get.out).run.tokensIn, 1000);
    assert.equal(JSON.parse(cli("stats").out).total, 1);
    const missing = cli("get", "run-missing");
    assert.equal(missing.code, 1);
    assert.match(missing.out, /no run "run-missing"/);
    assert.match(cli("frobnicate").out, /unknown command/);
    assert.match(cli("list", "--outcome", "triumph").out, /--outcome must be one of/);
    assert.match(cli("list", "--limit", "0").out, /--limit must be a positive integer/);
    assert.match(cli("ingest").out, /ingest needs --engagement/);
    store = openHarness2Store(resolveHarness2Paths());
  });

  it("ingests through the CLI ingest command", () => {
    const dir = writeRunDir(root, "eng-cli", { "trajectory.json": JSON.stringify(sampleRecord()) });
    const ingest = cli("ingest", "--engagement", dir);
    assert.equal(ingest.code, 0);
    const summary = JSON.parse(ingest.out);
    assert.equal(summary.ingested, true);
    assert.equal(summary.runId, "run-alpha");
    assert.equal(ingestRoot(store, root).scanned, 0, "no engagement tree under the harness root");
  });
});
