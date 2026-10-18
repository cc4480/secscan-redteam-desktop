/**
 * Harness2 trajectory store (H2-P1b).
 *
 * One SQLite database under DSH_HARNESS2_ROOT holds every ingested run, so the
 * tuner can ask questions of past engagements ("which target class turns steps
 * into findings?") without re-reading the engagement tree. node:sqlite is built
 * into the bundled Node 24, so this adds no dependency; the store refuses to
 * create its database outside the configured root.
 *
 * Schema and DDL live in ./store-schema.ts, row shapes and mapping in
 * ./store-model.ts, ingestion in ./ingest.ts and ./walk.ts. This file owns the
 * connection and the queries.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  resolveHarness2Paths,
  type Harness2Paths,
  type TrajectoryEvent,
  type TrajectoryRecord,
} from "./contract.js";
import {
  integer,
  rowToClassStat,
  rowToEvent,
  rowToOutcomeStat,
  rowToRun,
  text,
  type Harness2Store,
  type IngestSourceStamp,
  type RunDetail,
  type RunFilter,
  type RunRow,
  type RunStats,
} from "./store-model.js";
import { SCHEMA, SCHEMA_VERSION, UPSERT_RUN } from "./store-schema.js";

/**
 * Open (and lazily create) the store. The database must live inside
 * `paths.root`, so a malformed DSH_HARNESS2_ROOT cannot scatter files elsewhere
 * on the box. migrate() runs on open and is idempotent.
 */
