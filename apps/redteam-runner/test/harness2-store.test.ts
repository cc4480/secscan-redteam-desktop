/**
 * Harness2 section-5 trajectory store (H2-P1).
 *
 * Pins what the tuner depends on: the exact three-table section-5 schema opened
 * in WAL, idempotent migration (including the pre-production v1 -> v2 upgrade),
 * a faithful round-trip of runs/metrics/steps (full text, never truncated),
 * ordered steps, re-ingest without duplication, class/failure-mode aggregation,
 * tolerant ingest of half-written and legacy directories, the steps journal and
 * run.json artifacts, and the CLI surface (list/get/stats/ingest/ingest-root).
 *
 * Every test opens the store on a temp DSH_HARNESS2_ROOT, so the real
 * E:\secscan-harness2 database is never touched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { resolveHarness2Paths, type RunMetrics, type TrajectoryEvent, type TrajectoryRecord } from "../src/harness2/contract.js";
import { ingestEngagementDir, ingestRoot, openHarness2Store } from "../src/harness2/store.js";
import type { Harness2Store, StepInput } from "../src/harness2/store.js";
import { dispatchCli, type CliIo } from "../src/harness2/cli.js";

let root: string;
let previousRoot: string | undefined;
let store: Harness2Store;

const RUNS_COLUMNS = [
  "run_id",
  "ts",
  "target_class",
  "target_subclass",
  "target_id",
  "harness_version",
  "layer_set",
  "cycle_ref",
];
const STEPS_COLUMNS = ["run_id", "seq", "role", "tool_name", "content", "tokens"];
const METRICS_COLUMNS = [
  "run_id",
  "success",
  "vulns_found",
  "claims_total",
  "false_positives",
  "steps_count",
  "tokens_total",
  "crashed",
  "failure_mode",
];

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
    harness: { runnerVersion: "0.37.1", layerIds: ["base", "wp-hardening"], componentHashes: { memory: "aa" } },
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

function sampleStep(over: Partial<StepInput> = {}): StepInput {
  return { role: "prompt", content: "system+user", ...over };
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

/** Open a second connection to the store database (schema/WAL assertions). */
function withDb<T>(read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(store.paths.database);
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function tableNames(): string[] {
  return withDb((db) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => String(row["name"])),
  );
}

function columns(table: string): string[] {
  return withDb((db) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String(row["name"])),
  );
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

