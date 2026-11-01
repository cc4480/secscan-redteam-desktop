/**
 * The agent driver (v0.19.0 refactor — extracted from phases.ts).
 *
 * agentLoop is the thin REASON → ACT → OBSERVE loop over the model router:
 * promptCtx builds each role's context, extractJsonBlock parses structured
 * model output, and commanderRedirect / blackout / halt plumbing keeps the
 * loop bounded and safe. HaltError is the loop's stop signal.
 */
import { type AgentRole, type JsonSchemaTool, type ResponseFormat } from '@secscan/redteam-llm-router';
import { type DeliverableSpec, type RoundCaps } from './turn-integrity.js';
import { type PromptContext } from './prompts.js';
import { type EngagementPhase } from './types.js';
import { type Ctx } from './context.js';
export type { DeliverableSpec, RoundCaps } from './turn-integrity.js';
/** Default tool-call repair budget per agentLoop invocation (RC Item 6). */
export declare const DEFAULT_REPAIR_CAP = 3;
export declare function agentLoop(ctx: Ctx, role: AgentRole, phase: EngagementPhase, system: string, user: string, tools: JsonSchemaTool[], maxTurns: number, opts?: {
    /** Called when the model stops calling tools. Return a follow-up prompt to
     *  keep the phase going, or null to finish the phase. */
    onIdle?: () => string | null;
    /**
     * Progress-aware round caps (ZimZilla port, 2026-10-23). Per-call
     * override of config.softRoundCap / config.hardRoundCap.
     */
    roundCaps?: RoundCaps;
    /**
     * Bounded-reflection cap override (reflector.ts, RC Item 7). Wins
     * over config.reflectorCap when set; 0 disables reflection.
     */
    reflectorCap?: number;
    /**
     * Structured-output constraint for the loop's own completion calls
     * (Q-STRUCT A3): forwarded to every turn's completion; the chartered
     * seam and the router's capability record decide how each provider
     * honors it. The reflector's verdict call is deliberately NOT
     * constrained (brief §7 — its steering text stays prose). Absent =
     * unconstrained, exactly as before.
     */
    responseFormat?: ResponseFormat;
    /**
     * Tool-call repair cap (RC Item 6): the most repair exchanges this
     * loop invocation may spend on `repairable`-tagged dispatch results.
     * Default 3; 0 disables repair. Loop option only — no config field.
     */
    repairCap?: number;
    /** When declared, the turn is not finished until this file exists. */
    deliverable?: DeliverableSpec;
}): Promise<string>;
export declare function promptCtx(ctx: Ctx): PromptContext;
export declare function commanderRedirect(ctx: Ctx, reason: string): Promise<string>;
