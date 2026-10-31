/**
 * Arsenal index store (spec §5): the generation-stamped SQLite + FTS5 index
 * the three `arsenal_*` tools serve from.
 *
 * Two halves, kept apart like the spec's two paths:
 *
 * - Build/swap (`buildAndSwapArsenalIndex`): a refresh builds the whole next
 *   generation into `arsenal.db.tmp` beside the serving file, validates it,
 *   then atomically renames it over `arsenal.db`. Any failure before the
 *   rename deletes the tmp files and leaves the serving database
 *   byte-identical — a failed refresh changes nothing the fleet can see.
 * - Serving (`openArsenalServingStore`): a read-only handle that re-stats
 *   the file on every `current()` call and reopens when the file changed,
 *   so a swap is picked up without a console restart.
 *
 * `node:sqlite` is built into the bundled Node 24, so this adds no
 * dependency. Open discipline mirrors `harness2/store.ts` (WAL, foreign
 * keys, busy timeout). Schema discipline is the repo rule: a monotonic
 * `SCHEMA_VERSION` (kept in `index_meta.schema_version`); a database newer
 * than this code fails loud rather than silently downgrading.
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Monotonic schema version of the arsenal index; bump only with a migration step. */
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
const ARSENAL_SCHEMA_DDL = `
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

function metaString(meta: ReadonlyMap<string, string>, key: string): string {
  const value = meta.get(key)
  if (value === undefined) {
    throw new Error(`[arsenal] index_meta is missing ${key} — not a complete arsenal index`)
  }
  return value
}

function metaInt(meta: ReadonlyMap<string, string>, key: string): number {
  const raw = metaString(meta, key)
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`[arsenal] index_meta ${key}=${JSON.stringify(raw)} is not a non-negative integer`)
  }
  return n
}

/** Read and validate the `index_meta` stamp of an open database. */
function readMeta(db: DatabaseSync): ArsenalIndexMeta {
  let rows: Array<Record<string, unknown>>
  try {
    rows = db.prepare('SELECT key, value FROM index_meta').all() as Array<Record<string, unknown>>
  } catch {
    throw new Error('[arsenal] database has no index_meta table — not an arsenal index')
  }
  const meta = new Map<string, string>()
  for (const row of rows) meta.set(String(row['key']), String(row['value']))
  const schemaVersion = metaInt(meta, 'schema_version')
  if (schemaVersion > ARSENAL_SCHEMA_VERSION) {
    throw new Error(
      `[arsenal] index schema v${schemaVersion} is newer than this code (v${ARSENAL_SCHEMA_VERSION}); refusing to serve it`,
    )
  }
  if (schemaVersion < ARSENAL_SCHEMA_VERSION) {
    throw new Error(
      `[arsenal] index schema v${schemaVersion} predates this code (v${ARSENAL_SCHEMA_VERSION}) and no migration exists; rebuild the index`,
    )
  }
  return {
    schemaVersion,
    generation: metaInt(meta, 'generation'),
    builtAt: metaString(meta, 'built_at'),
    sourceRepo: metaString(meta, 'source_repo'),
    sourceCommit: metaString(meta, 'source_commit'),
    entryCount: metaInt(meta, 'entry_count'),
    collectionCount: metaInt(meta, 'collection_count'),
    unparsedCount: metaInt(meta, 'unparsed_count'),
    dupeCount: metaInt(meta, 'dupe_count'),
  }
}

/**
 * One-shot read of a database file's meta stamp (readiness, diagnostics).
 * Returns null when no file exists; throws loud on a newer schema version
 * or a file that is not an arsenal index.
 */
export function readArsenalIndexMeta(dbPath: string): ArsenalIndexMeta | null {
  if (!existsSync(dbPath)) return null
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return readMeta(db)
  } finally {
    db.close()
  }
}

function removeTmpFiles(tmpPath: string): void {
  for (const path of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
    rmSync(path, { force: true })
  }
}

/** Spec §5 build validation, run against the tmp database before any swap. */
function validateBuild(db: DatabaseSync, data: ArsenalBuildData): void {
  const integrity = db.prepare('PRAGMA integrity_check').get() as
    | Record<string, unknown>
    | undefined
  if (integrity === undefined || integrity['integrity_check'] !== 'ok') {
    throw new ArsenalValidationError(
      `integrity_check returned ${JSON.stringify(integrity?.['integrity_check'] ?? null)}`,
    )
  }
  if (data.entries.length === 0) {
    throw new ArsenalValidationError('entry_count is 0 — an empty generation never swaps in')
  }
  const entriesPerCollection = new Map<string, number>()
  for (const entry of data.entries) {
    entriesPerCollection.set(entry.collectionSlug, (entriesPerCollection.get(entry.collectionSlug) ?? 0) + 1)
  }
  const knownSlugs = new Set(data.collections.map(c => c.slug))
  for (const slug of data.prioritySlugs) {
    if (!knownSlugs.has(slug)) {
      throw new ArsenalValidationError(`priority collection ${JSON.stringify(slug)} is missing from the build`)
    }
    if ((entriesPerCollection.get(slug) ?? 0) === 0) {
      throw new ArsenalValidationError(`priority collection ${JSON.stringify(slug)} has 0 entries`)
    }
  }
  const ftsRow = db.prepare('SELECT count(*) AS n FROM entries_fts').get() as Record<string, unknown>
  if (ftsRow['n'] !== data.entries.length) {
    throw new ArsenalValidationError(
      `FTS index holds ${String(ftsRow['n'])} rows for ${data.entries.length} entries`,
    )
  }
}

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
export function buildAndSwapArsenalIndex(
  dbPath: string,
  data: ArsenalBuildData,
  opts: { releaseServing?: () => void } = {},
): { generation: number; entryCount: number } {
  mkdirSync(dirname(dbPath), { recursive: true })
  // Reading the previous stamp first also refuses, loudly, to overwrite a
  // database written by newer code.
  const previous = readArsenalIndexMeta(dbPath)
  const generation = (previous?.generation ?? 0) + 1
  const tmpPath = `${dbPath}.tmp`
  removeTmpFiles(tmpPath)
  let db: DatabaseSync | undefined
  let inTransaction = false
  try {
    db = new DatabaseSync(tmpPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(ARSENAL_SCHEMA_DDL)
    const insertMeta = db.prepare('INSERT INTO index_meta (key, value) VALUES (?, ?)')
    const insertCollection = db.prepare(
      'INSERT INTO collections (slug, name, url, description, topic, fetched_at, entry_count, fetch_error)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const insertEntry = db.prepare(
      'INSERT INTO entries (name, url, description, collection_slug, tags, targets, battery)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    db.exec('BEGIN')
    inTransaction = true
    const metaPairs: Array<[string, string]> = [
      ['schema_version', String(ARSENAL_SCHEMA_VERSION)],
      ['generation', String(generation)],
      ['built_at', data.builtAt ?? new Date().toISOString()],
      ['source_repo', data.sourceRepo],
      ['source_commit', data.sourceCommit],
      ['entry_count', String(data.entries.length)],
      ['collection_count', String(data.collections.length)],
      ['unparsed_count', String(data.unparsedCount)],
      ['dupe_count', String(data.dupeCount)],
    ]
    for (const [key, value] of metaPairs) insertMeta.run(key, value)
    for (const c of data.collections) {
      insertCollection.run(c.slug, c.name, c.url, c.description, c.topic, c.fetchedAt, c.entryCount, c.fetchError)
    }
    for (const e of data.entries) {
      insertEntry.run(
        e.name,
        e.url,
        e.description,
        e.collectionSlug,
        JSON.stringify(e.tags),
        JSON.stringify(e.targets),
        JSON.stringify(e.battery),
      )
    }
    db.exec("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')")
    validateBuild(db, data)
    db.exec('COMMIT')
    inTransaction = false
    // Fold the tmp WAL back into the tmp file so the rename moves one
    // complete, self-contained database.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    db = undefined
  } catch (err) {
    if (db !== undefined) {
      if (inTransaction) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // The connection is being discarded either way.
        }
      }
      try {
        db.close()
      } catch {
        // The tmp files are deleted below regardless.
      }
    }
    removeTmpFiles(tmpPath)
    throw err
  }
  opts.releaseServing?.()
  renameSync(tmpPath, dbPath)
  // The previous generation's WAL sidecars no longer belong to the file at
  // this path; the serving store reopens the new file fresh.
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
  return { generation, entryCount: data.entries.length }
}

/** The read path's view of the index: one cached handle, generation-aware. */
export interface ArsenalServingStore {
  readonly dbPath: string
  /**
   * The serving handle and its meta stamp, or null when no index has been
   * built yet. Re-stats the file on every call and reopens read-only when
   * the file changed (a swap), so tools always read the serving generation.
   * Throws loud when the on-disk schema is newer than this code (spec T7).
   */
  current(): { db: DatabaseSync; meta: ArsenalIndexMeta } | null
  /** The serving generation's meta stamp, or null when no index exists. */
  meta(): ArsenalIndexMeta | null
  /** Drop the cached handle; the next `current()` reopens from disk. */
  close(): void
}

/** Open the serving store over `dbPath`. The file is not created here. */
export function openArsenalServingStore(dbPath: string): ArsenalServingStore {
  let handle: { db: DatabaseSync; meta: ArsenalIndexMeta; mtimeMs: number; size: number } | null = null

  function dropHandle(): void {
    if (handle !== null) {
      try {
        handle.db.close()
      } catch {
        // A stale handle is discarded either way.
      }
      handle = null
    }
  }

  function current(): { db: DatabaseSync; meta: ArsenalIndexMeta } | null {
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(dbPath)
    } catch {
      // No serving file: any cached handle points at a deleted inode.
      dropHandle()
      return null
    }
    if (handle !== null && handle.mtimeMs === stat.mtimeMs && handle.size === stat.size) {
      return { db: handle.db, meta: handle.meta }
    }
    dropHandle()
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const meta = readMeta(db)
      handle = { db, meta, mtimeMs: stat.mtimeMs, size: stat.size }
      return { db, meta }
    } catch (err) {
      try {
        db.close()
      } catch {
        // The open failed loudly; nothing to clean up.
      }
      throw err
    }
  }

  return {
    dbPath,
    current,
    meta(): ArsenalIndexMeta | null {
      return current()?.meta ?? null
    },
    close(): void {
      dropHandle()
    },
  }
}