describe("harness2 store (section 5)", () => {
  it("opens in WAL mode with exactly the section-5 tables and columns", () => {
    assert.equal(withDb((db) => db.prepare("PRAGMA journal_mode").get()?.["journal_mode"]), "wal");
    assert.equal(withDb((db) => db.prepare("PRAGMA user_version").get()?.["user_version"]), 2);
    assert.deepEqual(tableNames(), ["metrics", "runs", "steps"]);
    assert.deepEqual(columns("runs"), RUNS_COLUMNS);
    assert.deepEqual(columns("steps"), STEPS_COLUMNS);
    assert.deepEqual(columns("metrics"), METRICS_COLUMNS);
  });

  it("migrates idempotently and keeps data across a reopen", () => {
    store.migrate();
    store.upsertRun(sampleRecord());
    store.migrate();
    store.close();
    store = openHarness2Store(resolveHarness2Paths());
    assert.equal(store.listRuns().length, 1, "migrate must not drop rows");
    assert.equal(store.getRun("run-alpha")?.steps.length, 2, "migrate must not drop steps");
  });

  it("round-trips runs, metrics and full-text steps", () => {
    const long = `${"A".repeat(50000)}-tail`;
    store.upsertRun(sampleRecord(), [
      sampleStep({ content: "system+user prompt" }),
      { role: "tool", toolName: "http_probe", content: '{"url":"https://example.test"}' },
      { role: "observation", content: long, tokens: 42 },
    ]);
    const detail = store.getRun("run-alpha");
    assert.ok(detail, "run is stored");
    assert.equal(detail.run.targetClass, "wordpress");
    assert.equal(detail.run.targetId, "eng-alpha");
    assert.equal(detail.run.harnessVersion, "0.37.1");
    assert.deepEqual([...detail.run.layerSet], ["base", "wp-hardening"]);
    assert.equal(detail.run.ts, Date.parse("2026-10-18T10:01:00.000Z"), "ts is finishedAt epoch ms");
    assert.equal(detail.run.success, true);
    assert.equal(detail.run.outcome, "success");
    assert.equal(detail.run.vulnsFound, 3);
    assert.equal(detail.run.falsePositives, 1);
    assert.equal(detail.run.claimsTotal, 4, "claims = findings + false claims");
    assert.equal(detail.run.stepsCount, 12);
    assert.equal(detail.run.tokensTotal, 1500, "section 5 keeps one token total");
    assert.equal(detail.run.failureMode, "none");
    assert.deepEqual(detail.steps.map((step) => step.seq), [1, 2, 3]);
    assert.deepEqual(detail.steps.map((step) => step.role), ["prompt", "tool", "observation"]);
    assert.equal(detail.steps[1]?.toolName, "http_probe");
    assert.equal(detail.steps[2]?.content.length, long.length, "full text is never truncated");
    assert.equal(detail.steps[2]?.content.endsWith("-tail"), true);
    assert.equal(detail.steps[2]?.tokens, 42);
    assert.equal(store.getRun("run-missing"), null);
  });

  it("derives failure_mode and crashed from the contract outcome", () => {
    store.upsertRun(sampleRecord({ runId: "run-fail", outcome: "failure", vulnsFound: 0 }));
    store.upsertRun(sampleRecord({ runId: "run-partial", outcome: "partial", vulnsFound: 1 }));
    store.upsertRun(sampleRecord({ runId: "run-aborted", outcome: "aborted" }));
    assert.equal(store.getRun("run-fail")?.run.failureMode, "missed-vuln");
    assert.equal(store.getRun("run-fail")?.run.outcome, "failure");
    assert.equal(store.getRun("run-partial")?.run.failureMode, "none");
    assert.equal(store.getRun("run-partial")?.run.outcome, "partial");
    assert.equal(store.getRun("run-aborted")?.run.crashed, true);
    assert.equal(store.getRun("run-aborted")?.run.outcome, "aborted");
  });

  it("maps legacy events to ordered steps", () => {
    store.upsertRun(sampleRecord({}, [sampleEvent(1), sampleEvent(2), sampleEvent(3, { isToolCall: false, action: "note" })]));
    assert.equal(store.appendSteps("run-alpha", [sampleStep({ content: "tail" })]), 1);
    const detail = store.getRun("run-alpha");
    assert.ok(detail);
    assert.deepEqual(detail.steps.map((step) => step.seq), [1, 2, 3, 4]);
    assert.deepEqual(detail.steps.map((step) => step.role), ["tool", "tool", "observation", "prompt"]);
    assert.equal(detail.steps[2]?.content, "note: probe 3 ok");
    assert.equal(detail.steps[3]?.content, "tail");
  });

  it("lists runs by class, derived outcome and limit", () => {
    store.upsertRun(sampleRecord());
    store.upsertRun(sampleRecord({ runId: "run-beta", engagementId: "eng-beta", targetClass: "nginx", outcome: "failure", vulnsFound: 0 }));
    store.upsertRun(sampleRecord({ runId: "run-gamma", engagementId: "eng-gamma", outcome: "failure", vulnsFound: 0 }));
    assert.equal(store.listRuns().length, 3);
    assert.equal(store.listRuns({ targetClass: "wordpress" }).length, 2);
    assert.equal(store.listRuns({ outcome: "failure" }).length, 2);
    assert.equal(store.listRuns({ outcome: "success" }).length, 1);
    assert.equal(store.listRuns({ targetClass: "wordpress", outcome: "failure" }).length, 1);
    assert.equal(store.listRuns({ limit: 1 }).length, 1);
    assert.equal(store.listRuns()[0]?.runId, "run-alpha", "newest ts first (all share the sample timestamp, stable id order)");
  });

  it("aggregates stats by target class and failure mode", () => {
    store.upsertRun(sampleRecord());
    store.upsertRun(
      sampleRecord({ runId: "run-beta", engagementId: "eng-beta", outcome: "failure", vulnsFound: 0, steps: 5, tokensIn: 200, tokensOut: 100 }),
    );
    store.upsertRun(sampleRecord({ runId: "run-gamma", engagementId: "eng-gamma", targetClass: "nginx", vulnsFound: 2, steps: 7, tokensIn: 400, tokensOut: 200 }));
    const stats = store.runStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.successes, 2);
    assert.equal(stats.totalVulns, 5);
    assert.equal(stats.totalFalsePositives, 3);
    assert.equal(stats.totalSteps, 24);
    assert.equal(stats.totalTokens, 2400);
    const wordpress = stats.byTargetClass.find((entry) => entry.targetClass === "wordpress");
    assert.ok(wordpress);
    assert.equal(wordpress.runs, 2);
    assert.equal(wordpress.tokensTotal, 1800);
    assert.equal(wordpress.successRate, 0.5);
    assert.equal(stats.byFailureMode.find((entry) => entry.failureMode === "missed-vuln")?.runs, 1);
    assert.equal(stats.byFailureMode.find((entry) => entry.failureMode === "none")?.runs, 2);
  });

  it("ingests steps.jsonl and an explicit run.json", () => {
    const long = "B".repeat(40000);
    const runJson = {
      run: {
        run_id: "run-explicit",
        ts: 1792330000000,
        target_class: "windows",
        target_subclass: "active-directory",
        target_id: "eng-explicit",
        harness_version: "0.38.0",
        layer_set: JSON.stringify(["base", "ad-layer"]),
        cycle_ref: null,
      },
      metrics: {
        run_id: "run-explicit",
        success: 0,
        vulns_found: 2,
        claims_total: 5,
        false_positives: 3,
        steps_count: 3,
        tokens_total: 9876,
        crashed: 0,
        failure_mode: "fp-blowup",
      },
    };
    const journal = [
      JSON.stringify({ run_id: "run-explicit", seq: 1, ts: "2026-10-18T10:00:00.000Z", role: "prompt", tool_name: null, content: "outgoing", tokens: 900 }),
      JSON.stringify({ run_id: "run-explicit", seq: 2, ts: "2026-10-18T10:00:01.000Z", role: "tool", tool_name: "winrm_exec", content: '{"cmd":"whoami"}', tokens: null }),
      JSON.stringify({ run_id: "run-explicit", seq: 3, ts: "2026-10-18T10:00:02.000Z", role: "observation", tool_name: "winrm_exec", content: long, tokens: 12 }),
      "{ broken line",
    ].join("\n");
    const dir = writeRunDir(root, "eng-explicit", { "run.json": JSON.stringify(runJson), "steps.jsonl": journal });
    const result = ingestEngagementDir(store, dir);
    assert.equal(result.ingested, true);
    assert.equal(result.source, "run");
    assert.equal(result.steps, 3);
    assert.ok(result.warnings.some((warning) => warning.includes("steps.jsonl")));
    const detail = store.getRun("run-explicit");
    assert.ok(detail);
    assert.equal(detail.run.ts, 1792330000000);
    assert.equal(detail.run.targetSubclass, "active-directory");
    assert.equal(detail.run.cycleRef, undefined);
    assert.deepEqual([...detail.run.layerSet], ["base", "ad-layer"]);
    assert.equal(detail.run.success, false);
    assert.equal(detail.run.claimsTotal, 5);
    assert.equal(detail.run.failureMode, "fp-blowup");
    assert.equal(detail.run.outcome, "failure");
    assert.equal(detail.run.tokensTotal, 9876);
    assert.deepEqual(detail.steps.map((step) => step.role), ["prompt", "tool", "observation"]);
    assert.equal(detail.steps[1]?.toolName, "winrm_exec");
    assert.equal(detail.steps[2]?.content, long, "the steps journal is stored verbatim");
    assert.equal(detail.steps[0]?.tokens, 900);
  });

  it("falls back to the contract metrics when run.json is unusable", () => {
    const dir = writeRunDir(root, "eng-bad-run-json", {
      "run.json": JSON.stringify({ run: {}, metrics: {} }),
      "metrics.json": JSON.stringify(sampleMetrics()),
    });
    const result = ingestEngagementDir(store, dir);
    assert.equal(result.source, "metrics", "no usable run_id: contract metrics win");
    assert.ok(result.warnings.some((warning) => warning.includes("run.json")));
    assert.equal(store.getRun("run-alpha")?.run.tokensTotal, 1500);
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
    assert.equal(detail.steps.length, 2, "steps are replaced, not appended");
    assert.equal(detail.run.tokensTotal, 1500);
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
    assert.equal(result.steps, 1);
    assert.equal(store.getRun("run-alpha")?.run.tokensTotal, 1500);
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
    assert.equal(store.getRun("run-alpha")?.run.tokensTotal, 1500);
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
    assert.equal(result.steps, 2);
    assert.ok(result.warnings.some((warning) => warning.includes("metrics derived from state.json")));
    const detail = store.getRun("eng-legacy");
    assert.ok(detail);
    assert.equal(detail.run.targetClass, "shop.example.test");
    assert.equal(detail.run.outcome, "success");
    assert.equal(detail.run.vulnsFound, 2);
    assert.equal(detail.run.claimsTotal, 2);
    assert.equal(detail.run.tokensTotal, 0, "legacy runs honestly report zero tokens");
    assert.equal(detail.steps[0]?.role, "tool");
    assert.equal(detail.steps[0]?.toolName, "probe_1");
    assert.equal(detail.steps[0]?.content, "probe 1 ok");
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
    assert.equal(ingestRoot(store, tree, { force: true }).ingested, 2, "force re-ingests everything");
  });

  it("enforces the section-5 parent/child foreign key", () => {
    withDb((db) => {
      db.exec("PRAGMA foreign_keys = ON");
      assert.throws(() =>
        db.prepare("INSERT INTO steps (run_id, seq, role, content) VALUES ('missing-run', 1, 'prompt', 'x')").run(),
      );
    });
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
    assert.equal(JSON.parse(get.out).run.tokensTotal, 1500);
    assert.equal(JSON.parse(get.out).steps.length, 2);
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

  it("ingests through the CLI ingest and ingest-root commands", () => {
    const dir = writeRunDir(root, "eng-cli", { "trajectory.json": JSON.stringify(sampleRecord()) });
    const ingest = cli("ingest", "--engagement", dir);
    assert.equal(ingest.code, 0);
    const summary = JSON.parse(ingest.out);
    assert.equal(summary.ingested, true);
    assert.equal(summary.runId, "run-alpha");
    assert.equal(summary.steps, 2);
    assert.equal(ingestRoot(store, root).scanned, 0, "no engagement tree under the harness root");
    const tree = join(root, "tree");
    writeRunDir(join(tree, "engagements", "live"), "eng-cli-two", { "trajectory.json": JSON.stringify(sampleRecord({ runId: "run-cli-two" })) });
    const rootIngest = cli("ingest-root", "--root", tree);
    assert.equal(rootIngest.code, 0);
    assert.equal(JSON.parse(rootIngest.out).ingested, 1);
  });

  it("migrates a pre-production v1 store to the section-5 schema", () => {
    const dbPath = store.paths.database;
    store.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, target_class TEXT NOT NULL, outcome TEXT NOT NULL,
        vulns_found INTEGER NOT NULL DEFAULT 0, false_positives INTEGER NOT NULL DEFAULT 0,
        exploits_succeeded INTEGER NOT NULL DEFAULT 0, exploits_attempted INTEGER NOT NULL DEFAULT 0,
        steps INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0, runner_version TEXT NOT NULL DEFAULT 'unknown', commit_sha TEXT,
        layer_ids TEXT NOT NULL DEFAULT '[]', component_hashes TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '', ingested_at TEXT NOT NULL,
        source_path TEXT, source_mtime_ms INTEGER
      );
      CREATE TABLE events (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, phase TEXT NOT NULL, actor TEXT NOT NULL,
        action TEXT NOT NULL, attack_id TEXT, target TEXT, result TEXT NOT NULL, is_tool_call INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, seq)
      );
      CREATE TABLE components (run_id TEXT NOT NULL, component TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY (run_id, component));
      CREATE TABLE outcomes (run_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (run_id, metric));
    `);
    legacy
      .prepare(
        `INSERT INTO runs (run_id, engagement_id, target_class, outcome, vulns_found, false_positives, steps,
          tokens_in, tokens_out, runner_version, layer_ids, started_at, finished_at, ingested_at)
         VALUES ('run-v1', 'eng-v1', 'wordpress', 'failure', 0, 2, 9, 300, 100, '0.36.0', '["base","wp"]',
           '2026-10-18T09:00:00.000Z', '2026-10-18T09:10:00.000Z', '2026-10-18T09:11:00.000Z')`,
      )
      .run();
    legacy
      .prepare("INSERT INTO events (run_id, seq, ts, phase, actor, action, result, is_tool_call) VALUES ('run-v1', 1, 't', 'recon', 'recon', 'http_probe', '200 ok', 1)")
      .run();
    legacy.prepare("INSERT INTO components (run_id, component, sha256) VALUES ('run-v1', 'memory', 'aa')").run();
    legacy.prepare("INSERT INTO outcomes (run_id, metric, value) VALUES ('run-v1', 'tokens_in', 300)").run();
    legacy.exec("PRAGMA user_version = 1");
    legacy.close();

    store = openHarness2Store(resolveHarness2Paths());
    const detail = store.getRun("run-v1");
    assert.ok(detail, "v1 run survives the migration");
    assert.equal(detail.run.targetClass, "wordpress");
    assert.equal(detail.run.targetId, "eng-v1");
    assert.equal(detail.run.harnessVersion, "0.36.0");
    assert.deepEqual([...detail.run.layerSet], ["base", "wp"]);
    assert.equal(detail.run.ts, Date.parse("2026-10-18T09:10:00.000Z"));
    assert.equal(detail.run.outcome, "failure");
    assert.equal(detail.run.failureMode, "missed-vuln");
    assert.equal(detail.run.claimsTotal, 2, "claims = vulns_found + false_positives");
    assert.equal(detail.run.tokensTotal, 400);
    assert.equal(detail.run.stepsCount, 9);
    assert.equal(detail.steps.length, 1, "v1 events become steps");
    assert.equal(detail.steps[0]?.role, "tool");
    assert.equal(detail.steps[0]?.toolName, "http_probe");
    assert.deepEqual(tableNames(), ["metrics", "runs", "steps"], "v1 tables are gone");
    assert.equal(withDb((db) => db.prepare("PRAGMA journal_mode").get()?.["journal_mode"]), "wal");
  });
});
