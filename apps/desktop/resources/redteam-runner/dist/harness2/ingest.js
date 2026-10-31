/**
 * Harness2 ingest (H2-P1): one engagement directory -> store.
 *
 * Source precedence: `run.json` (explicit section-5 rows) -> trajectory.json ->
 * metrics.json -> events.jsonl -> engagement.md, with metrics derived from
 * state.json when nothing better parses. Steps come from `steps.jsonl` when the
 * run recorded one; otherwise the recorded events are mapped to steps so legacy
 * runs are not dropped. A directory holding none of those artifacts is not a run
 * and is reported as source "none" rather than creating an empty row.
 *
 * ingestEngagementDir never throws on corrupt content: the problem lands in the
 * returned warnings so one bad run cannot block the rest of a tree walk.
 */
import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { asEvents, asMetrics, deriveMetrics, isObject, readEngagementMd, readEventsJsonl, readJson, readObject, } from "./ingest-parse.js";
import { eventsToSteps } from "./store-rows.js";
import { RUN_ARTIFACT, STEP_ARTIFACT, readRunBundle, readStepsJournal } from "./ingest-rows.js";
/** Files that make a directory a run; also the freshness inputs for sourceMtime. */
export const RUN_FILES = [
    "run.json",
    "steps.jsonl",
    "trajectory.json",
    "metrics.json",
    "events.jsonl",
    "engagement.md",
    "state.json",
];
export function hasAnySource(dir) {
    return RUN_FILES.some((file) => existsSync(join(dir, file)));
}
/** Newest mtime among the files ingestion reads; the freshness key for ingestRoot. */
export function sourceMtime(dir) {
    let newest = 0;
    for (const file of RUN_FILES) {
        try {
            const stat = statSync(join(dir, file));
            if (stat.isFile())
                newest = Math.max(newest, stat.mtimeMs);
        }
        catch {
            // absent file: nothing to compare
        }
    }
    return newest;
}
function engagementIdOf(state) {
    const value = state?.["engagementId"];
    return typeof value === "string" && value !== "" ? value : undefined;
}
/** Ingest one engagement directory. Never throws on corrupt content. */
export function ingestEngagementDir(store, dir) {
    const warnings = [];
    const state = readObject(join(dir, "state.json"), warnings);
    const engagementId = engagementIdOf(state) ?? basename(dir);
    if (!hasAnySource(dir)) {
        return {
            runId: engagementId,
            source: "none",
            ingested: false,
            steps: 0,
            warnings: [...warnings, "no run.json, steps.jsonl, trajectory.json, metrics.json, events.jsonl or state.json"],
        };
    }
    const bundle = readRunBundle(join(dir, RUN_ARTIFACT), warnings);
    const journal = readStepsJournal(join(dir, STEP_ARTIFACT), warnings);
    const trajectoryRaw = readJson(join(dir, "trajectory.json"), warnings);
    const trajectory = isObject(trajectoryRaw) ? trajectoryRaw : undefined;
    const fileMetrics = asMetrics(readJson(join(dir, "metrics.json"), warnings)) ?? asMetrics(trajectoryRaw);
    const hasTrajectory = trajectory !== undefined && (fileMetrics !== null || asEvents(trajectory["events"]).length > 0);
    let events = trajectory === undefined ? [] : asEvents(trajectory["events"]);
    if (events.length === 0)
        events = readEventsJsonl(join(dir, "events.jsonl"), warnings);
    if (events.length === 0)
        events = readEngagementMd(join(dir, "engagement.md"), warnings);
    const steps = journal.length > 0 ? journal : eventsToSteps(events);
    if (bundle !== null) {
        const run = store.upsertRows(bundle, steps);
        return { runId: run.runId, source: "run", ingested: true, steps: steps.length, warnings };
    }
    const metrics = fileMetrics ?? deriveMetrics(engagementId, state, events);
    if (fileMetrics === null)
        warnings.push("metrics derived from state.json (no usable run.json, trajectory.json or metrics.json)");
    const source = fileMetrics !== null ? (hasTrajectory ? "trajectory" : "metrics") : "events";
    const run = store.upsertRun({ metrics, events }, steps);
    return { runId: run.runId, source, ingested: true, steps: steps.length, warnings };
}
//# sourceMappingURL=ingest.js.map