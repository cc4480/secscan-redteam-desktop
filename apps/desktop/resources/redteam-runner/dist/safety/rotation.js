/**
 * Log rotation for long-running engagements and watch mode (v0.26.0).
 *
 * The append-only stores — events.jsonl, engagement.md, and watch mode's
 * history.jsonl — grow unbounded on an indefinite watch loop. Left alone,
 * a daily-cadence profile eventually exhausts the runner host's disk.
 *
 * Rotation caps size and archive count with one shared helper:
 *  - when a file exceeds maxBytes, it is renamed to
 *    <name>.<UTC-timestamp> (archive first — the archive is complete
 *    before the fresh file starts, so no data is ever lost mid-rotate),
 *  - the archive is chmod 444 (immutable, append-never),
 *  - archives beyond maxArchives are pruned oldest-first,
 *  - for events.jsonl the caller records a `log_rotated` audit event in
 *    the fresh file noting the archive path and the seq range it covers,
 *    so PoC bundles' `auditSeq` references stay resolvable.
 *
 * Fail closed: any I/O failure during rotation throws with a clear
 * message. Rotation never silently drops audit data.
 */
import { chmodSync, existsSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
export const LOG_ROTATION_VERSION = 1;
/** Default: rotate an append-only log once it passes 50 MiB. */
export const DEFAULT_LOG_MAX_BYTES = 50 * 1024 * 1024;
/** Default: keep the 5 most recent archives per log file. */
export const DEFAULT_LOG_MAX_ARCHIVES = 5;
export const LOG_MAX_BYTES_ENV = "REDTEAM_LOG_MAX_BYTES";
export const LOG_MAX_ARCHIVES_ENV = "REDTEAM_LOG_MAX_ARCHIVES";
function parsePositiveInt(raw, name) {
    if (raw === undefined || raw.trim() === "")
        return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`[runner] bad ${name}=${JSON.stringify(raw)}; want a positive integer`);
    }
    return n;
}
/**
 * Resolve rotation config: explicit opts > env > defaults.
 * Env values are validated at parse time with a clear message naming the
 * variable (fail fast, before any engagement runs).
 */
export function resolveLogRotationConfig(env, opts = {}) {
    const maxBytes = opts.maxLogBytes ??
        parsePositiveInt(env[LOG_MAX_BYTES_ENV], LOG_MAX_BYTES_ENV) ??
        DEFAULT_LOG_MAX_BYTES;
    const maxArchives = opts.maxLogArchives ??
        parsePositiveInt(env[LOG_MAX_ARCHIVES_ENV], LOG_MAX_ARCHIVES_ENV) ??
        DEFAULT_LOG_MAX_ARCHIVES;
    return { maxBytes, maxArchives };
}
/** UTC timestamp for archive names: 2026-10-03T20-30-00-123Z (sorts chronologically). */
function archiveStamp(now = new Date()) {
    return now.toISOString().replace(/[:.]/g, "-");
}
function uniqueArchivePath(dir, base, stamp) {
    let candidate = join(dir, `${base}.${stamp}`);
    for (let i = 1; existsSync(candidate); i++) {
        candidate = join(dir, `${base}.${stamp}-${i}`);
    }
    return candidate;
}
function listArchives(dir, base) {
    let names = [];
    try {
        names = readdirSync(dir);
    }
    catch {
        return [];
    }
    const prefix = `${base}.`;
    return names
        .filter((n) => n !== base && n.startsWith(prefix))
        .sort()
        .map((n) => join(dir, n));
}
/**
 * Rotate `filePath` if it exceeds config.maxBytes. Archive-first (rename),
 * immutable archive (chmod 444), oldest pruned beyond maxArchives.
 * Throws on any I/O failure — fail closed, never silent loss.
 */
export function maybeRotateLog(filePath, config, seqRange) {
    if (!existsSync(filePath))
        return { rotated: false };
    let size;
    try {
        size = statSync(filePath).size;
    }
    catch (err) {
        throw new Error(`[runner] log rotation: cannot stat ${filePath}: ${err.message}`);
    }
    if (size < config.maxBytes)
        return { rotated: false };
    const dir = dirname(filePath);
    const base = basename(filePath);
    const archivePath = uniqueArchivePath(dir, base, archiveStamp());
    try {
        renameSync(filePath, archivePath); // archive complete before fresh file starts
        chmodSync(archivePath, 0o444); // immutable, append-never
    }
    catch (err) {
        throw new Error(`[runner] log rotation: failed to archive ${filePath}: ${err.message}`);
    }
    // Prune oldest beyond the cap. Prune failures must not abort the run —
    // the fresh file already exists, so report them loudly on stderr.
    const archives = listArchives(dir, base);
    for (const old of archives.slice(0, Math.max(0, archives.length - config.maxArchives))) {
        try {
            unlinkSync(old);
        }
        catch (err) {
            console.error(`[runner] log rotation: could not prune old archive ${old}: ${err.message}`);
        }
    }
    return {
        rotated: true,
        archivePath,
        firstSeq: seqRange?.firstSeq,
        lastSeq: seqRange?.lastSeq,
    };
}
//# sourceMappingURL=rotation.js.map