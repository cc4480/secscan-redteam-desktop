import { FAILURE_MODES, RUN_OUTCOMES, STEP_ROLES, } from "./store-model.js";
export function text(row, key) {
    const value = row[key];
    return typeof value === "string" ? value : "";
}
export function optionalText(row, key) {
    const value = text(row, key);
    return value === "" ? undefined : value;
}
export function integer(row, key) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === "bigint")
        return Number(value);
    return 0;
}
export function optionalInteger(row, key) {
    const value = row[key];
    if (value === null || value === undefined)
        return undefined;
    return integer(row, key);
}
export function boolean(row, key) {
    return integer(row, key) === 1;
}
function jsonStrings(raw) {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
    }
    catch {
        return [];
    }
}
/** Derive the presentation outcome from the section-5 columns. */
export function outcomeOf(run) {
    if (run.crashed)
        return "aborted";
    if (run.success)
        return "success";
    return run.failureMode === "none" ? "partial" : "failure";
}
export function asOutcome(value) {
    return RUN_OUTCOMES.includes(value) ? value : "partial";
}
export function asFailureMode(value) {
    return typeof value === "string" && FAILURE_MODES.includes(value) ? value : "none";
}
export function asStepRole(value) {
    return typeof value === "string" && STEP_ROLES.includes(value) ? value : undefined;
}
export function rowToRun(row) {
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
export function rowToStep(row) {
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
export function rowToBundle(row) {
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
export function deriveFailureMode(metrics) {
    if (metrics.outcome === "failure" && metrics.vulnsFound === 0)
        return "missed-vuln";
    return "none";
}
export function bundleFromRecord(record) {
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
export function eventsToSteps(events) {
    return events.map((event) => {
        if (event.isToolCall) {
            return { role: "tool", toolName: event.action, content: event.result };
        }
        const content = event.action === event.result || event.result === "" ? event.action : `${event.action}: ${event.result}`;
        return { role: "observation", content };
    });
}
function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}
function stringOr(value) {
    return typeof value === "string" && value !== "" ? value : undefined;
}
function flag(value) {
    return value === 1 || value === true;
}
/**
 * Tolerant parse of an explicit section-5 `run.json` written by the H2-P1a
 * capture (`{ run: {...}, metrics: {...} }`). Returns null when the payload
 * cannot describe a run, so ingest falls back to the contract metrics.
 */
export function runBundleFromJson(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return null;
    const record = raw;
    const run = typeof record["run"] === "object" && record["run"] !== null ? record["run"] : undefined;
    const metrics = typeof record["metrics"] === "object" && record["metrics"] !== null
        ? record["metrics"]
        : undefined;
    const runId = stringOr(run?.["run_id"]) ?? stringOr(metrics?.["run_id"]);
    if (runId === undefined)
        return null;
    const layerSet = Array.isArray(run?.["layer_set"])
        ? run["layer_set"].filter((entry) => typeof entry === "string")
        : jsonStrings(stringOr(run?.["layer_set"]) ?? "[]");
    const bundle = {
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
function numberColumn(row, key) {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
export function rowToClassStat(row) {
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
export function rowToFailureModeStat(row) {
    return {
        failureMode: asFailureMode(text(row, "failure_mode")),
        runs: integer(row, "runs"),
        vulnsFound: integer(row, "vulns_found"),
        falsePositives: integer(row, "false_positives"),
    };
}
//# sourceMappingURL=store-rows.js.map