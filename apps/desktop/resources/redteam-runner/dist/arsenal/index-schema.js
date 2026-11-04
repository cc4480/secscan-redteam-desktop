/**
 * Arsenal index schema — extracted from index-store.ts to keep the store module
 * under the 300-line budget: the schema version, the row/meta shapes, the DDL,
 * and the meta readers. No build/swap or serving logic here.
 */
export const ARSENAL_SCHEMA_VERSION = 1;
/** A build was produced but failed validation; the serving generation is untouched. */
export class ArsenalValidationError extends Error {
    constructor(message) {
        super(`[arsenal] index validation failed: ${message}`);
        this.name = 'ArsenalValidationError';
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
`;
export function metaString(meta, key) {
    const value = meta.get(key);
    if (value === undefined) {
        throw new Error(`[arsenal] index_meta is missing ${key} — not a complete arsenal index`);
    }
    return value;
}
export function metaInt(meta, key) {
    const raw = metaString(meta, key);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        throw new Error(`[arsenal] index_meta ${key}=${JSON.stringify(raw)} is not a non-negative integer`);
    }
    return n;
}
//# sourceMappingURL=index-schema.js.map