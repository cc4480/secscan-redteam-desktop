/**
 * Harness2 store schema (H2-P1, spec section 5): DDL, statements and the
 * pre-production v1 -> v2 migration.
 *
 * Exactly the three section-5 tables, opened in WAL mode:
 *
 *   runs(run_id PK, ts, target_class, target_subclass, target_id,
 *        harness_version, layer_set JSON, cycle_ref NULL)
 *   steps(run_id FK, seq, role prompt|tool|observation, tool_name,
 *         content FULL text, tokens, PK(run_id,seq))
 *   metrics(run_id FK UNIQUE, success 0|1, vulns_found, claims_total,
 *           false_positives, steps_count, tokens_total, crashed 0|1,
 *           failure_mode missed-vuln|fp-blowup|tool-error|step-exhaustion|
 *           timeout|none)
 *
 * children cascade from runs, so re-writing a run replaces its steps/metrics in
 * one statement set. Every DDL statement is IF NOT EXISTS: migrate() is
 * idempotent and the version stamp is the authority.
 *
 * MIGRATION DECISION (v1 -> v2, pre-production): the old tables
 * (runs/events/components/outcomes) are renamed, their data is copied into the
 * section-5 shape, then dropped. runs -> runs+metrics (derived with the same
 * rules as ./store-rows.ts) and events -> steps (their recorded text becomes
 * the step content); components/outcomes have no section-5 home and are
 * dropped. Nothing is invented: metrics v1 rows did not record tokens_total
 * per direction, so it is tokens_in + tokens_out, and claims_total is
 * vulns_found + false_positives.
 */
import type { DatabaseSync } from "node:sqlite";

/** True when `table` exists in the opened database. */
export function tableExists(db: DatabaseSync, table: string): boolean {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

/** True when `table` has a column named `column` (used to detect a v1 store). */
export function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => typeof row["name"] === "string" && row["name"] === column);
}

export const SCHEMA_VERSION = 2;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  target_class TEXT NOT NULL,
  target_subclass TEXT,
  target_id TEXT,
  harness_version TEXT NOT NULL,
  layer_set TEXT NOT NULL DEFAULT '[]',
  cycle_ref TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  run_id TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('prompt', 'tool', 'observation')),
  tool_name TEXT,
  content TEXT NOT NULL,
  tokens INTEGER,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS metrics (
  run_id TEXT NOT NULL UNIQUE REFERENCES runs (run_id) ON DELETE CASCADE,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  vulns_found INTEGER NOT NULL DEFAULT 0,
  claims_total INTEGER NOT NULL DEFAULT 0,
  false_positives INTEGER NOT NULL DEFAULT 0,
  steps_count INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  crashed INTEGER NOT NULL CHECK (crashed IN (0, 1)),
  failure_mode TEXT CHECK (
    failure_mode IS NULL OR failure_mode IN
      ('missed-vuln', 'fp-blowup', 'tool-error', 'step-exhaustion', 'timeout', 'none')
  )
);
CREATE INDEX IF NOT EXISTS idx_runs_class_ts ON runs (target_class, ts DESC);
CREATE INDEX IF NOT EXISTS idx_steps_run_seq ON steps (run_id, seq);
`;

/** The four tables of the pre-production v1 store, in rename order. */
export const V1_TABLES = ["runs", "events", "components", "outcomes"] as const;

/**
 * v1 rows -> section-5 rows. Only valid after V1_TABLES were renamed to
 * `v1_<name>`; callers guard each statement on the renamed table existing.
 */
export const MIGRATE_RUNS = `
INSERT INTO runs (run_id, ts, target_class, target_subclass, target_id, harness_version, layer_set, cycle_ref)
SELECT run_id,
  CAST(COALESCE(strftime('%s', finished_at), strftime('%s', started_at), '0') AS INTEGER) * 1000,
  CASE WHEN target_class = '' THEN 'unknown' ELSE target_class END,
  NULL,
  engagement_id,
  CASE WHEN runner_version = '' THEN 'unknown' ELSE runner_version END,
  CASE WHEN layer_ids IS NULL OR layer_ids = '' THEN '[]' ELSE layer_ids END,
  NULL
FROM v1_runs`;

export const MIGRATE_METRICS = `
INSERT INTO metrics (run_id, success, vulns_found, claims_total, false_positives, steps_count, tokens_total, crashed, failure_mode)
SELECT run_id,
  CASE WHEN outcome = 'success' THEN 1 ELSE 0 END,
  vulns_found,
  vulns_found + false_positives,
  false_positives,
  steps,
  tokens_in + tokens_out,
  CASE WHEN outcome = 'aborted' THEN 1 ELSE 0 END,
  CASE WHEN outcome = 'failure' AND vulns_found = 0 THEN 'missed-vuln' ELSE 'none' END
