/** Reply block names, in the required order. */
export declare const REPLY_BLOCK_NAMES: readonly ["PROPOSAL", "RATIONALE", "EXPECTED-EFFECT", "SUPPORTING-EVIDENCE", "FILE"];
/** Explicit alias for docs/tests that name the block table. */
export declare const EDITOR_REPLY_BLOCK_NAMES: readonly ["PROPOSAL", "RATIONALE", "EXPECTED-EFFECT", "SUPPORTING-EVIDENCE", "FILE"];
/** A rejected editor reply. `flagged` marks a pinned-guardrail violation. */
export declare class EditorReplyError extends Error {
    /** True when the reply touched a pinned guardrail (security event, not a typo). */
    readonly flagged: boolean;
    /** Pinned path labels the reply touched; empty for a plain parse error. */
    readonly pinnedPaths: readonly string[];
    constructor(message: string, flagged?: boolean, pinnedPaths?: readonly string[]);
}
/** One full-file block from the reply. */
export interface ReplyFile {
    /** Repo-relative path named by the @@FILE header. */
    readonly path: string;
    /** FULL file content, verbatim (never a diff). */
    readonly content: string;
}
/** The parsed, structurally complete editor reply. */
export interface EditorReply {
    /** One full cordis patch-layer YAML document (verbatim). */
    readonly proposal: string;
    /** The editable component the proposal names, when the tag is one of them. */
    readonly component?: string;
    readonly rationale: string;
    readonly expectedEffect: string;
    readonly evidence: readonly string[];
    readonly files: readonly ReplyFile[];
}
/** True when a @@FILE body is a patch instead of full content. */
export declare function isDiffContent(content: string): boolean;
/**
 * Parse one editor reply into a complete proposal, or throw EditorReplyError.
 * Missing/empty/duplicated blocks are plain rejections; a pinned-guardrail
 * touch is an auto-reject with flagged = true.
 */
export declare function parseEditorReply(text: string): EditorReply;
/** Old name kept for callers written against the phase-2a parser. */
export { EditorReplyError as ProposalParseError };
