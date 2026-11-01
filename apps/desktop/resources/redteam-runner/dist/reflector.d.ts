/**
 * Reflector: a bounded reflection step for agentLoop (runner corrections
 * Item 7, 2026-10-31). Written in turn-integrity.ts's style: a small
 * stateful class, no I/O beyond the injected model call.
 *
 * After a tool batch settles, a stuck batch may spend one REFLECTION — a
 * tool-less model call through the same completion seam the loop already
 * uses — which answers a structured verdict (continue / change_approach /
 * escalate) whose steering text is injected as the next user message. It
 * is not a new agent and not a roster member: it is the performer pausing
 * to think, with a hard budget.
 *
 * Cap semantics: the count lives on the instance, one per agentLoop
 * invocation (loop-local, like TurnIntegrity) — the cap is per phase run,
 * not per engagement. Exhausting the cap stops further reflection and
 * NEVER halts the engagement; it is announced exactly once
 * (`reflector_exhausted`), and every spent reflection is itself an event
 * (`reflector`, with trigger, verdict, count) — model-visible ⟺ logged.
 */
import type { Ctx } from './context.js';
import type { EngagementPhase } from './types.js';
/** Directive default: at most 3 reflections per agentLoop invocation. */
export declare const DEFAULT_REFLECTOR_CAP = 3;
/**
 * A denied streak at or past this is a wall — the same threshold
 * agentLoop's redirect block uses. A batch ending in a wall is a stuck
 * batch even if an earlier call in it succeeded.
 */
export declare const REFLECTOR_WALL_STREAK = 4;
/** What one settled tool batch did, as the loop's bookkeeping saw it. */
export interface BatchOutcome {
    /** Tool calls that settled in the batch. */
    calls: number;
    /** Results that advanced the work (not blocked, not ok === false). */
    successes: number;
    /** Results refused, blocked, cooled down, or OPSEC-signaled. */
    denied: number;
    /** The engagement's consecutive-denied streak after the batch. */
    deniedStreak: number;
}
export type ReflectionTrigger = 'zero_progress' | 'denied_streak';
/** One spent reflection: what fired it, what the model answered. */
export interface Reflection {
    trigger: ReflectionTrigger;
    /** continue | change_approach | escalate | unparsed | error */
    verdict: string;
    /** The steering text injected as the next user message. */
    steering: string;
    /** Reflections spent so far, including this one. */
    count: number;
    /** The cap this loop is running under. */
    cap: number;
}
/** The injected model call: prompt in, raw model text out. */
export type ReflectionAsk = (prompt: string) => Promise<string>;
/**
 * Whether a settled batch is stuck, and why. A batch that made progress
 * below the wall threshold is not stuck; a batch with no calls at all
 * never reaches the reflector.
 */
export declare function reflectionTrigger(outcome: BatchOutcome): ReflectionTrigger | null;
/** Fresh assembly naming the stuck state; the model answers JSON only. */
export declare function buildReflectionPrompt(role: string, phase: EngagementPhase, outcome: BatchOutcome, trigger: ReflectionTrigger): string;
/**
 * Read the model's answer. A JSON object with a steering string keeps its
 * verdict; anything else is carried verbatim as steering with verdict
 * "unparsed" — the reflection still counts, and the transcript shows what
 * the model actually said.
 */
export declare function parseReflection(raw: string): {
    verdict: string;
    steering: string;
};
export declare class Reflector {
    private readonly ctx;
    private readonly phase;
    private spent;
    private exhaustedAnnounced;
    /** The cap in force; a fixture that never resolved config gets the default. */
    readonly cap: number;
    constructor(ctx: Ctx, phase: EngagementPhase, cap: number | undefined);
    /** Reflections spent so far in this loop invocation. */
    get reflectionsSpent(): number;
    /**
     * Spend one reflection on a stuck batch, or return null when the batch
     * is not stuck, reflection is disabled (cap 0), or the cap is spent.
     * A failed model call is spent and logged (verdict "error") but returns
     * null: reflection is advisory and must never halt the engagement, and
     * the mechanical redirect stays available for the same batch.
     */
    maybeReflect(role: string, outcome: BatchOutcome, ask: ReflectionAsk): Promise<Reflection | null>;
}
