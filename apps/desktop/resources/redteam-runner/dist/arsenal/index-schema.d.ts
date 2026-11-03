/**
 * Arsenal index schema — extracted from index-store.ts to keep the store module
 * under the 300-line budget: the schema version, the row/meta shapes, the DDL,
 * and the meta readers. No build/swap or serving logic here.
 */
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
/** Spec §5 schema, verbatim (the WAL pragma is applied on open, per connection). */
export declare const ARSENAL_SCHEMA_DDL = "\nCREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);\n\nCREATE TABLE collections (\n  slug        TEXT PRIMARY KEY,\n  name        TEXT NOT NULL,\n  url         TEXT NOT NULL,\n  description TEXT NOT NULL DEFAULT '',\n  topic       TEXT NOT NULL,\n  fetched_at  TEXT,\n  entry_count INTEGER NOT NULL DEFAULT 0,\n  fetch_error TEXT\n);\n\nCREATE TABLE entries (\n  id              INTEGER PRIMARY KEY,\n  name            TEXT NOT NULL,\n  url             TEXT NOT NULL UNIQUE,\n  description     TEXT NOT NULL DEFAULT '',\n  collection_slug TEXT NOT NULL REFERENCES collections(slug),\n  tags            TEXT NOT NULL DEFAULT '[]',\n  targets         TEXT NOT NULL DEFAULT '[]',\n  battery         TEXT NOT NULL DEFAULT '[]'\n);\n\nCREATE INDEX entries_by_collection ON entries(collection_slug);\nCREATE INDEX entries_by_target     ON entries(json_extract(targets, '$[0]'));\n\nCREATE VIRTUAL TABLE entries_fts USING fts5(\n  name, description, collection_slug, tags,\n  content = 'entries', content_rowid = 'id',\n  tokenize = 'unicode61'\n);\n";
export declare function metaString(meta: ReadonlyMap<string, string>, key: string): string;
export declare function metaInt(meta: ReadonlyMap<string, string>, key: string): number;
