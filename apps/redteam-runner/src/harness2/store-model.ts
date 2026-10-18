/**
 * Harness2 store model (H2-P1b): public row shapes plus SQL-row mapping.
 *
 * Kept apart from store.ts only to stay inside the runner's 300-line file
 * budget; everything here is part of the store's surface and is re-exported
 * from ./store.ts. Ingestion lives in ./ingest.ts and ./walk.ts.
 */
import type { SQLOutputValue } from "node:sqlite";
import type { Harness2Paths, RunOutcome, TrajectoryEvent, TrajectoryRecord } from "./contract.js";

/** A row as node:sqlite returns it. */
export type SqlRow = Record<string, SQLOutputValue>;

/** The outcome values the schema accepts; anything else degrades to "partial". */
export const RUN_OUTCOMES: readonly RunOutcome[] = ["success", "partial", "failure", "aborted"];

export interface RunFilter {
  readonly targetClass?: string;
  readonly outcome?: RunOutcome;
  readonly limit?: number;
}

/** Stored provenance for one ingest: where it came from and the source mtime. */
export interface IngestSourceStamp {
  readonly path: string;
  readonly mtimeMs: number;
}

export interface RunRow {
  readonly runId: string;
  readonly engagementId: string;
  readonly targetClass: string;
  readonly outcome: RunOutcome;
  readonly vulnsFound: number;
  readonly falsePositives: number;
  readonly exploitsSucceeded: number;
  readonly exploitsAttempted: number;
  readonly steps: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly durationMs: number;
  readonly runnerVersion: string;
  readonly commit?: string;
  readonly layerIds: readonly string[];
  readonly componentHashes: Readonly<Record<string, string>>;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly ingestedAt: string;
  readonly sourcePath?: string;
  readonly sourceMtimeMs?: number;
}

export interface EventRow {
  readonly runId: string;
  readonly seq: number;
  readonly ts: string;
  readonly phase: string;
  readonly actor: string;
  readonly action: string;
  readonly attackId?: string;
  readonly target?: string;
  readonly result: string;
  readonly isToolCall: boolean;
}

export interface ComponentRow {
  readonly runId: string;
  readonly component: string;
  readonly sha256: string;
}

export interface RunDetail {
  readonly run: RunRow;
  readonly events: readonly EventRow[];
  readonly components: readonly ComponentRow[];
  readonly outcomes: Readonly<Record<string, number>>;
}

export interface ClassStat {
  readonly targetClass: string;
  readonly runs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly steps: number;
  readonly vulnsFound: number;
  readonly falsePositives: number;
  readonly exploitsSucceeded: number;
  readonly exploitsAttempted: number;
  /** Share of runs in this class whose outcome is success, 0..1. */
  readonly successRate: number;
}

export interface OutcomeStat {
  readonly outcome: RunOutcome;
  readonly runs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly vulnsFound: number;
  readonly exploitsSucceeded: number;
}

export interface RunStats {
  readonly total: number;
  readonly totalTokensIn: number;
  readonly totalTokensOut: number;
  readonly totalSteps: number;
  readonly totalDurationMs: number;
  readonly byTargetClass: readonly ClassStat[];
  readonly byOutcome: readonly OutcomeStat[];
}

export interface Harness2Store {
  readonly paths: Harness2Paths;
  /** Create or upgrade the schema. Idempotent; safe to call on every open. */
  migrate(): void;
  /** Insert or replace one run and all of its children; re-ingesting never duplicates. */
  upsertRun(record: TrajectoryRecord, source?: IngestSourceStamp): RunRow;
  listRuns(filter?: RunFilter): RunRow[];
  getRun(runId: string): RunDetail | null;
  /** The run last ingested from a directory, for incremental tree walks. */
  getRunBySourcePath(sourcePath: string): RunRow | null;
  /** Append events after the run's last seq (same-seq rows are replaced). Returns the count. */
  insertEvents(runId: string, events: readonly TrajectoryEvent[]): number;
  runStats(): RunStats;
  close(): void;
}

export function text(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

export function optionalText(row: SqlRow, key: string): string | undefined {
  const value = text(row, key);
  return value === "" ? undefined : value;
}

export function integer(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function jsonStrings(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function jsonRecord(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") out[key] = value;
    return out;
  } catch {
    return {};
  }
}

export function rowToRun(row: SqlRow): RunRow {
  const outcome = text(row, "outcome");
  const mtime = row["source_mtime_ms"];
  return {
    runId: text(row, "run_id"),
    engagementId: text(row, "engagement_id"),
    targetClass: text(row, "target_class"),
    outcome: RUN_OUTCOMES.includes(outcome as RunOutcome) ? (outcome as RunOutcome) : "partial",
    vulnsFound: integer(row, "vulns_found"),
    falsePositives: integer(row, "false_positives"),
    exploitsSucceeded: integer(row, "exploits_succeeded"),
    exploitsAttempted: integer(row, "exploits_attempted"),
    steps: integer(row, "steps"),
    tokensIn: integer(row, "tokens_in"),
    tokensOut: integer(row, "tokens_out"),
    durationMs: integer(row, "duration_ms"),
    runnerVersion: text(row, "runner_version"),
    commit: optionalText(row, "commit_sha"),
    layerIds: jsonStrings(text(row, "layer_ids")),
    componentHashes: jsonRecord(text(row, "component_hashes")),
    startedAt: text(row, "started_at"),
    finishedAt: text(row, "finished_at"),
    ingestedAt: text(row, "ingested_at"),
    sourcePath: optionalText(row, "source_path"),
    sourceMtimeMs: mtime === null || mtime === undefined ? undefined : integer(row, "source_mtime_ms"),
  };
}

export function rowToEvent(row: SqlRow): EventRow {
  return {
    runId: text(row, "run_id"),
    seq: integer(row, "seq"),
    ts: text(row, "ts"),
    phase: text(row, "phase"),
    actor: text(row, "actor"),
    action: text(row, "action"),
    attackId: optionalText(row, "attack_id"),
    target: optionalText(row, "target"),
    result: text(row, "result"),
    isToolCall: integer(row, "is_tool_call") === 1,
  };
}

export function rowToClassStat(row: SqlRow): ClassStat {
  return {
    targetClass: text(row, "target_class"),
    runs: integer(row, "runs"),
    tokensIn: integer(row, "tokens_in"),
    tokensOut: integer(row, "tokens_out"),
    steps: integer(row, "steps"),
    vulnsFound: integer(row, "vulns_found"),
    falsePositives: integer(row, "false_positives"),
    exploitsSucceeded: integer(row, "exploits_succeeded"),
    exploitsAttempted: integer(row, "exploits_attempted"),
    successRate: typeof row["success_rate"] === "number" ? row["success_rate"] : 0,
  };
}

export function rowToOutcomeStat(row: SqlRow): OutcomeStat {
  return {
    outcome: text(row, "outcome") as RunOutcome,
    runs: integer(row, "runs"),
    tokensIn: integer(row, "tokens_in"),
    tokensOut: integer(row, "tokens_out"),
    vulnsFound: integer(row, "vulns_found"),
    exploitsSucceeded: integer(row, "exploits_succeeded"),
  };
}
