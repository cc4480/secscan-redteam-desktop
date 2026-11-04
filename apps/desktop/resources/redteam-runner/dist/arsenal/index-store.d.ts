import { DatabaseSync } from 'node:sqlite';
import { type ArsenalBuildData, type ArsenalIndexMeta } from './index-schema.js';
export { ARSENAL_SCHEMA_VERSION, ArsenalValidationError } from './index-schema.js';
export type { ArsenalBuildData, ArsenalCollectionRow, ArsenalEntryRow, ArsenalIndexMeta } from './index-schema.js';
/**
 * One-shot read of a database file's meta stamp (readiness, diagnostics).
 * Returns null when no file exists; throws loud on a newer schema version
 * or a file that is not an arsenal index.
 */
export declare function readArsenalIndexMeta(dbPath: string): ArsenalIndexMeta | null;
/**
 * Build the next generation beside the serving database and swap it in
 * atomically (spec §5 build protocol).
 *
 * The serving file is only touched by the final rename: a build error
 * (including a mid-insert constraint failure) or a validation failure
 * deletes the tmp files and leaves the serving database byte-identical.
 * `opts.releaseServing` runs immediately before the rename — on Windows an
 * open serving handle blocks the rename, so the in-process refresh passes
 * the serving store's `close` here; a rename failure is loud, never silent.
 */
export declare function buildAndSwapArsenalIndex(dbPath: string, data: ArsenalBuildData, opts?: {
    releaseServing?: () => void;
}): {
    generation: number;
    entryCount: number;
};
/** The read path's view of the index: one cached handle, generation-aware. */
export interface ArsenalServingStore {
    readonly dbPath: string;
    /**
     * The serving handle and its meta stamp, or null when no index has been
     * built yet. Re-stats the file on every call and reopens read-only when
     * the file changed (a swap), so tools always read the serving generation.
     * Throws loud when the on-disk schema is newer than this code (spec T7).
     */
    current(): {
        db: DatabaseSync;
        meta: ArsenalIndexMeta;
    } | null;
    /** The serving generation's meta stamp, or null when no index exists. */
    meta(): ArsenalIndexMeta | null;
    /** Drop the cached handle; the next `current()` reopens from disk. */
    close(): void;
}
/** Open the serving store over `dbPath`. The file is not created here. */
export declare function openArsenalServingStore(dbPath: string): ArsenalServingStore;
