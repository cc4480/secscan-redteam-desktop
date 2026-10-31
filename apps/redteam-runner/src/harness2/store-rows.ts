/**
 * Harness2 store rows (H2-P1, spec section 5): SQL-row mapping + derivations.
 *
 * Two derivation rules are documented here because they are the only place the
 * store has to translate between the H2-P1a contract and the section-5
 * columns:
 *
 *  - RUNMETRICS -> runs/metrics. The contract has no section-5 fields, so the
 *    store derives them mechanically: ts = finishedAt epoch ms; target_id =
 *    engagementId (the run's target instance); harness_version = runnerVersion;
 *    layer_set = layerIds; success = outcome === "success"; crashed =
 *    outcome === "aborted"; claims_total = vulnsFound + falsePositives (every
 *    finding is a claim, and the killed ones are the false claims);
 *    tokens_total = tokensIn + tokensOut; steps_count = steps. failure_mode is
 *    "missed-vuln" only when the run failed AND found nothing, "none" otherwise
 *    (the richer modes arrive with an explicit run.json from H2-P1a capture).
 *  - events -> steps. Legacy runs have no steps journal; their recorded events
 *    become steps so the trajectory is not silently dropped: a tool-call event
 *    is role "tool" with tool_name = action and content = result; any other
 *    event is role "observation" with content "<action>: <result>".
 *
 * Everything here is pure mapping (no SQL), which is what keeps store.ts inside
 * the runner's 300-line file budget.
 */
import type { RunMetrics, RunOutcome, TrajectoryEvent, TrajectoryRecord } from "./contract.js";
import {
  FAILURE_MODES,
  RUN_OUTCOMES,
  STEP_ROLES,
  type FailureMode,
  type RunBundle,
  type RunRow,
  type RunStats,
  type SqlRow,
  type StepInput,
  type StepRow,
  type StepRole,
} from "./store-model.js";

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
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "bigint") return Number(value);
  return 0;
}

export function optionalInteger(row: SqlRow, key: string): number | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  return integer(row, key);
}

export function boolean(row: SqlRow, key: string): boolean {
  return integer(row, key) === 1;
}

