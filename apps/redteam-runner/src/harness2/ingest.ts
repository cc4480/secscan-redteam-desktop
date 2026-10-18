/**
 * Harness2 ingest (H2-P1b): one engagement directory -> store.
 *
 * Source precedence: trajectory.json -> metrics.json -> events.jsonl ->
 * engagement.md, with metrics derived from state.json when neither metrics file
 * parses. A directory holding none of those is not a run and is reported as
 * source "none" rather than creating an empty row.
 *
 * ingestEngagementDir never throws on corrupt content: the problem lands in the
 * returned warnings so one bad run cannot block the rest of a tree walk.
 */
import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Harness2Store, IngestSourceStamp } from "./store-model.js";
import {
  asEvents,
  asMetrics,
  deriveMetrics,
  isObject,
  readEngagementMd,
  readEventsJsonl,
  readJson,
  readObject,
} from "./ingest-parse.js";

/** Where a run's data came from; `none` means the directory held nothing usable. */
export type IngestSource = "trajectory" | "metrics" | "events" | "none";

export interface IngestResult {
  readonly runId: string;
  readonly source: IngestSource;
  readonly ingested: boolean;
  readonly events: number;
  readonly warnings: readonly string[];
}

/** Files that make a directory a run; also the freshness inputs for sourceMtime. */
export const RUN_FILES = ["trajectory.json", "metrics.json", "events.jsonl", "engagement.md", "state.json"] as const;

export function hasAnySource(dir: string): boolean {
  return RUN_FILES.some((file) => existsSync(join(dir, file)));
}

/** Newest mtime among the files ingestion reads; the freshness key for ingestRoot. */
export function sourceMtime(dir: string): number {
  let newest = 0;
  for (const file of RUN_FILES) {
    try {
      const stat = statSync(join(dir, file));
      if (stat.isFile()) newest = Math.max(newest, stat.mtimeMs);
    } catch {
      // absent file: nothing to compare
    }
  }
  return newest;
}

function engagementIdOf(state: Record<string, unknown> | undefined): string | undefined {
  const value = state?.["engagementId"];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Ingest one engagement directory. Never throws on corrupt content. */
export function ingestEngagementDir(store: Harness2Store, dir: string): IngestResult {
  const warnings: string[] = [];
  const state = readObject(join(dir, "state.json"), warnings);
  const engagementId = engagementIdOf(state) ?? basename(dir);

  if (!hasAnySource(dir)) {
    return {
      runId: engagementId,
      source: "none",
      ingested: false,
      events: 0,
      warnings: [...warnings, "no trajectory.json, metrics.json, events.jsonl or state.json"],
    };
  }

  const trajectoryRaw = readJson(join(dir, "trajectory.json"), warnings);
  const trajectory = isObject(trajectoryRaw) ? trajectoryRaw : undefined;
  const fileMetrics = asMetrics(readJson(join(dir, "metrics.json"), warnings)) ?? asMetrics(trajectoryRaw);
  const hasTrajectory = trajectory !== undefined && (fileMetrics !== null || asEvents(trajectory["events"]).length > 0);

  let events = trajectory === undefined ? [] : asEvents(trajectory["events"]);
  if (events.length === 0) events = readEventsJsonl(join(dir, "events.jsonl"), warnings);
  if (events.length === 0) events = readEngagementMd(join(dir, "engagement.md"), warnings);

  const metrics = fileMetrics ?? deriveMetrics(engagementId, state, events);
  if (fileMetrics === null) warnings.push("metrics derived from state.json (no usable trajectory.json or metrics.json)");
  const source: IngestSource = fileMetrics !== null ? (hasTrajectory ? "trajectory" : "metrics") : "events";
  const stamp: IngestSourceStamp = { path: dir, mtimeMs: sourceMtime(dir) };
  const run = store.upsertRun({ metrics, events }, stamp);
  return { runId: run.runId, source, ingested: true, events: events.length, warnings };
}
