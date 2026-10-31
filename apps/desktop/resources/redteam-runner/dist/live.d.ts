/**
 * Live engagement registry (v0.30.0).
 *
 * A Ctx is built exactly once, inside runEngagement, and until now nothing
 * outside that call could reach one. That made the runner's 26 executor tools
 * (nuclei_exec, msf_exec, http_probe, ssh_exec, ad_enum, …) unreachable from
 * the console or the MCP bridge: they need a context, and no context existed
 * outside the run loop.
 *
 * This registry publishes the ctx of each RUNNING engagement so an operator can
 * invoke those tools on demand. It adds reach, not authority — every call goes
 * through dispatchTool, so the kill switch, the tier ladder, auto-halt, the
 * per-host rate limiter and the variant cap all still run first.
 *
 * The operator is given exactly the tool access the engagement's own agent
 * would have AT THE CURRENT PHASE. There is no role parameter to pass, because
 * a parameter would be a way to ask for privileges the phase does not grant.
 */
import type { Ctx } from "./context.js";
import type { ActorRole } from "./types.js";
import type { EngagementPhase } from "./types.js";
/** Publish a running engagement's context. Called by runEngagement. */
export declare function registerLive(id: string, ctx: Ctx): void;
/** Withdraw it. Safe to call for an id that was never registered. */
export declare function unregisterLive(id: string): void;
/** The live context for an engagement, or undefined if it is not running here. */
export declare function getLive(id: string): Ctx | undefined;
/**
 * The role an operator's call runs as, derived from the phase.
 *
 * Deliberately a mapping and not a parameter: the tools available are the tools
 * the phase's own agent has, so an operator cannot reach the exploit toolset
 * from recon by naming a role. Phases with no specialist (authorize, plan,
 * report, done) get the coordinator, which holds the bookkeeping and read tools.
 */
export declare function roleForPhase(phase: EngagementPhase): ActorRole;
export interface LiveSummary {
    engagementId: string;
    phase: EngagementPhase;
    tier: number;
    environment: string;
    hosts: string[];
    role: ActorRole;
    startedAt: string;
    actions: number;
}
/** Live engagements, for a tool listing or a "what is running" answer. */
export declare function listLive(): LiveSummary[];
export interface LiveCallResult {
    result: string;
    target?: string;
    attackId?: string;
    opsec?: string;
}
/**
 * Dispatch one tool call into a running engagement.
 *
 * Throws when the engagement is not live here — an operator gets "not running"
 * rather than a silently tool-less run, because the two look identical from the
 * outside otherwise.
 */
export declare function dispatchLiveTool(engagementId: string, name: string, args: Record<string, unknown>): Promise<LiveCallResult>;
