import type { Harness2Paths } from "./contract.js";
/** `<root>/archive`. */
export declare function archiveRoot(paths: Harness2Paths): string;
/** UTC YYYY-MM-DD archive stamp. */
export declare function archiveDate(now?: Date): string;
/** Sanitize a free-text rollback reason into a safe single archive-name segment. */
export declare function sanitizeArchiveReason(reason: string): string;
/** First free `<parent>/<name>` (then `-2`, `-3`, ...): an archive is never overwritten. */
export declare function uniqueArchivePath(parent: string, name: string): string;
/** What kind of lifecycle operation produced an archive directory. */
export type ArchiveKind = "consolidated" | "rollback" | "incident";
/** One layer as captured in an archive manifest. */
export interface ArchivedLayerSnapshot {
    readonly id: string;
    readonly dir: string;
    readonly targetClass: string | null;
    readonly adoptedAt: string;
    readonly evidenceRunId: string;
    readonly installedAt: string;
    readonly sha256: string;
}
export interface ArchiveMoveInput {
    readonly paths: Harness2Paths;
    /** Layer ids to move, in active-set order. */
    readonly layerIds: readonly string[];
    readonly kind: ArchiveKind;
    /** Free-text reason (rollback cause / incident cause); absent for consolidation. */
    readonly reason?: string;
    /** UTC date for the directory name; defaults to today. */
    readonly date?: string;
    readonly now?: Date;
    /** Caller metrics/metadata merged into manifest.json (never replaces layers[]). */
    readonly manifest?: Readonly<Record<string, unknown>>;
}
export interface ArchiveMoveResult {
    /** The dated archive directory (unique; never an existing one). */
    readonly dir: string;
    readonly manifestPath: string;
    readonly createdAt: string;
    readonly layers: readonly ArchivedLayerSnapshot[];
}
/** The dated directory name for one operation: `<date>-<kind>[-<reason>]`. */
export declare function archiveDirName(kind: ArchiveKind, reason: string | undefined, date: string): string;
/**
 * Move layer directories into a new dated archive directory and write its
 * manifest. Every source is validated BEFORE anything is created; after the
 * move every archived layer must still carry its `layer.yml`, so a lost layer is
 * reported instead of silently dropped. Never deletes an archive.
 */
export declare function moveLayersToArchive(input: ArchiveMoveInput): ArchiveMoveResult;
/** Every archive directory on disk, newest name first (missing archive root = []). */
export declare function listArchiveDirs(paths: Harness2Paths): string[];
/** Find an already-archived layer directory by id, across every archive; null when never archived. */
export declare function findArchivedLayer(paths: Harness2Paths, layerId: string): string | null;
/** Read one archive manifest tolerantly; null when absent or unreadable. */
export declare function readArchiveManifest(dir: string): Record<string, unknown> | null;
