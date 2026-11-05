/**
 * The commit moment, extracted from `lifecycle.ts` to keep that module
 * inside the 300-line file budget: the two-phase commit run in the
 * engagement finally, its event line and the receipt mirror.
 * Behaviour is unchanged.
 */
import type { Ctx } from "../context.js";
import type { MemoryEngagementReceipt } from "./types.js";
/**
 * Moment 4 (§7.1): the two-phase commit, run in the engagement's
 * finally AFTER trajectory capture. Mirrors the receipt into the
 * engagement directory and records the `memory_commit` event. Phase 1
 * archive failure throws `MemoryArchiveError` (the one memory failure
 * allowed to replace the run's return, §7.2); everything else returns
 * a receipt.
 *
 * @param ctx - The run context.
 * @param outcome - The run's terminal status and halt reason, if any.
 * @returns The memory receipt, or undefined when memory never opened.
 */
export declare function commitMemoryForRun(ctx: Ctx, outcome: {
    status: string;
    haltReason?: string;
}): MemoryEngagementReceipt | undefined;
