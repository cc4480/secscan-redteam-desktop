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
export declare function tableExists(db: DatabaseSync, table: string): boolean;
/** True when `table` has a column named `column` (used to detect a v1 store). */
export declare function hasColumn(db: DatabaseSync, table: string, column: string): boolean;
export declare const SCHEMA_VERSION = 2;
export declare const SCHEMA = "\nCREATE TABLE IF NOT EXISTS runs (\n  run_id TEXT PRIMARY KEY,\n  ts INTEGER NOT NULL,\n  target_class TEXT NOT NULL,\n  target_subclass TEXT,\n  target_id TEXT,\n  harness_version TEXT NOT NULL,\n  layer_set TEXT NOT NULL DEFAULT '[]',\n  cycle_ref TEXT\n);\nCREATE TABLE IF NOT EXISTS steps (\n  run_id TEXT NOT NULL REFERENCES runs (run_id) ON DELETE CASCADE,\n  seq INTEGER NOT NULL,\n  role TEXT NOT NULL CHECK (role IN ('prompt', 'tool', 'observation')),\n  tool_name TEXT,\n  content TEXT NOT NULL,\n  tokens INTEGER,\n  PRIMARY KEY (run_id, seq)\n);\nCREATE TABLE IF NOT EXISTS metrics (\n  run_id TEXT NOT NULL UNIQUE REFERENCES runs (run_id) ON DELETE CASCADE,\n  success INTEGER NOT NULL CHECK (success IN (0, 1)),\n  vulns_found INTEGER NOT NULL DEFAULT 0,\n  claims_total INTEGER NOT NULL DEFAULT 0,\n  false_positives INTEGER NOT NULL DEFAULT 0,\n  steps_count INTEGER NOT NULL DEFAULT 0,\n  tokens_total INTEGER NOT NULL DEFAULT 0,\n  crashed INTEGER NOT NULL CHECK (crashed IN (0, 1)),\n  failure_mode TEXT CHECK (\n    failure_mode IS NULL OR failure_mode IN\n      ('missed-vuln', 'fp-blowup', 'tool-error', 'step-exhaustion', 'timeout', 'none')\n  )\n);\nCREATE INDEX IF NOT EXISTS idx_runs_class_ts ON runs (target_class, ts DESC);\nCREATE INDEX IF NOT EXISTS idx_steps_run_seq ON steps (run_id, seq);\n";
/** The four tables of the pre-production v1 store, in rename order. */
export declare const V1_TABLES: readonly ["runs", "events", "components", "outcomes"];
/**
 * v1 rows -> section-5 rows. Only valid after V1_TABLES were renamed to
 * `v1_<name>`; callers guard each statement on the renamed table existing.
 */
