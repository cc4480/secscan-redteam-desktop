/**
 * Harness2 store schema (H2-P1b): DDL plus the run upsert statement.
 *
 * Four tables mirror the contract: one row per run in `runs`, its ordered
 * trajectory in `events`, the harness identity in `components` (sha256 per
 * component), and per-run metric values in `outcomes` (metric/value pairs, so
 * a new metric needs no migration). `runs` also records where and when it was
 * ingested, which is what makes ingestRoot incremental.
 *
 * Every DDL statement is IF NOT EXISTS, so migrate() is idempotent. The run
 * upsert is INSERT OR REPLACE: children are rewritten separately, so replacing
 * the row wholesale is exactly the idempotent semantics ingestion needs.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  target_class TEXT NOT NULL,
  outcome TEXT NOT NULL,
  vulns_found INTEGER NOT NULL DEFAULT 0,
  false_positives INTEGER NOT NULL DEFAULT 0,
  exploits_succeeded INTEGER NOT NULL DEFAULT 0,
  exploits_attempted INTEGER NOT NULL DEFAULT 0,
  steps INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  runner_version TEXT NOT NULL DEFAULT 'unknown',
  commit_sha TEXT,
  layer_ids TEXT NOT NULL DEFAULT '[]',
  component_hashes TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  ingested_at TEXT NOT NULL,
  source_path TEXT,
  source_mtime_ms INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  phase TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  attack_id TEXT,
  target TEXT,
  result TEXT NOT NULL,
  is_tool_call INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS components (
  run_id TEXT NOT NULL,
  component TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (run_id, component)
);
CREATE TABLE IF NOT EXISTS outcomes (
  run_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (run_id, metric)
);
CREATE INDEX IF NOT EXISTS idx_runs_class_outcome ON runs (target_class, outcome);
CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events (run_id, seq);
`;

export const UPSERT_RUN = `
INSERT OR REPLACE INTO runs (run_id, engagement_id, target_class, outcome, vulns_found,
  false_positives, exploits_succeeded, exploits_attempted, steps, tokens_in, tokens_out,
  duration_ms, runner_version, commit_sha, layer_ids, component_hashes, started_at, finished_at,
  ingested_at, source_path, source_mtime_ms)
VALUES (:run_id, :engagement_id, :target_class, :outcome, :vulns_found, :false_positives,
  :exploits_succeeded, :exploits_attempted, :steps, :tokens_in, :tokens_out, :duration_ms,
  :runner_version, :commit_sha, :layer_ids, :component_hashes, :started_at, :finished_at,
  :ingested_at, :source_path, :source_mtime_ms)`;
