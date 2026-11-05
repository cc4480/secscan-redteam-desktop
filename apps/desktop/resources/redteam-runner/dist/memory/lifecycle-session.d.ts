/**
 * The memory session substrate, extracted from `lifecycle.ts` to keep
 * that module inside the 300-line file budget: the per-run WeakMap, its
 * accessors, and the memory-root/budget configuration. Behaviour is
 * unchanged.
 */
import type { Ctx } from "../context.js";
import type { commitEngagementMemory } from "./commit.js";
import type { MemoryPaths } from "./paths.js";
import type { assembleMemoryPack } from "./recall.js";
import type { MemoryStore } from "./store.js";
import type { MemoryEngagementState, MemoryScope } from "./types.js";
/** Injectable seams for tests (mirrors the RunnerDeps pattern). */
export interface MemoryDeps {
    openStore?: (paths: MemoryPaths) => MemoryStore;
    assemblePack?: typeof assembleMemoryPack;
    commit?: typeof commitEngagementMemory;
    now?: () => Date;
}
export interface MemorySession {
    store: MemoryStore;
    paths: MemoryPaths;
    state: MemoryEngagementState;
    engagementDir: string;
    targetClass: string;
    deps: MemoryDeps;
}
export declare const sessions: WeakMap<Ctx, MemorySession>;
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
 * The memory state for a run, when memory was opened.
 *
 * @param ctx - The run context.
 * @returns The state, or undefined when memory never opened.
 */
export declare function memoryStateFor(ctx: Ctx): MemoryEngagementState | undefined;
export declare function requireSession(ctx: Ctx): MemorySession;
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
