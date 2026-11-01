import { DatabaseSync } from 'node:sqlite';
/** Monotonic schema version of the arsenal index; bump only with a migration step. */
export declare const ARSENAL_SCHEMA_VERSION = 1;
/** The `index_meta` stamp of one serving generation. */
export interface ArsenalIndexMeta {
    schemaVersion: number;
    /** Monotonic build counter; the first successful build is generation 1. */
    generation: number;
    /** ISO timestamp of the build. */
    builtAt: string;
    sourceRepo: string;
    /** Awesome Hacking HEAD commit the Level 1 census was read at ("" until a real refresh records one). */
    sourceCommit: string;
    entryCount: number;
    collectionCount: number;
    unparsedCount: number;
    dupeCount: number;
}
/** One row of the spec §5 `collections` table, as ingest produces it. */
export interface ArsenalCollectionRow {
    slug: string;
    name: string;
    url: string;
    description: string;
    topic: string;
    /** ISO timestamp of the Level 2 fetch; null when Level 2 has not ingested this collection. */
    fetchedAt: string | null;
    entryCount: number;
    /** Last Level 2 failure reason; null on success. */
    fetchError: string | null;
}
/** One row of the spec §5 `entries` table; the array facets are stored as JSON. */
export interface ArsenalEntryRow {
    name: string;
    /** Normalized URL — the within-generation dedupe key (UNIQUE in the schema). */
    url: string;
    description: string;
    collectionSlug: string;
    tags: string[];
    targets: string[];
    battery: string[];
}
/** Everything one generation build needs; produced by ingest, consumed here. */
export interface ArsenalBuildData {
    sourceRepo: string;
    sourceCommit: string;
    /** ISO build timestamp; defaults to now. */
    builtAt?: string;
    collections: ArsenalCollectionRow[];
    entries: ArsenalEntryRow[];
    unparsedCount: number;
    dupeCount: number;
    /**
     * Validation set: every slug must appear in `collections` and carry at
     * least one entry, or the swap is blocked. Refresh passes the canonical
     * priority list from `collections-map.ts`; the store itself holds no
     * curation policy.
     */
    prioritySlugs: readonly string[];
}
/** A build was produced but failed validation; the serving generation is untouched. */
export declare class ArsenalValidationError extends Error {
    constructor(message: string);
}
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
