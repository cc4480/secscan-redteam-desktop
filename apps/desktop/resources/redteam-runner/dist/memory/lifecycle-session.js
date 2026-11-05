/**
 * The memory session substrate, extracted from `lifecycle.ts` to keep
 * that module inside the 300-line file budget: the per-run WeakMap, its
 * accessors, and the memory-root/budget configuration. Behaviour is
 * unchanged.
 */
import { dirname, join } from "node:path";
import { MemoryError } from "./errors.js";
import { deriveMemoryScope } from "./scope.js";
export const sessions = new WeakMap();
/**
 * The memory root for a run (§3.1): explicit override →
 * `REDTEAM_MEMORY_ROOT` → sibling of the registry file. An empty-string
 * env value is a misconfiguration and fails loud, naming the variable.
 *
 * @param ctx - The run context (registry path source).
 * @param override - An explicit root (RunOptions/config when wired).
 * @returns The memory root path.
 */
export function resolveMemoryRootForRun(ctx, override) {
    if (override)
        return override;
    const raw = process.env["REDTEAM_MEMORY_ROOT"];
    if (raw !== undefined) {
        if (raw.trim() === "") {
            throw new MemoryError("SCHEMA_INVALID", "REDTEAM_MEMORY_ROOT is set but empty — misconfiguration fails loud");
        }
        return raw;
    }
    return join(dirname(ctx.config.registryPath), "memory");
}
/**
 * Parse `REDTEAM_MEMORY_BUDGET` (1..24). Unset → undefined (recall's
 * default of 6 applies); a bad value fails loud naming the variable.
 *
 * @param env - The process environment.
 * @returns The budget, or undefined when unset.
 */
export function parseMemoryBudget(env) {
    const raw = env["REDTEAM_MEMORY_BUDGET"];
    if (raw === undefined)
        return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 24) {
        throw new MemoryError("SCHEMA_INVALID", `REDTEAM_MEMORY_BUDGET=${JSON.stringify(raw)} is outside 1..24`);
    }
    return n;
}
/**
 * The memory state for a run, when memory was opened.
 *
 * @param ctx - The run context.
 * @returns The state, or undefined when memory never opened.
 */
export function memoryStateFor(ctx) {
    return sessions.get(ctx)?.state;
}
export function requireSession(ctx) {
    const session = sessions.get(ctx);
    if (!session)
        throw new MemoryError("SCHEMA_INVALID", "memory lifecycle called before openEngagementMemory");
    return session;
}
/**
 * Derive (and cache) the engagement's memory scope from the verified
 * authorization record. Throws `MEMORY_SCOPE_UNVERIFIED` when the run
 * has no verified authorization — memory never binds to an unverified
 * target (§4.2).
 *
 * @param ctx - The run context (post-authorize).
 * @returns The derived scope.
 */
export function deriveEngagementScope(ctx) {
    const session = requireSession(ctx);
    if (!session.state.scope) {
        session.state.scope = deriveMemoryScope({
            engagementId: ctx.events.engagementId,
            hosts: ctx.hosts,
            verifiedAt: ctx.verifiedAt,
            verificationProof: ctx.verificationProof,
        });
    }
    return session.state.scope;
}
//# sourceMappingURL=lifecycle-session.js.map