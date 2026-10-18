import type { Harness2Store } from "./store-model.js";
import type { IngestResult } from "./ingest.js";
export interface IngestOptions {
    /** Re-ingest even when the sidecar says the directory is unchanged. */
    readonly force?: boolean;
}
export interface IngestSummary {
    readonly scanned: number;
    readonly ingested: number;
    readonly skipped: number;
    readonly failed: number;
    readonly results: readonly IngestResult[];
}
/** Walk an engagement tree, ingesting every run that is new or changed since the last walk. */
export declare function ingestRoot(store: Harness2Store, root: string, options?: IngestOptions): IngestSummary;
