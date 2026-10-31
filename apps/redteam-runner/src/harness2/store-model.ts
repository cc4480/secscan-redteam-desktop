/**
 * Harness2 store model (H2-P1, spec section 5): public row shapes.
 *
 * The store keeps exactly the three section-5 tables:
 *
 *   runs     one row per run (target metadata + composed harness identity)
 *   steps    the full trajectory: prompt | tool | observation, full text
 *   metrics  the ground truth: success, findings, claims, cost, failure mode
 *
 * Row mapping, aggregations and the derivation rules that turn the H2-P1a
 * RunMetrics contract (or an explicit run.json) into those columns live in
 * ./store-rows.ts; DDL and the v1 -> v2 migration live in ./store-schema.ts.
 * This module is the type surface every other harness2 module codes against,
 * re-exported from ./store.ts.
 */
import type { SQLOutputValue } from "node:sqlite";
import type { Harness2Paths, RunOutcome, TrajectoryRecord } from "./contract.js";

/** A row as node:sqlite returns it. */
export type SqlRow = Record<string, SQLOutputValue>;

/** `steps.role` union. */
export const STEP_ROLES = ["prompt", "tool", "observation"] as const;
export type StepRole = (typeof STEP_ROLES)[number];

/** `metrics.failure_mode` union. */
export const FAILURE_MODES = ["missed-vuln", "fp-blowup", "tool-error", "step-exhaustion", "timeout", "none"] as const;
export type FailureMode = (typeof FAILURE_MODES)[number];

/** Run outcomes kept for the CLI/list filter; derived from success+crashed+failure_mode. */
export const RUN_OUTCOMES: readonly RunOutcome[] = ["success", "partial", "failure", "aborted"];

/** One trajectory step as written to the journal (and the steps table). */
export interface StepInput {
  readonly role: StepRole;
  readonly toolName?: string;
  readonly content: string;
  readonly tokens?: number;
}

export interface StepRow {
  readonly runId: string;
  readonly seq: number;
  readonly role: StepRole;
  readonly toolName?: string;
  /** Full text, never truncated by the store. */
  readonly content: string;
  readonly tokens?: number;
}

/** The runs + metrics columns of one run, before they are written. */
export interface RunBundle {
  readonly runId: string;
  /** Epoch milliseconds of the run (finishedAt when the artifact has it). */
  readonly ts: number;
  readonly targetClass: string;
  readonly targetSubclass?: string;
  readonly targetId?: string;
  readonly harnessVersion: string;
  /** Ordered layer ids; stored as a JSON array in runs.layer_set. */
  readonly layerSet: readonly string[];
  readonly cycleRef?: string;
  readonly success: boolean;
  readonly vulnsFound: number;
  readonly claimsTotal: number;
  readonly falsePositives: number;
  readonly stepsCount: number;
  readonly tokensTotal: number;
  readonly crashed: boolean;
  readonly failureMode: FailureMode;
}

/** One stored run: the runs row joined with its metrics row. */
export interface RunBundleRow {
  readonly runId: string;
  readonly ts: number;
  readonly targetClass: string;
  readonly targetSubclass?: string;
  readonly targetId?: string;
  readonly harnessVersion: string;
  readonly layerSet: readonly string[];
  readonly cycleRef?: string;
  readonly success: boolean;
  readonly vulnsFound: number;
  readonly claimsTotal: number;
  readonly falsePositives: number;
  readonly stepsCount: number;
  readonly tokensTotal: number;
  readonly crashed: boolean;
  readonly failureMode: FailureMode;
}

export interface RunRow extends RunBundleRow {
  /** Derived presentation value (success / crashed / failure_mode); not a column. */
  readonly outcome: RunOutcome;
}

export interface RunFilter {
  readonly targetClass?: string;
  /** Filter on the derived outcome (success, partial, failure, aborted). */
  readonly outcome?: RunOutcome;
  readonly limit?: number;
}

export interface RunDetail {
  readonly run: RunRow;
  readonly steps: readonly StepRow[];
}

export interface ClassStat {
  readonly targetClass: string;
  readonly runs: number;
  readonly successes: number;
  readonly crashed: number;
  readonly vulnsFound: number;
  readonly claimsTotal: number;
  readonly falsePositives: number;
  readonly stepsCount: number;
  readonly tokensTotal: number;
  /** Share of runs in this class with success = 1, 0..1. */
  readonly successRate: number;
}

export interface FailureModeStat {
  readonly failureMode: FailureMode;
  readonly runs: number;
  readonly vulnsFound: number;
  readonly falsePositives: number;
}

export interface RunStats {
  readonly total: number;
  readonly successes: number;
  readonly crashed: number;
  readonly totalVulns: number;
  readonly totalClaims: number;
  readonly totalFalsePositives: number;
  readonly totalSteps: number;
  readonly totalTokens: number;
  readonly byTargetClass: readonly ClassStat[];
  readonly byFailureMode: readonly FailureModeStat[];
}

export interface Harness2Store {
  readonly paths: Harness2Paths;
  /** Create or upgrade the schema. Idempotent; safe to call on every open. */
  migrate(): void;
  /** Write one contract record (metrics/events) as a runs+metrics+steps set. */
  upsertRun(record: TrajectoryRecord, steps?: readonly StepInput[]): RunRow;
  /** Write explicit section-5 rows; re-writing a run replaces its children. */
  upsertRows(bundle: RunBundle, steps: readonly StepInput[]): RunRow;
  listRuns(filter?: RunFilter): RunRow[];
  getRun(runId: string): RunDetail | null;
  /** Append steps after the run's last seq (same-seq rows are replaced). Returns the count. */
  appendSteps(runId: string, steps: readonly StepInput[]): number;
  runStats(): RunStats;
  close(): void;
}
