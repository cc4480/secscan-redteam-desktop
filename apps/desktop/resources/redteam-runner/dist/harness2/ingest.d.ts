import type { Harness2Store } from "./store-model.js";
/** Where a run's data came from; `none` means the directory held nothing usable. */
export type IngestSource = "run" | "trajectory" | "metrics" | "events" | "none";
export interface IngestResult {
    readonly runId: string;
    readonly source: IngestSource;
    readonly ingested: boolean;
    readonly steps: number;
    readonly warnings: readonly string[];
}
/** Files that make a directory a run; also the freshness inputs for sourceMtime. */
export declare const RUN_FILES: readonly ["run.json", "steps.jsonl", "trajectory.json", "metrics.json", "events.jsonl", "engagement.md", "state.json"];
export declare function hasAnySource(dir: string): boolean;
/** Newest mtime among the files ingestion reads; the freshness key for ingestRoot. */
export declare function sourceMtime(dir: string): number;
/** Ingest one engagement directory. Never throws on corrupt content. */
export declare function ingestEngagementDir(store: Harness2Store, dir: string): IngestResult;
