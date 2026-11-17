/**
 * Engagement lifecycle wiring (brief §7.1): the three moments memory
 * touches a run — open (before any agent acts), recall (start pack after
 * authorization, refresh pack after recon), and commit (in the finally,
 * after trajectory capture). Also owns the adapter from the real store
 * to recall's `MemoryRecallStore` seam.
 *
 * The session lives in a WeakMap keyed by the run context until the
 * §2.3 `Ctx.memory` field lands; `memoryStateFor` is the read path
 * either way. Blocked runs (authorization denied) still archive: their
 * scope is the unverified host set, recall is recorded as
 * `skipped-authorization-denied`, and no pack is assembled.
 */
import type { Ctx } from "../context.js";
import type { MemoryEngagementState } from "./types.js";
import type { MemoryDeps } from "./lifecycle-session.js";
export { deriveEngagementScope, memoryStateFor, parseMemoryBudget, resolveMemoryRootForRun, } from "./lifecycle-session.js";
export type { MemoryDeps } from "./lifecycle-session.js";
export { injectExploitMemory, injectStartMemory, recallStoreAdapter } from "./lifecycle-recall.js";
export { commitMemoryForRun } from "./lifecycle-commit.js";
/**
 * Moment 1 (§7.1): open the store before any agent acts. Bootstrapping
 * a fresh store is recorded on the event log; opening an existing one
 * validates it (corruption fails loud here, not mid-run).
 *
 * @param ctx - The run context.
 * @param options - Root override, engagement dir, injectable deps.
 * @returns The engagement's memory state.
 */
export declare function openEngagementMemory(ctx: Ctx, options?: {
    root?: string;
    engagementDir?: string;
    deps?: MemoryDeps;
}): MemoryEngagementState;
/**
 * The coverage-digest line (§2.3): survivor counts by tier from the
 * freshest pack, with its receipt id. Null when no pack was assembled.
 *
 * @param ctx - The run context.
 * @returns The digest line, or null.
 */
export declare function memoryDigestLine(ctx: Ctx): string | null;