function jsonStrings(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Derive the presentation outcome from the section-5 columns. */
export function outcomeOf(run: {
  readonly success: boolean;
  readonly crashed: boolean;
  readonly failureMode: FailureMode;
}): RunOutcome {
  if (run.crashed) return "aborted";
  if (run.success) return "success";
  return run.failureMode === "none" ? "partial" : "failure";
}

export function asOutcome(value: string): RunOutcome {
  return RUN_OUTCOMES.includes(value as RunOutcome) ? (value as RunOutcome) : "partial";
}

export function asFailureMode(value: unknown): FailureMode {
  return typeof value === "string" && FAILURE_MODES.includes(value as FailureMode) ? (value as FailureMode) : "none";
}

export function asStepRole(value: unknown): StepRole | undefined {
  return typeof value === "string" && STEP_ROLES.includes(value as StepRole) ? (value as StepRole) : undefined;
}

export function rowToRun(row: SqlRow): RunRow {
  const failureMode = asFailureMode(text(row, "failure_mode"));
  const base = {
    runId: text(row, "run_id"),
    ts: integer(row, "ts"),
    targetClass: text(row, "target_class"),
    targetSubclass: optionalText(row, "target_subclass"),
    targetId: optionalText(row, "target_id"),
    harnessVersion: text(row, "harness_version"),
    layerSet: jsonStrings(text(row, "layer_set")),
    cycleRef: optionalText(row, "cycle_ref"),
    success: boolean(row, "success"),
    vulnsFound: integer(row, "vulns_found"),
    claimsTotal: integer(row, "claims_total"),
    falsePositives: integer(row, "false_positives"),
    stepsCount: integer(row, "steps_count"),
    tokensTotal: integer(row, "tokens_total"),
    crashed: boolean(row, "crashed"),
    failureMode,
  };
  return { ...base, outcome: outcomeOf(base) };
}

export function rowToStep(row: SqlRow): StepRow {
  const role = asStepRole(text(row, "role")) ?? "observation";
  return {
    runId: text(row, "run_id"),
    seq: integer(row, "seq"),
    role,
    toolName: optionalText(row, "tool_name"),
    content: text(row, "content"),
    tokens: optionalInteger(row, "tokens"),
  };
}

export function rowToBundle(row: SqlRow): RunBundle {
  return {
    runId: text(row, "run_id"),
    ts: integer(row, "ts"),
    targetClass: text(row, "target_class"),
    targetSubclass: optionalText(row, "target_subclass"),
    targetId: optionalText(row, "target_id"),
    harnessVersion: text(row, "harness_version"),
    layerSet: jsonStrings(text(row, "layer_set")),
    cycleRef: optionalText(row, "cycle_ref"),
    success: boolean(row, "success"),
    vulnsFound: integer(row, "vulns_found"),
    claimsTotal: integer(row, "claims_total"),
    falsePositives: integer(row, "false_positives"),
    stepsCount: integer(row, "steps_count"),
    tokensTotal: integer(row, "tokens_total"),
    crashed: boolean(row, "crashed"),
    failureMode: asFailureMode(text(row, "failure_mode")),
  };
}

/** failure_mode for a contract record: only "missed-vuln" is provable today. */
export function deriveFailureMode(metrics: RunMetrics): FailureMode {
  if (metrics.outcome === "failure" && metrics.vulnsFound === 0) return "missed-vuln";
  return "none";
}

export function bundleFromRecord(record: TrajectoryRecord): RunBundle {
  const metrics = record.metrics;
  const finished = Date.parse(metrics.finishedAt);
  const started = Date.parse(metrics.startedAt);
  const ts = Number.isFinite(finished) ? finished : Number.isFinite(started) ? started : 0;
  return {
    runId: metrics.runId,
    ts,
    targetClass: metrics.targetClass === "" ? "unknown" : metrics.targetClass,
    targetId: metrics.engagementId === "" ? undefined : metrics.engagementId,
    harnessVersion: metrics.harness.runnerVersion === "" ? "unknown" : metrics.harness.runnerVersion,
    layerSet: metrics.harness.layerIds,
    success: metrics.outcome === "success",
    vulnsFound: metrics.vulnsFound,
    claimsTotal: metrics.vulnsFound + metrics.falsePositives,
    falsePositives: metrics.falsePositives,
    stepsCount: metrics.steps,
    tokensTotal: metrics.tokensIn + metrics.tokensOut,
    crashed: metrics.outcome === "aborted",
    failureMode: deriveFailureMode(metrics),
  };
}

/** Legacy trajectories: recorded events become full-text steps (see file comment). */
export function eventsToSteps(events: readonly TrajectoryEvent[]): StepInput[] {
  return events.map((event) => {
    if (event.isToolCall) {
      return { role: "tool", toolName: event.action, content: event.result };
    }
    const content = event.action === event.result || event.result === "" ? event.action : `${event.action}: ${event.result}`;
    return { role: "observation", content };
  });
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function flag(value: unknown): boolean {
  return value === 1 || value === true;
}

/**
 * Tolerant parse of an explicit section-5 `run.json` written by the H2-P1a
 * capture (`{ run: {...}, metrics: {...} }`). Returns null when the payload
 * cannot describe a run, so ingest falls back to the contract metrics.
 */
export function runBundleFromJson(raw: unknown): RunBundle | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const run = typeof record["run"] === "object" && record["run"] !== null ? (record["run"] as Record<string, unknown>) : undefined;
  const metrics =
    typeof record["metrics"] === "object" && record["metrics"] !== null
      ? (record["metrics"] as Record<string, unknown>)
      : undefined;
  const runId = stringOr(run?.["run_id"]) ?? stringOr(metrics?.["run_id"]);
  if (runId === undefined) return null;
  const layerSet = Array.isArray(run?.["layer_set"])
    ? (run["layer_set"] as unknown[]).filter((entry): entry is string => typeof entry === "string")
    : jsonStrings(stringOr(run?.["layer_set"]) ?? "[]");
  const bundle: RunBundle = {
    runId,
    ts: numberOr(run?.["ts"], 0),
    targetClass: stringOr(run?.["target_class"]) ?? "unknown",
    targetSubclass: stringOr(run?.["target_subclass"]),
    targetId: stringOr(run?.["target_id"]),
    harnessVersion: stringOr(run?.["harness_version"]) ?? "unknown",
    layerSet,
    cycleRef: stringOr(run?.["cycle_ref"]),
    success: flag(metrics?.["success"]),
    vulnsFound: numberOr(metrics?.["vulns_found"], 0),
    claimsTotal: numberOr(metrics?.["claims_total"], 0),
    falsePositives: numberOr(metrics?.["false_positives"], 0),
    stepsCount: numberOr(metrics?.["steps_count"], 0),
    tokensTotal: numberOr(metrics?.["tokens_total"], 0),
    crashed: flag(metrics?.["crashed"]),
    failureMode: asFailureMode(metrics?.["failure_mode"]),
  };
  return bundle;
}

function numberColumn(row: SqlRow, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function rowToClassStat(row: SqlRow): RunStats["byTargetClass"][number] {
  return {
    targetClass: text(row, "target_class"),
    runs: integer(row, "runs"),
    successes: integer(row, "successes"),
    crashed: integer(row, "crashed"),
    vulnsFound: integer(row, "vulns_found"),
    claimsTotal: integer(row, "claims_total"),
    falsePositives: integer(row, "false_positives"),
    stepsCount: integer(row, "steps_count"),
    tokensTotal: integer(row, "tokens_total"),
    successRate: numberColumn(row, "success_rate"),
  };
}

export function rowToFailureModeStat(row: SqlRow): RunStats["byFailureMode"][number] {
  return {
    failureMode: asFailureMode(text(row, "failure_mode")),
    runs: integer(row, "runs"),
    vulnsFound: integer(row, "vulns_found"),
    falsePositives: integer(row, "false_positives"),
  };
}
