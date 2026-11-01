/** Results at or under this many chars reach the model verbatim (today's ceiling, unchanged). */
export declare const SPILL_THRESHOLD_CHARS = 4000;
/** Head preview length in the model-visible spilled observation. */
export declare const PREVIEW_HEAD_CHARS = 2400;
/** Tail preview length in the model-visible spilled observation. */
export declare const PREVIEW_TAIL_CHARS = 800;
/** read_spill page size: default and hard max, in chars. */
export declare const READ_SPILL_DEFAULT_CHARS = 4000;
export declare const READ_SPILL_MAX_CHARS = 8000;
export declare const SPILL_DIR_NAME = "spill";
export declare const SPILL_MANIFEST_NAME = "manifest.jsonl";
export interface SpillRecord {
    seq: number;
    ts: string;
    tool: string;
    attackId: string | null;
    target: string | null;
    /** Engagement-relative path, e.g. "spill/0007-http_probe.txt". */
    file: string;
    chars: number;
    /** UTF-8 byte length of the spilled text (differs from chars on multibyte input). */
    bytes: number;
    sha256: string;
    headChars: number;
    tailChars: number;
}
export interface SpillOutcome {
    /** The model-bound observation content (the caller appends the state digest). */
    content: string;
    /** The manifest record when a spill happened; null otherwise. */
    record: SpillRecord | null;
    /** Error class when a spill was attempted and failed (caller audits it); the content is then the plain ceiling slice. */
    failed?: string;
}
/** One safe path segment from a tool name: letters, digits, dot, dash, underscore only. */
export declare function sanitizeToolSegment(tool: string): string;
/** Next spill sequence for a dir: one past the highest existing `<seq>-*.txt`, seeded from disk so a resumed process never overwrites. */
export declare function nextSpillSeq(spillDir: string): number;
/** The pinned model-visible omission notice. Text is stable — tests pin it verbatim. */
export declare function spillNotice(omitted: number, total: number, tool: string, relFile: string): string;
/**
 * Apply the spill policy to one tool result at the observation seam.
 *
 * - `text.length <= SPILL_THRESHOLD_CHARS` → verbatim, no file, no record.
 * - Over threshold with no engagement dir → the ceiling slice (partial test
 *   contexts keep today's behavior; no throw).
 * - Over threshold with a dir → full text to `<dir>/spill/<seq>-<tool>.txt`,
 *   one manifest line, and head + notice + tail as the content.
 * - Any write/manifest failure → the ceiling slice + `failed` set. A spill
 *   failure never fails the tool call and never references a file that
 *   does not exist.
 */
export declare function spillToolResult(opts: {
    dir: string | undefined;
    tool: string;
    attackId?: string;
    target?: string;
    text: string;
}): SpillOutcome;
export type ReadSpillResult = {
    ok: true;
    text: string;
} | {
    ok: false;
    error: string;
};
/**
 * Read back one window of a spilled result. The sandbox is mechanical:
 * the reference must be exactly `spill/<name>.txt` (one segment), it is
 * resolved against THIS engagement's spill dir, and the real path must
 * remain inside it — absolute paths, `..`, extra segments, backslashes,
 * and symlinks out are refused with a plain error. This is not a general
 * file reader and must never become one.
 */
export declare function readSpill(opts: {
    dir: string | undefined;
    path: string;
    offsetChars?: number;
    maxChars?: number;
}): ReadSpillResult;
