/**
 * Arsenal index schema — extracted from index-store.ts to keep the store module
 * under the 300-line budget: the schema version, the row/meta shapes, the DDL,
 * and the meta readers. No build/swap or serving logic here.
 */

export const ARSENAL_SCHEMA_VERSION = 1

/** The `index_meta` stamp of one serving generation. */
export interface ArsenalIndexMeta {
  schemaVersion: number
  /** Monotonic build counter; the first successful build is generation 1. */
  generation: number
  /** ISO timestamp of the build. */
  builtAt: string
  sourceRepo: string
  /** Awesome Hacking HEAD commit the Level 1 census was read at ("" until a real refresh records one). */
  sourceCommit: string
  entryCount: number
  collectionCount: number
  unparsedCount: number
  dupeCount: number
}

/** One row of the spec §5 `collections` table, as ingest produces it. */
export interface ArsenalCollectionRow {
  slug: string
  name: string
  url: string
  description: string
  topic: string
  /** ISO timestamp of the Level 2 fetch; null when Level 2 has not ingested this collection. */
  fetchedAt: string | null
  entryCount: number
  /** Last Level 2 failure reason; null on success. */
  fetchError: string | null
}

/** One row of the spec §5 `entries` table; the array facets are stored as JSON. */
export interface ArsenalEntryRow {
  name: string
  /** Normalized URL — the within-generation dedupe key (UNIQUE in the schema). */
  url: string
  description: string
  collectionSlug: string
  tags: string[]
  targets: string[]
  battery: string[]
}

/** Everything one generation build needs; produced by ingest, consumed here. */
export interface ArsenalBuildData {
  sourceRepo: string
  sourceCommit: string
  /** ISO build timestamp; defaults to now. */
  builtAt?: string
  collections: ArsenalCollectionRow[]
  entries: ArsenalEntryRow[]
  unparsedCount: number
  dupeCount: number
  /**
   * Validation set: every slug must appear in `collections` and carry at
   * least one entry, or the swap is blocked. Refresh passes the canonical
   * priority list from `collections-map.ts`; the store itself holds no
   * curation policy.
   */
  prioritySlugs: readonly string[]
}

/** A build was produced but failed validation; the serving generation is untouched. */
export class ArsenalValidationError extends Error {
  constructor(message: string) {
    super(`[arsenal] index validation failed: ${message}`)
    this.name = 'ArsenalValidationError'
  }
}

/** Spec §5 schema, verbatim (the WAL pragma is applied on open, per connection). */
export const ARSENAL_SCHEMA_DDL = `
CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE collections (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  topic       TEXT NOT NULL,
  fetched_at  TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0,
  fetch_error TEXT
);

CREATE TABLE entries (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL DEFAULT '',
  collection_slug TEXT NOT NULL REFERENCES collections(slug),
  tags            TEXT NOT NULL DEFAULT '[]',
  targets         TEXT NOT NULL DEFAULT '[]',
  battery         TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX entries_by_collection ON entries(collection_slug);
CREATE INDEX entries_by_target     ON entries(json_extract(targets, '$[0]'));

CREATE VIRTUAL TABLE entries_fts USING fts5(
  name, description, collection_slug, tags,
  content = 'entries', content_rowid = 'id',
  tokenize = 'unicode61'
);
`

export function metaString(meta: ReadonlyMap<string, string>, key: string): string {
  const value = meta.get(key)
  if (value === undefined) {
    throw new Error(`[arsenal] index_meta is missing ${key} — not a complete arsenal index`)
  }
  return value
}

export function metaInt(meta: ReadonlyMap<string, string>, key: string): number {
  const raw = metaString(meta, key)
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`[arsenal] index_meta ${key}=${JSON.stringify(raw)} is not a non-negative integer`)
  }
  return n
}