export declare const MIGRATE_RUNS = "\nINSERT INTO runs (run_id, ts, target_class, target_subclass, target_id, harness_version, layer_set, cycle_ref)\nSELECT run_id,\n  CAST(COALESCE(strftime('%s', finished_at), strftime('%s', started_at), '0') AS INTEGER) * 1000,\n  CASE WHEN target_class = '' THEN 'unknown' ELSE target_class END,\n  NULL,\n  engagement_id,\n  CASE WHEN runner_version = '' THEN 'unknown' ELSE runner_version END,\n  CASE WHEN layer_ids IS NULL OR layer_ids = '' THEN '[]' ELSE layer_ids END,\n  NULL\nFROM v1_runs";
export declare const MIGRATE_METRICS = "\nINSERT INTO metrics (run_id, success, vulns_found, claims_total, false_positives, steps_count, tokens_total, crashed, failure_mode)\nSELECT run_id,\n  CASE WHEN outcome = 'success' THEN 1 ELSE 0 END,\n  vulns_found,\n  vulns_found + false_positives,\n  false_positives,\n  steps,\n  tokens_in + tokens_out,\n  CASE WHEN outcome = 'aborted' THEN 1 ELSE 0 END,\n  CASE WHEN outcome = 'failure' AND vulns_found = 0 THEN 'missed-vuln' ELSE 'none' END\nFROM v1_runs";
export declare const MIGRATE_STEPS = "\nINSERT INTO steps (run_id, seq, role, tool_name, content, tokens)\nSELECT e.run_id, e.seq,\n  CASE WHEN e.is_tool_call = 1 THEN 'tool' ELSE 'observation' END,\n  CASE WHEN e.is_tool_call = 1 THEN e.action ELSE NULL END,\n  CASE WHEN e.is_tool_call = 1 THEN e.result ELSE e.action || ': ' || e.result END,\n  NULL\nFROM v1_events e\nWHERE EXISTS (SELECT 1 FROM runs r WHERE r.run_id = e.run_id)";
export declare const UPSERT_RUN = "\nINSERT OR REPLACE INTO runs (run_id, ts, target_class, target_subclass, target_id, harness_version, layer_set, cycle_ref)\nVALUES (:run_id, :ts, :target_class, :target_subclass, :target_id, :harness_version, :layer_set, :cycle_ref)";
export declare const UPSERT_METRICS = "\nINSERT OR REPLACE INTO metrics (run_id, success, vulns_found, claims_total, false_positives, steps_count, tokens_total, crashed, failure_mode)\nVALUES (:run_id, :success, :vulns_found, :claims_total, :false_positives, :steps_count, :tokens_total, :crashed, :failure_mode)";
export declare const INSERT_STEP = "\nINSERT OR REPLACE INTO steps (run_id, seq, role, tool_name, content, tokens)\nVALUES (:run_id, :seq, :role, :tool_name, :content, :tokens)";
/** runs joined with metrics; every row written by the store has both. */
export declare const SELECT_RUN = "\nSELECT r.run_id AS run_id, r.ts AS ts, r.target_class AS target_class, r.target_subclass AS target_subclass,\n  r.target_id AS target_id, r.harness_version AS harness_version, r.layer_set AS layer_set, r.cycle_ref AS cycle_ref,\n  m.success AS success, m.vulns_found AS vulns_found, m.claims_total AS claims_total,\n  m.false_positives AS false_positives, m.steps_count AS steps_count, m.tokens_total AS tokens_total,\n  m.crashed AS crashed, m.failure_mode AS failure_mode\nFROM runs r LEFT JOIN metrics m ON m.run_id = r.run_id";
export declare const STATS_TOTALS = "\nSELECT COUNT(*) AS runs, COALESCE(SUM(m.success), 0) AS successes, COALESCE(SUM(m.crashed), 0) AS crashed,\n  COALESCE(SUM(m.vulns_found), 0) AS vulns_found, COALESCE(SUM(m.claims_total), 0) AS claims_total,\n  COALESCE(SUM(m.false_positives), 0) AS false_positives, COALESCE(SUM(m.steps_count), 0) AS steps_count,\n  COALESCE(SUM(m.tokens_total), 0) AS tokens_total\nFROM runs r LEFT JOIN metrics m ON m.run_id = r.run_id";
export declare const STATS_BY_CLASS = "\nSELECT r.target_class AS target_class, COUNT(*) AS runs, COALESCE(SUM(m.success), 0) AS successes,\n  COALESCE(SUM(m.crashed), 0) AS crashed, COALESCE(SUM(m.vulns_found), 0) AS vulns_found,\n  COALESCE(SUM(m.claims_total), 0) AS claims_total, COALESCE(SUM(m.false_positives), 0) AS false_positives,\n  COALESCE(SUM(m.steps_count), 0) AS steps_count, COALESCE(SUM(m.tokens_total), 0) AS tokens_total,\n  AVG(CASE WHEN m.success = 1 THEN 1.0 ELSE 0.0 END) AS success_rate\nFROM runs r LEFT JOIN metrics m ON m.run_id = r.run_id\nGROUP BY r.target_class ORDER BY runs DESC, target_class ASC";
export declare const STATS_BY_FAILURE_MODE = "\nSELECT COALESCE(m.failure_mode, 'none') AS failure_mode, COUNT(*) AS runs,\n  COALESCE(SUM(m.vulns_found), 0) AS vulns_found, COALESCE(SUM(m.false_positives), 0) AS false_positives\nFROM runs r LEFT JOIN metrics m ON m.run_id = r.run_id\nGROUP BY COALESCE(m.failure_mode, 'none') ORDER BY runs DESC, failure_mode ASC";
