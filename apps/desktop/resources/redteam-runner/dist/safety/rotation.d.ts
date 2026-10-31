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
export declare const LOG_ROTATION_VERSION = 1;
/** Default: rotate an append-only log once it passes 50 MiB. */
export declare const DEFAULT_LOG_MAX_BYTES: number;
/** Default: keep the 5 most recent archives per log file. */
export declare const DEFAULT_LOG_MAX_ARCHIVES = 5;
export declare const LOG_MAX_BYTES_ENV = "REDTEAM_LOG_MAX_BYTES";
export declare const LOG_MAX_ARCHIVES_ENV = "REDTEAM_LOG_MAX_ARCHIVES";
export interface LogRotationConfig {
    /** Rotate once a log file exceeds this many bytes. */
    maxBytes: number;
    /** How many archives to keep per log file; older are pruned. */
    maxArchives: number;
}
/**
 * Resolve rotation config: explicit opts > env > defaults.
 * Env values are validated at parse time with a clear message naming the
 * variable (fail fast, before any engagement runs).
 */
export declare function resolveLogRotationConfig(env: NodeJS.ProcessEnv, opts?: {
    maxLogBytes?: number;
    maxLogArchives?: number;
}): LogRotationConfig;
export interface SeqRange {
    firstSeq: number;
    lastSeq: number;
}
export interface RotationOutcome {
    rotated: boolean;
    /** Full path of the new archive (when rotated). */
    archivePath?: string;
    /** Seq range the archive covers (events.jsonl callers pass this in). */
    firstSeq?: number;
    lastSeq?: number;
}
/**
 * Rotate `filePath` if it exceeds config.maxBytes. Archive-first (rename),
 * immutable archive (chmod 444), oldest pruned beyond maxArchives.
 * Throws on any I/O failure — fail closed, never silent loss.
 */
export declare function maybeRotateLog(filePath: string, config: LogRotationConfig, seqRange?: SeqRange): RotationOutcome;
