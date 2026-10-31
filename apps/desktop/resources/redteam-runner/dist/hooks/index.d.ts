/**
 * Tool lifecycle hooks (v0.34.0) — PreToolUse / PostToolUse.
 *
 * The dispatcher already enforces mechanical controls (ROE, tier, variant cap,
 * rate limit). Hooks are the extension point for everything engagement-specific:
 * a client rule, a redaction step, a "never run this on that host" guard — added
 * without touching the safety core.
 *
 * Contracts, ported from AlterEgo's verified implementation:
 *   - PreToolUse returns allow | deny(reason) | modify(args). Any deny stops the
 *     call; a modify feeds the new args to later hooks and to the handler.
 *   - PostToolUse may replace the result (e.g. scrub it) or leave it.
 *   - Every hook has a timeout. A pre-hook timeout DENIES (fail closed); a
 *     post-hook timeout keeps the original result and is logged.
 *   - Each evaluation is returned to the caller so the dispatcher can append one
 *     audit event per hook — never a silent decision.
 *
 * Pure aside from the injected callables and timers; unit-tested directly.
 */
export type HookPhase = "pre" | "post";
export interface HookContext {
    tool: string;
    args: Record<string, unknown>;
    target?: string;
}
export type PreDecision = {
    decision: "allow";
    reason?: string;
} | {
    decision: "deny";
    reason: string;
} | {
    decision: "modify";
    args: Record<string, unknown>;
    reason?: string;
};
export type PreHookFn = (ctx: HookContext) => PreDecision | void | Promise<PreDecision | void>;
export type PostOutcome = {
    result: string;
} | void;
export type PostHookFn = (ctx: HookContext, result: string) => PostOutcome | Promise<PostOutcome>;
export interface HookEvaluation {
    name: string;
    phase: HookPhase;
    decision: "allow" | "deny" | "modify" | "keep" | "replace";
    latencyMs: number;
    timedOut: boolean;
    reason?: string;
}
export interface PreRunOutcome {
    allowed: boolean;
    args: Record<string, unknown>;
    reason?: string;
    evaluations: HookEvaluation[];
}
export interface PostRunOutcome {
    result: string;
    evaluations: HookEvaluation[];
}
export declare class HookRegistry {
    private pre;
    private post;
    registerPre(name: string, pattern: string, fn: PreHookFn, timeoutMs?: number): void;
    registerPost(name: string, pattern: string, fn: PostHookFn, timeoutMs?: number): void;
    /** Number of registered hooks — used by readiness/doctor output. */
    get size(): number;
    /** Run pre-hooks in registration order. Deny wins; modify updates args for later hooks. */
    runPre(tool: string, args: Record<string, unknown>, target?: string): Promise<PreRunOutcome>;
    /** Run post-hooks; the last replacement wins. Timeouts keep the current result. */
    runPost(tool: string, args: Record<string, unknown>, result: string, target?: string): Promise<PostRunOutcome>;
}
