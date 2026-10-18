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
import { type FailureMode, type RunBundle, type RunRow, type RunStats, type SqlRow, type StepInput, type StepRow, type StepRole } from "./store-model.js";
export declare function text(row: SqlRow, key: string): string;
export declare function optionalText(row: SqlRow, key: string): string | undefined;
export declare function integer(row: SqlRow, key: string): number;
export declare function optionalInteger(row: SqlRow, key: string): number | undefined;
export declare function boolean(row: SqlRow, key: string): boolean;
/** Derive the presentation outcome from the section-5 columns. */
export declare function outcomeOf(run: {
    readonly success: boolean;
    readonly crashed: boolean;
    readonly failureMode: FailureMode;
}): RunOutcome;
export declare function asOutcome(value: string): RunOutcome;
export declare function asFailureMode(value: unknown): FailureMode;
export declare function asStepRole(value: unknown): StepRole | undefined;
export declare function rowToRun(row: SqlRow): RunRow;
export declare function rowToStep(row: SqlRow): StepRow;
export declare function rowToBundle(row: SqlRow): RunBundle;
/** failure_mode for a contract record: only "missed-vuln" is provable today. */
export declare function deriveFailureMode(metrics: RunMetrics): FailureMode;
export declare function bundleFromRecord(record: TrajectoryRecord): RunBundle;
/** Legacy trajectories: recorded events become full-text steps (see file comment). */
export declare function eventsToSteps(events: readonly TrajectoryEvent[]): StepInput[];
/**
 * Tolerant parse of an explicit section-5 `run.json` written by the H2-P1a
 * capture (`{ run: {...}, metrics: {...} }`). Returns null when the payload
 * cannot describe a run, so ingest falls back to the contract metrics.
 */
export declare function runBundleFromJson(raw: unknown): RunBundle | null;
export declare function rowToClassStat(row: SqlRow): RunStats["byTargetClass"][number];
export declare function rowToFailureModeStat(row: SqlRow): RunStats["byFailureMode"][number];
