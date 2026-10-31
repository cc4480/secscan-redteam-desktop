/**
 * Harness2 section-10 editor-reply parser (H2-P2).
 *
 * The frontier editor answers a package with one structured message. This module
 * is the security and integrity boundary around that answer:
 *
 *   @@PROPOSAL <editable-component-id>@@   one full cordis patch-layer YAML
 *   @@RATIONALE@@                          why the change follows from the pair
 *   @@EXPECTED-EFFECT@@                    the metric and direction expected
 *   @@SUPPORTING-EVIDENCE@@                pair index / run ids (repeatable)
 *   @@FILE <repo-relative path>@@          the FULL file content (repeatable)
 *
 * Every block is explicit (a BEGIN marker and its @@END-<NAME>@@), so a
 * truncated reply is rejected as partial instead of half-applied. @@FILE bodies
 * must be full files: a unified diff (---/+++/hunk header) is rejected. Any
 * proposal or file path that touches a pinned guardrail (src/safety,
 * src/policy, auth-gate, or `component: guardrails`) is AUTO-REJECTED with
 * flagged = true and the matched pinned labels, so the caller can record the
 * security event and never apply the layer.
 */
import { EDITABLE_COMPONENTS, PINNED_COMPONENT } from "./contract.js";
import { findPinnedTouch, isPinnedPath } from "./package-component-map.js";
import { mentionsGuardrailComponent } from "./package-parse.js";
/** Reply block names, in the required order. */
export const REPLY_BLOCK_NAMES = ["PROPOSAL", "RATIONALE", "EXPECTED-EFFECT", "SUPPORTING-EVIDENCE", "FILE"];
/** Explicit alias for docs/tests that name the block table. */
export const EDITOR_REPLY_BLOCK_NAMES = REPLY_BLOCK_NAMES;
/** A rejected editor reply. `flagged` marks a pinned-guardrail violation. */
export class EditorReplyError extends Error {
    /** True when the reply touched a pinned guardrail (security event, not a typo). */
    flagged;
    /** Pinned path labels the reply touched; empty for a plain parse error. */
    pinnedPaths;
    constructor(message, flagged = false, pinnedPaths = []) {
        super(flagged ? `editor reply AUTO-REJECTED (pinned guardrail): ${message}` : `editor reply rejected: ${message}`);
        this.name = "EditorReplyError";
        this.flagged = flagged;
        this.pinnedPaths = pinnedPaths;
    }
}
const SIMPLE_OPENER = /^@@(PROPOSAL|RATIONALE|EXPECTED-EFFECT|SUPPORTING-EVIDENCE)(?:\s+(.*?))?\s*@@\s*$/;
const FILE_OPENER = /^@@FILE\s+(.+?)\s*@@\s*$/;
const END_LINE = /^@@END-(PROPOSAL|RATIONALE|EXPECTED-EFFECT|SUPPORTING-EVIDENCE|FILE)\s*@@\s*$/;
function scanBlocks(text) {
    const blocks = [];
    let current;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        const end = END_LINE.exec(line);
        if (end !== null) {
            if (current === undefined)
                throw new EditorReplyError(`unexpected @@END-${end[1]}@@ with no open block`);
            if (current.name !== end[1])
                throw new EditorReplyError(`@@END-${end[1]}@@ closes a ${current.name} block`);
            blocks.push(current);
            current = undefined;
            continue;
        }
        if (current !== undefined) {
            const nestedFile = FILE_OPENER.exec(line);
            const nestedSimple = SIMPLE_OPENER.exec(line);
            if (nestedFile !== null || nestedSimple !== null)
                throw new EditorReplyError(`@@${current.name}@@ block is not closed before the next block`);
            current.lines.push(raw);
            continue;
        }
        const file = FILE_OPENER.exec(line);
        if (file !== null) {
            current = { name: "FILE", tag: file[1], lines: [] };
            continue;
        }
        const simple = SIMPLE_OPENER.exec(line);
        if (simple !== null)
            current = { name: simple[1], tag: (simple[2] ?? "").trim(), lines: [] };
    }
    if (current !== undefined)
        throw new EditorReplyError(`@@${current.name}@@ block is never closed with @@END-${current.name}@@`);
    return blocks;
}
function bodyOf(block) {
    return block.lines.join("\n").replace(/\s+$/, "");
}
/** True when a @@FILE body is a patch instead of full content. */
export function isDiffContent(content) {
    const lines = content.split(/\r?\n/);
    const hasHunk = lines.some((line) => /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line));
    const hasMinus = lines.some((line) => /^--- (a\/|b\/|\S+\.\w+\t)/.test(line) || /^--- a\//.test(line));
    const hasPlus = lines.some((line) => /^\+\+\+ (a\/|b\/|\S+\.\w+\t)/.test(line) || /^\+\+\+ b\//.test(line));
    const hasGitDiff = lines.some((line) => /^diff --git /.test(line));
    return hasHunk || hasGitDiff || (hasMinus && hasPlus);
}
function unique(values) {
    return [...new Set(values)];
}
/**
 * Parse one editor reply into a complete proposal, or throw EditorReplyError.
 * Missing/empty/duplicated blocks are plain rejections; a pinned-guardrail
 * touch is an auto-reject with flagged = true.
 */
export function parseEditorReply(text) {
    if (typeof text !== "string" || text.trim() === "")
        throw new EditorReplyError("the reply was empty");
    const blocks = scanBlocks(text);
    const byName = (name) => blocks.filter((block) => block.name === name);
    const proposals = byName("PROPOSAL");
    const rationales = byName("RATIONALE");
    const effects = byName("EXPECTED-EFFECT");
    const evidences = byName("SUPPORTING-EVIDENCE");
    const fileBlocks = byName("FILE");
    const problems = [];
    if (proposals.length !== 1)
        problems.push(`expected exactly one @@PROPOSAL@@ block, found ${proposals.length}`);
    if (rationales.length !== 1)
        problems.push(`expected exactly one @@RATIONALE@@ block, found ${rationales.length}`);
    if (effects.length !== 1)
        problems.push(`expected exactly one @@EXPECTED-EFFECT@@ block, found ${effects.length}`);
    if (evidences.length === 0)
        problems.push("missing @@SUPPORTING-EVIDENCE@@ block");
    if (fileBlocks.length === 0)
        problems.push("missing @@FILE <path>@@ block with full file contents");
    if (problems.length > 0)
        throw new EditorReplyError(`partial reply: ${problems.join("; ")}`);
    const proposal = bodyOf(proposals[0]);
    const rationale = bodyOf(rationales[0]);
    const expectedEffect = bodyOf(effects[0]);
    if (proposal === "")
        throw new EditorReplyError("partial reply: the @@PROPOSAL@@ block is empty");
    if (rationale === "")
        throw new EditorReplyError("partial reply: the @@RATIONALE@@ block is empty");
    if (expectedEffect === "")
        throw new EditorReplyError("partial reply: the @@EXPECTED-EFFECT@@ block is empty");
    const evidence = evidences.map(bodyOf).filter((entry) => entry !== "");
    if (evidence.length === 0)
        throw new EditorReplyError("partial reply: every @@SUPPORTING-EVIDENCE@@ block is empty");
    const pinned = [...findPinnedTouch(proposal)];
    if (mentionsGuardrailComponent(proposal))
        pinned.push(PINNED_COMPONENT);
    const seenPaths = new Set();
    const files = [];
    for (const block of fileBlocks) {
        const path = block.tag.trim();
        if (path === "")
            throw new EditorReplyError("partial reply: a @@FILE@@ block has no path");
        if (seenPaths.has(path))
            throw new EditorReplyError(`partial reply: @@FILE ${path}@@ appears more than once`);
        seenPaths.add(path);
        if (isPinnedPath(path))
            pinned.push(...findPinnedTouch(path));
        const content = bodyOf(block);
        if (content === "")
            throw new EditorReplyError(`partial reply: @@FILE ${path}@@ is empty; full file contents are required`);
        if (isDiffContent(content))
            throw new EditorReplyError(`@@FILE ${path}@@ contains a diff; the FULL file content is required (no diffs)`);
        files.push({ path, content });
    }
    if (pinned.length > 0) {
        throw new EditorReplyError(`the reply touches PINNED guardrail ${unique(pinned).join(", ")}; guardrails (src/safety, src/policy, auth-gate) are never editable`, true, unique(pinned));
    }
    const tag = proposals[0].tag.toLowerCase();
    const component = EDITABLE_COMPONENTS.includes(tag) ? tag : undefined;
    return { proposal, ...(component !== undefined ? { component } : {}), rationale, expectedEffect, evidence, files };
}
/** Old name kept for callers written against the phase-2a parser. */
export { EditorReplyError as ProposalParseError };
//# sourceMappingURL=package-reply.js.map