/**
 * Two-phase commit orchestrator (brief §7.2). Phase 1 archives the raw
 * engagement record FIRST — synchronous, durable, and the one memory
 * operation allowed to fail the run (`MemoryArchiveError`): losing the
 * raw history silently is worse than failing the engagement. Phase 2
 * summarizes, extracts proposals through the deterministic projectors,
 * validates + scope-binds + trust-derives every one, auto-applies the
 * mechanical-projection lane, and writes the signed diff — ALWAYS,
 * including the all-zero diff. Phase 2 never throws: its failures are
 * terminal states on the commit receipt (`.failed`, status `failed`),
 * because the archive is already durable.
 */
import type { MemoryEngagementReceipt } from "./types.js";
import type { MemoryCommitInput } from "./commit-archive.js";
export type { MemoryCommitInput } from "./commit-archive.js";
/**
 * Run the two-phase commit for a finished engagement and return the
 * receipt `run.ts` attaches to the result (§7.2). Phase 1 may throw
 * `MemoryArchiveError`; Phase 2 failures return
 * `commit: { status: "failed", error }` instead of throwing.
 *
 * @param input - The engagement's commit inputs.
 * @returns The memory engagement receipt.
 */
export declare function commitEngagementMemory(input: MemoryCommitInput): MemoryEngagementReceipt;