FROM v1_runs`;

export const MIGRATE_STEPS = `
INSERT INTO steps (run_id, seq, role, tool_name, content, tokens)
SELECT e.run_id, e.seq,
  CASE WHEN e.is_tool_call = 1 THEN 'tool' ELSE 'observation' END,
  CASE WHEN e.is_tool_call = 1 THEN e.action ELSE NULL END,
  CASE WHEN e.is_tool_call = 1 THEN e.result ELSE e.action || ': ' || e.result END,
  NULL
FROM v1_events e
WHERE EXISTS (SELECT 1 FROM runs r WHERE r.run_id = e.run_id)`;

export const UPSERT_RUN = `
INSERT OR REPLACE INTO runs (run_id, ts, target_class, target_subclass, target_id, harness_version, layer_set, cycle_ref)
VALUES (:run_id, :ts, :target_class, :target_subclass, :target_id, :harness_version, :layer_set, :cycle_ref)`;

export const UPSERT_METRICS = `
INSERT OR REPLACE INTO metrics (run_id, success, vulns_found, claims_total, false_positives, steps_count, tokens_total, crashed, failure_mode)
VALUES (:run_id, :success, :vulns_found, :claims_total, :false_positives, :steps_count, :tokens_total, :crashed, :failure_mode)`;

export const INSERT_STEP = `
INSERT OR REPLACE INTO steps (run_id, seq, role, tool_name, content, tokens)
VALUES (:run_id, :seq, :role, :tool_name, :content, :tokens)`;

/** runs joined with metrics; every row written by the store has both. */
export const SELECT_RUN = `
SELECT r.run_id AS run_id, r.ts AS ts, r.target_class AS target_class, r.target_subclass AS target_subclass,
  r.target_id AS target_id, r.harness_version AS harness_version, r.layer_set AS layer_set, r.cycle_ref AS cycle_ref,
  m.success AS success, m.vulns_found AS vulns_found, m.claims_total AS claims_total,
  m.false_positives AS false_positives, m.steps_count AS steps_count, m.tokens_total AS tokens_total,
  m.crashed AS crashed, m.failure_mode AS failure_mode
FROM runs r LEFT JOIN metrics m ON m.run_id = r.run_id`;

export const STATS_TOTALS = `
SELECT COUNT(*) AS runs, COALESCE(SUM(m.success), 0) AS successes, COALESCE(SUM(m.crashed), 0) AS crashed,
  COALESCE(SUM(m.vulns_found), 0) AS vulns_found, COALESCE(SUM(m.claims_total), 0) AS claims_total,
  COALESCE(SUM(m.false_positives), 0) AS false_positives, COALESCE(SUM(m.steps_count), 0) AS steps_count,
  COALESCE(SUM(m.tokens_total), 0) AS tokens_total
FROM runs r LEFT JOIN metrics m ON m.run_id = r.run_id`;

export const STATS_BY_CLASS = `
SELECT r.target_class AS target_class, COUNT(*) AS runs, COALESCE(SUM(m.success), 0) AS successes,
  COALESCE(SUM(m.crashed), 0) AS crashed, COALESCE(SUM(m.vulns_found), 0) AS vulns_found,
  COALESCE(SUM(m.claims_total), 0) AS claims_total, COALESCE(SUM(m.false_positives), 0) AS false_positives,
  COALESCE(SUM(m.steps_count), 0) AS steps_count, COALESCE(SUM(m.tokens_total), 0) AS tokens_total,
  AVG(CASE WHEN m.success = 1 THEN 1.0 ELSE 0.0 END) AS success_rate
FROM runs r LEFT JOIN metrics m ON m.run_id = r.run_id
GROUP BY r.target_class ORDER BY runs DESC, target_class ASC`;

export const STATS_BY_FAILURE_MODE = `
SELECT COALESCE(m.failure_mode, 'none') AS failure_mode, COUNT(*) AS runs,
  COALESCE(SUM(m.vulns_found), 0) AS vulns_found, COALESCE(SUM(m.false_positives), 0) AS false_positives
FROM runs r LEFT JOIN metrics m ON m.run_id = r.run_id
GROUP BY COALESCE(m.failure_mode, 'none') ORDER BY runs DESC, failure_mode ASC`;
