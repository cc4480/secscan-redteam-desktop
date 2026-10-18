import { type Harness2Paths } from "./contract.js";
import type { Harness2Store } from "./store-model.js";
/**
 * Open (and lazily create) the store. The database must live inside
 * `paths.root`, so a malformed DSH_HARNESS2_ROOT cannot scatter files elsewhere
 * on the box. WAL is enabled before anything is written; migrate() runs on open
 * and is idempotent.
 */
export declare function openHarness2Store(paths?: Harness2Paths): Harness2Store;
export { ingestEngagementDir } from "./ingest.js";
export { ingestRoot } from "./walk.js";
export type { IngestOptions, IngestSummary } from "./walk.js";
export type { IngestResult, IngestSource } from "./ingest.js";
export type { ClassStat, FailureMode, FailureModeStat, Harness2Store, RunBundle, RunDetail, RunFilter, RunRow, RunStats, StepInput, StepRole, StepRow, } from "./store-model.js";
export { rowToRun, rowToStep, eventsToSteps, bundleFromRecord, runBundleFromJson } from "./store-rows.js";
export { SCHEMA, SCHEMA_VERSION } from "./store-schema.js";
