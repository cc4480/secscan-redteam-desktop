import type { Harness2Paths, TargetClass } from "./contract.js";
/** Canonical section-7 markdown format, restated wherever a file is explained. */
export declare const EXPERIENCE_FORMAT_DOC: string;
/** Lifecycle status of one section-7 record. */
export type ExperienceStatus = {
    readonly kind: "active";
} | {
    readonly kind: "superseded";
    readonly by: string;
} | {
    readonly kind: "reverted";
    readonly reason: string;
    readonly date: string;
};
/** One section-7 EXPERIENCE.md entry. */
export interface ExperienceRecord {
    /** ISO date, e.g. 2026-10-18. */
    readonly date: string;
    /** Target class the ledger belongs to (one file per class). */
    readonly targetClass: TargetClass;
    /** Layer this record is about; undefined renders the heading token `general`. */
    readonly layerId?: string;
    /** Tuning cycle this record belongs to. */
    readonly cycleId: string;
    /** `- Changed (layer/file):` what changed in the harness. */
    readonly changed: string;
    /** `- Why (motivating run_ids):` the measured runs that motivated it. */
    readonly why: string;
    /** `- Measured effect (...):` metric deltas plus sample size, never an estimate. */
    readonly measuredEffect: string;
    /** `- Status:` current lifecycle status. */
    readonly status: ExperienceStatus;
}
/** Parsed form of one EXPERIENCE.md body. */
export interface ExperienceParseResult {
    readonly entries: readonly ExperienceRecord[];
    readonly skipped: number;
}
/** One class's parsed file plus where it lives. */
export interface ExperienceReport extends ExperienceParseResult {
    readonly targetClass: TargetClass;
    readonly path: string;
    readonly exists: boolean;
}
/** Compact one-line summary for `experience list`. */
export interface ExperienceFileInfo {
    readonly targetClass: TargetClass;
    readonly path: string;
    readonly entries: number;
    readonly skipped: number;
}
/** One scanned level-2 block: line range for surgical edits, record null when malformed. */
export interface ExperienceBlock {
    readonly startLine: number;
    readonly statusLine: number;
    readonly record: ExperienceRecord | null;
}
/** A scanned file: raw lines plus every level-2 block in order. */
export interface ExperienceScan {
    readonly lines: readonly string[];
    readonly blocks: readonly ExperienceBlock[];
}
/** True for a real calendar date in YYYY-MM-DD form. */
export declare function isIsoDate(value: string): boolean;
/** The YYYY-MM-DD part of an ISO timestamp, when it is a real date. */
export declare function isoDateOf(value: string | undefined): string | undefined;
/** Collapse a value to one trimmed line so a bullet can never break the format. */
export declare function oneLine(value: string): string;
/** True when a token can be a layer id or cycle id and survive the round-trip. */
export declare function isExperienceToken(value: string): boolean;
/** Sanitize a target class into a safe EXPERIENCE.md filename stem. */
export declare function sanitizeTargetClass(targetClass: TargetClass): string;
/** `<paths.experience>/<sanitized-target-class>.md`. */
export declare function resolveExperiencePath(paths: Harness2Paths, targetClass: TargetClass): string;
/** The dedupe key: (date, layerId, cycleId, changed). */
export declare function experienceKey(record: ExperienceRecord): string;
/** Render the `- Status:` value exactly as the canonical format defines it. */
export declare function renderStatus(status: ExperienceStatus): string;
/**
 * Scan a body into level-2 blocks with their line ranges, so a status flip can
 * touch exactly one line. Everything outside a record (header, prose) is left
 * for the caller to preserve byte for byte.
 */
export declare function scanExperience(markdown: string, targetClass: TargetClass): ExperienceScan;
/**
 * Parse a body into section-7 records; malformed blocks are skipped (counted),
 * never thrown on, and prose outside records is tolerated and ignored.
 */
export declare function parseExperience(markdown: string, targetClass: TargetClass): ExperienceParseResult;
/** Canonical markdown block for one section-7 record; the inverse of the parser. */
export declare function renderEntry(record: ExperienceRecord): string;
/**
 * The COMPLETE canonical file text (header + every record in order), which is
 * what a proposal package ships verbatim for the class (spec section 6.5).
 */
export declare function renderFullText(records: readonly ExperienceRecord[], targetClass?: TargetClass): string;
/** Backwards-compatible name for the canonical renderer. */
export declare const renderExperience: typeof renderFullText;
/** Read one class's EXPERIENCE.md; a missing or unreadable file reads as empty. */
export declare function readExperienceReport(paths: Harness2Paths, targetClass: TargetClass): ExperienceReport;
/** The class's records; absence/unreadability means no records (never throws). */
export declare function readExperience(paths: Harness2Paths, targetClass: TargetClass): ExperienceRecord[];
/** The class's EXPERIENCE.md full text verbatim; absent means canonical empty text. */
export declare function readExperienceFullText(paths: Harness2Paths, targetClass: TargetClass): string;
/** Every per-class EXPERIENCE.md on disk, with entry/skip counts (never throws). */
export declare function listExperience(paths: Harness2Paths): ExperienceFileInfo[];
/** One class's records plus the file's full markdown text (CLI `experience show`). */
export declare function showExperience(paths: Harness2Paths, targetClass: TargetClass): ExperienceReport & {
    readonly markdown: string;
};
