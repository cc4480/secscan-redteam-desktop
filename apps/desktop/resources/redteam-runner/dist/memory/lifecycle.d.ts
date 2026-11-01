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
import { commitEngagementMemory } from "./commit.js";
import { type MemoryPaths } from "./paths.js";
import { assembleMemoryPack, type MemoryRecallStore } from "./recall.js";
import { type MemoryStore } from "./store.js";
import type { MemoryEngagementReceipt, MemoryEngagementState, MemoryPackResult, MemoryScope } from "./types.js";
/** Injectable seams for tests (mirrors the RunnerDeps pattern). */
export interface MemoryDeps {
    openStore?: (paths: MemoryPaths) => MemoryStore;
    assemblePack?: typeof assembleMemoryPack;
    commit?: typeof commitEngagementMemory;
    now?: () => Date;
}
/**
 * The memory root for a run (§3.1): explicit override →
 * `REDTEAM_MEMORY_ROOT` → sibling of the registry file. An empty-string
 * env value is a misconfiguration and fails loud, naming the variable.
 *
 * @param ctx - The run context (registry path source).
 * @param override - An explicit root (RunOptions/config when wired).
 * @returns The memory root path.
 */
export declare function resolveMemoryRootForRun(ctx: Ctx, override?: string): string;
/**
 * Parse `REDTEAM_MEMORY_BUDGET` (1..24). Unset → undefined (recall's
 * default of 6 applies); a bad value fails loud naming the variable.
 *
 * @param env - The process environment.
 * @returns The budget, or undefined when unset.
 */
export declare function parseMemoryBudget(env: NodeJS.ProcessEnv): number | undefined;
/**
 * Adapt the real store to recall's seam. `ensureUnitViews` regenerates
 * the named units' views per-unit first (a unit that cannot regenerate
 * is a VIEW_STALE exclusion, §8 row 9 — never a recall crash), then runs
 * the directory-threshold pass; directories left stale are reported
 * from the views index with their pending counts.
 *
 * @param store - The open store.
 * @param paths - The store paths.
 * @param nowIso - Timestamp for refreshes and receipts.
 * @returns The recall-facing store adapter.
 */
export declare function recallStoreAdapter(store: MemoryStore, paths: MemoryPaths, nowIso: string): MemoryRecallStore;
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
 * The memory state for a run, when memory was opened.
 *
 * @param ctx - The run context.
 * @returns The state, or undefined when memory never opened.
 */
export declare function memoryStateFor(ctx: Ctx): MemoryEngagementState | undefined;
/**
 * Derive (and cache) the engagement's memory scope from the verified
 * authorization record. Throws `MEMORY_SCOPE_UNVERIFIED` when the run
 * has no verified authorization — memory never binds to an unverified
 * target (§4.2).
 *
 * @param ctx - The run context (post-authorize).
 * @returns The derived scope.
 */
export declare function deriveEngagementScope(ctx: Ctx): MemoryScope;
/**
 * Moment 2 (§7.1): the start pack — after authorization succeeds,
 * before planning. Query = objective + target + mode.
 *
 * @param ctx - The run context (post-authorize).
 * @returns The assembled pack (also cached on the memory state).
 */
export declare function injectStartMemory(ctx: Ctx): MemoryPackResult;
/**
 * Moment 3 (§7.1): the refresh pack — after recon, with the fingerprint.
 * Query adds stack/appType and the registry hits' vuln classes;
 * eligibility carries the ROE deny set and the class/stack context.
 *
 * @param ctx - The run context (post-recon).
 * @returns The assembled pack (also cached on the memory state).
 */
export declare function injectExploitMemory(ctx: Ctx): MemoryPackResult;
/**
 * The coverage-digest line (§2.3): survivor counts by tier from the
 * freshest pack, with its receipt id. Null when no pack was assembled.
 *
 * @param ctx - The run context.
 * @returns The digest line, or null.
 */
export declare function memoryDigestLine(ctx: Ctx): string | null;
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