export function openHarness2Store(paths: Harness2Paths = resolveHarness2Paths()): Harness2Store {
  const root = resolve(paths.root);
  const database = resolve(paths.database);
  if (database !== root && !database.startsWith(root + sep)) {
    throw new Error(`[harness2] database ${database} would be written outside root ${root}`);
  }
  mkdirSync(root, { recursive: true });
  mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);

  function readSchemaVersion(): number {
    const row = db.prepare("PRAGMA user_version").get() ?? {};
    return integer(row, "user_version");
  }

  function migrate(): void {
    const version = readSchemaVersion();
    if (version > SCHEMA_VERSION) {
      throw new Error(`[harness2] database schema v${version} is newer than this code (v${SCHEMA_VERSION})`);
    }
    // The version stamp is the authority: an up-to-date file needs no DDL at
    // all, which is what keeps an on-demand CLI invocation in the milliseconds.
    if (version === SCHEMA_VERSION) return;
    // First run only: one transaction, so creating the schema costs one fsync
    // instead of one per DDL statement (half a second on a pulled-back E: drive).
    db.exec("BEGIN");
    try {
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function insertEventsRaw(runId: string, events: readonly TrajectoryEvent[], offset = 0): void {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO events (run_id, seq, ts, phase, actor, action, attack_id, target, result, is_tool_call)
       VALUES (:run_id, :seq, :ts, :phase, :actor, :action, :attack_id, :target, :result, :is_tool_call)`,
    );
    events.forEach((event, index) => {
      stmt.run({
        run_id: runId,
        seq: offset + index + 1,
        ts: event.ts,
        phase: event.phase,
        actor: event.actor,
        action: event.action,
        attack_id: event.attackId ?? null,
        target: event.target ?? null,
        result: event.result,
        is_tool_call: event.isToolCall ? 1 : 0,
      });
    });
  }

  function upsertRun(record: TrajectoryRecord, source?: IngestSourceStamp): RunRow {
    const metrics = record.metrics;
    const runId = metrics.runId;
    const params: Record<string, string | number | null> = {
      run_id: runId,
      engagement_id: metrics.engagementId || runId,
      target_class: metrics.targetClass || "unknown",
      outcome: metrics.outcome,
      vulns_found: metrics.vulnsFound,
      false_positives: metrics.falsePositives,
      exploits_succeeded: metrics.exploitsSucceeded,
      exploits_attempted: metrics.exploitsAttempted,
      steps: metrics.steps,
      tokens_in: metrics.tokensIn,
      tokens_out: metrics.tokensOut,
      duration_ms: metrics.durationMs,
      runner_version: metrics.harness.runnerVersion || "unknown",
      commit_sha: metrics.harness.commit ?? null,
      layer_ids: JSON.stringify(metrics.harness.layerIds),
      component_hashes: JSON.stringify(metrics.harness.componentHashes),
      started_at: metrics.startedAt,
      finished_at: metrics.finishedAt,
      ingested_at: new Date().toISOString(),
      source_path: source?.path ?? null,
      source_mtime_ms: source?.mtimeMs ?? null,
    };
    const metricRows: readonly (readonly [string, number])[] = [
      ["vulns_found", metrics.vulnsFound],
      ["false_positives", metrics.falsePositives],
      ["exploits_succeeded", metrics.exploitsSucceeded],
      ["exploits_attempted", metrics.exploitsAttempted],
      ["steps", metrics.steps],
      ["tokens_in", metrics.tokensIn],
      ["tokens_out", metrics.tokensOut],
      ["duration_ms", metrics.durationMs],
    ];
    db.exec("BEGIN");
    try {
      db.prepare(UPSERT_RUN).run(params);
      db.prepare("DELETE FROM events WHERE run_id = :run_id").run({ run_id: runId });
      db.prepare("DELETE FROM components WHERE run_id = :run_id").run({ run_id: runId });
      db.prepare("DELETE FROM outcomes WHERE run_id = :run_id").run({ run_id: runId });
      insertEventsRaw(runId, record.events);
      const componentStmt = db.prepare(
        "INSERT OR REPLACE INTO components (run_id, component, sha256) VALUES (:run_id, :component, :sha256)",
      );
      for (const [component, sha256] of Object.entries(metrics.harness.componentHashes)) {
        if (typeof sha256 === "string" && sha256 !== "") componentStmt.run({ run_id: runId, component, sha256 });
      }
      const outcomeStmt = db.prepare(
        "INSERT OR REPLACE INTO outcomes (run_id, metric, value) VALUES (:run_id, :metric, :value)",
      );
      for (const [metric, value] of metricRows) outcomeStmt.run({ run_id: runId, metric, value });
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    const detail = getRun(runId);
    if (detail === null) throw new Error(`[harness2] run ${runId} vanished after upsert`);
    return detail.run;
  }

  function insertEvents(runId: string, events: readonly TrajectoryEvent[]): number {
    const row = db.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events WHERE run_id = ?").get(runId) ?? {};
    insertEventsRaw(runId, events, integer(row, "max_seq"));
    return events.length;
  }

  function getRunBySourcePath(sourcePath: string): RunRow | null {
    const row = db.prepare("SELECT * FROM runs WHERE source_path = ? LIMIT 1").get(sourcePath);
    return row === undefined ? null : rowToRun(row);
  }

  function listRuns(filter: RunFilter = {}): RunRow[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.targetClass !== undefined && filter.targetClass !== "") {
      clauses.push("target_class = ?");
      params.push(filter.targetClass);
    }
    if (filter.outcome !== undefined) {
      clauses.push("outcome = ?");
      params.push(filter.outcome);
    }
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 10000);
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM runs${where} ORDER BY finished_at DESC, run_id ASC LIMIT ${limit}`)
      .all(...params);
    return rows.map(rowToRun);
  }

  function getRun(runId: string): RunDetail | null {
    const row = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId);
    if (row === undefined) return null;
    const events = db.prepare("SELECT * FROM events WHERE run_id = ? ORDER BY seq ASC").all(runId);
    const components = db.prepare("SELECT * FROM components WHERE run_id = ? ORDER BY component ASC").all(runId);
    const outcomes = db.prepare("SELECT metric, value FROM outcomes WHERE run_id = ? ORDER BY metric ASC").all(runId);
    const outcomeMap: Record<string, number> = {};
    for (const entry of outcomes) {
      const value = entry["value"];
      if (typeof value === "number") outcomeMap[text(entry, "metric")] = value;
    }
    return {
      run: rowToRun(row),
      events: events.map(rowToEvent),
      components: components.map((entry) => ({
        runId: text(entry, "run_id"),
        component: text(entry, "component"),
        sha256: text(entry, "sha256"),
      })),
      outcomes: outcomeMap,
    };
  }

  function runStats(): RunStats {
    const totalRow = db.prepare("SELECT COUNT(*) AS runs FROM runs").get() ?? {};
    const classRows = db
      .prepare(
        `SELECT target_class, COUNT(*) AS runs, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
           SUM(steps) AS steps, SUM(vulns_found) AS vulns_found, SUM(false_positives) AS false_positives,
           SUM(exploits_succeeded) AS exploits_succeeded, SUM(exploits_attempted) AS exploits_attempted,
           AVG(CASE WHEN outcome = 'success' THEN 1.0 ELSE 0.0 END) AS success_rate
         FROM runs GROUP BY target_class ORDER BY runs DESC, target_class ASC`,
      )
      .all();
    const outcomeRows = db
      .prepare(
        `SELECT outcome, COUNT(*) AS runs, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
           SUM(vulns_found) AS vulns_found, SUM(exploits_succeeded) AS exploits_succeeded
         FROM runs GROUP BY outcome ORDER BY runs DESC, outcome ASC`,
      )
      .all();
    const totals = db
      .prepare(
        "SELECT SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, SUM(steps) AS steps, SUM(duration_ms) AS duration_ms FROM runs",
      )
      .get() ?? {};
    return {
      total: integer(totalRow, "runs"),
      totalTokensIn: integer(totals, "tokens_in"),
      totalTokensOut: integer(totals, "tokens_out"),
      totalSteps: integer(totals, "steps"),
      totalDurationMs: integer(totals, "duration_ms"),
      byTargetClass: classRows.map(rowToClassStat),
      byOutcome: outcomeRows.map(rowToOutcomeStat),
    };
  }

  function close(): void {
    if (db.isOpen) db.close();
  }

  const store: Harness2Store = {
    paths,
    migrate,
    upsertRun,
    listRuns,
    getRun,
    getRunBySourcePath,
    insertEvents,
    runStats,
    close,
  };
  migrate();
  return store;
}

// Ingestion is split across two modules to keep every file inside the 300-line
// budget; re-exported here so callers only ever import the store module.
export { ingestEngagementDir } from "./ingest.js";
export { ingestRoot } from "./walk.js";
export type { IngestOptions, IngestSummary } from "./walk.js";
export type { IngestResult, IngestSource } from "./ingest.js";
export type {
  ClassStat,
  ComponentRow,
  EventRow,
  Harness2Store,
  IngestSourceStamp,
  OutcomeStat,
  RunDetail,
  RunFilter,
  RunRow,
  RunStats,
} from "./store-model.js";
