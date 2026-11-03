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
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ARSENAL_SCHEMA_DDL, ARSENAL_SCHEMA_VERSION, ArsenalValidationError, metaInt, metaString } from './index-schema.js';
export { ARSENAL_SCHEMA_VERSION, ArsenalValidationError } from './index-schema.js';
/** Monotonic schema version of the arsenal index; bump only with a migration step. */
/** Read and validate the `index_meta` stamp of an open database. */
function readMeta(db) {
    let rows;
    try {
        rows = db.prepare('SELECT key, value FROM index_meta').all();
    }
    catch {
        throw new Error('[arsenal] database has no index_meta table — not an arsenal index');
    }
    const meta = new Map();
    for (const row of rows)
        meta.set(String(row['key']), String(row['value']));
    const schemaVersion = metaInt(meta, 'schema_version');
    if (schemaVersion > ARSENAL_SCHEMA_VERSION) {
        throw new Error(`[arsenal] index schema v${schemaVersion} is newer than this code (v${ARSENAL_SCHEMA_VERSION}); refusing to serve it`);
    }
    if (schemaVersion < ARSENAL_SCHEMA_VERSION) {
        throw new Error(`[arsenal] index schema v${schemaVersion} predates this code (v${ARSENAL_SCHEMA_VERSION}) and no migration exists; rebuild the index`);
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
    };
}
/**
 * One-shot read of a database file's meta stamp (readiness, diagnostics).
 * Returns null when no file exists; throws loud on a newer schema version
 * or a file that is not an arsenal index.
 */
export function readArsenalIndexMeta(dbPath) {
    if (!existsSync(dbPath))
        return null;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
        return readMeta(db);
    }
    finally {
        db.close();
    }
}
function removeTmpFiles(tmpPath) {
    for (const path of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
        rmSync(path, { force: true });
    }
}
/** Spec §5 build validation, run against the tmp database before any swap. */
function validateBuild(db, data) {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (integrity === undefined || integrity['integrity_check'] !== 'ok') {
        throw new ArsenalValidationError(`integrity_check returned ${JSON.stringify(integrity?.['integrity_check'] ?? null)}`);
    }
    if (data.entries.length === 0) {
        throw new ArsenalValidationError('entry_count is 0 — an empty generation never swaps in');
    }
    const entriesPerCollection = new Map();
    for (const entry of data.entries) {
        entriesPerCollection.set(entry.collectionSlug, (entriesPerCollection.get(entry.collectionSlug) ?? 0) + 1);
    }
    const knownSlugs = new Set(data.collections.map(c => c.slug));
    for (const slug of data.prioritySlugs) {
        if (!knownSlugs.has(slug)) {
            throw new ArsenalValidationError(`priority collection ${JSON.stringify(slug)} is missing from the build`);
        }
        if ((entriesPerCollection.get(slug) ?? 0) === 0) {
            throw new ArsenalValidationError(`priority collection ${JSON.stringify(slug)} has 0 entries`);
        }
    }
    const ftsRow = db.prepare('SELECT count(*) AS n FROM entries_fts').get();
    if (ftsRow['n'] !== data.entries.length) {
        throw new ArsenalValidationError(`FTS index holds ${String(ftsRow['n'])} rows for ${data.entries.length} entries`);
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
export function buildAndSwapArsenalIndex(dbPath, data, opts = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });
    // Reading the previous stamp first also refuses, loudly, to overwrite a
    // database written by newer code.
    const previous = readArsenalIndexMeta(dbPath);
    const generation = (previous?.generation ?? 0) + 1;
    const tmpPath = `${dbPath}.tmp-${process.pid}`;
    removeTmpFiles(tmpPath);
    let db;
    let inTransaction = false;
    try {
        db = new DatabaseSync(tmpPath);
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA foreign_keys = ON');
        db.exec('PRAGMA busy_timeout = 5000');
        db.exec(ARSENAL_SCHEMA_DDL);
        const insertMeta = db.prepare('INSERT INTO index_meta (key, value) VALUES (?, ?)');
        const insertCollection = db.prepare('INSERT INTO collections (slug, name, url, description, topic, fetched_at, entry_count, fetch_error)' +
            ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const insertEntry = db.prepare('INSERT INTO entries (name, url, description, collection_slug, tags, targets, battery)' +
            ' VALUES (?, ?, ?, ?, ?, ?, ?)');
        db.exec('BEGIN');
        inTransaction = true;
        const metaPairs = [
            ['schema_version', String(ARSENAL_SCHEMA_VERSION)],
            ['generation', String(generation)],
            ['built_at', data.builtAt ?? new Date().toISOString()],
            ['source_repo', data.sourceRepo],
            ['source_commit', data.sourceCommit],
            ['entry_count', String(data.entries.length)],
            ['collection_count', String(data.collections.length)],
            ['unparsed_count', String(data.unparsedCount)],
            ['dupe_count', String(data.dupeCount)],
        ];
        for (const [key, value] of metaPairs)
            insertMeta.run(key, value);
        for (const c of data.collections) {
            insertCollection.run(c.slug, c.name, c.url, c.description, c.topic, c.fetchedAt, c.entryCount, c.fetchError);
        }
        for (const e of data.entries) {
            insertEntry.run(e.name, e.url, e.description, e.collectionSlug, JSON.stringify(e.tags), JSON.stringify(e.targets), JSON.stringify(e.battery));
        }
        db.exec("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')");
        validateBuild(db, data);
        db.exec('COMMIT');
        inTransaction = false;
        // Fold the tmp WAL back into the tmp file so the rename moves one
        // complete, self-contained database.
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.close();
        db = undefined;
    }
    catch (err) {
        if (db !== undefined) {
            if (inTransaction) {
                try {
                    db.exec('ROLLBACK');
                }
                catch {
                    // The connection is being discarded either way.
                }
            }
            try {
                db.close();
            }
            catch {
                // The tmp files are deleted below regardless.
            }
        }
        removeTmpFiles(tmpPath);
        throw err;
    }
    opts.releaseServing?.();
    renameSync(tmpPath, dbPath);
    // The previous generation's WAL sidecars no longer belong to the file at
    // this path; the serving store reopens the new file fresh.
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    return { generation, entryCount: data.entries.length };
}
/** Open the serving store over `dbPath`. The file is not created here. */
export function openArsenalServingStore(dbPath) {
    let handle = null;
    function dropHandle() {
        if (handle !== null) {
            try {
                handle.db.close();
            }
            catch {
                // A stale handle is discarded either way.
            }
            handle = null;
        }
    }
    function current() {
        let stat;
        try {
            stat = statSync(dbPath);
        }
        catch {
            // No serving file: any cached handle points at a deleted inode.
            dropHandle();
            return null;
        }
        if (handle !== null && handle.mtimeMs === stat.mtimeMs && handle.size === stat.size) {
            return { db: handle.db, meta: handle.meta };
        }
        dropHandle();
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
            const meta = readMeta(db);
            handle = { db, meta, mtimeMs: stat.mtimeMs, size: stat.size };
            return { db, meta };
        }
        catch (err) {
            try {
                db.close();
            }
            catch {
                // The open failed loudly; nothing to clean up.
            }
            throw err;
        }
    }
    return {
        dbPath,
        current,
        meta() {
            return current()?.meta ?? null;
        },
        close() {
            dropHandle();
        },
    };
}
//# sourceMappingURL=index-store.js.map