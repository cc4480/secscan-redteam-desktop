/**
 * Autonomy tiers (v0.17.0) — graduated, MECHANICALLY enforced agent autonomy.
 *
 * Buyers demand OWASP-style autonomy tiers per environment: agents own
 * frequency/retest, humans own critical assets and accountability. These
 * tiers are enforced in the tool dispatcher (phases.ts), never by prompt:
 *
 *  - Tier 0 (observe): read-only recon/enumeration only. No exploitation
 *    tool fires — the dispatcher refuses them before any packet.
 *  - Tier 1 (validate): Tier 0 + single-step validated exploitation with
 *    canary markers only. One validated exploit step per target per
 *    engagement; a second step against the same target is refused as
 *    chaining — it needs Tier 2 (operator-approved).
 *  - Tier 2 (chain): Tier 1 + multi-step attack chains toward critical
 *    assets (msf_exec run), still non-destructive, still no-DoS.
 *
 * Tiers describe what the agents MAY do. They are a control boundary, never
 * a safety guarantee, and never imply the human did the work — the
 * methodology doc states the agent-driven approach truthfully; the
 * accountability record adds who supervised and approved.
 */
export type AutonomyTier = 0 | 1 | 2;
export declare const TIER_NAMES: Record<AutonomyTier, string>;
export declare const TIER_DESCRIPTIONS: Record<AutonomyTier, string>;
/** Default tier per environment: staging runs the full battery, production validates carefully. */
export declare function defaultTier(environment: "staging" | "production"): AutonomyTier;
export declare const TIER_ENV = "REDTEAM_TIER";
export declare const TIER2_PROD_CONFIRM_ENV = "REDTEAM_TIER2_PROD_CONFIRM";
/**
 * Parse a tier from CLI/env. undefined/empty → undefined (caller applies the
 * environment default). Anything else unrecognized fails LOUD — refusing to
 * guess about autonomy.
 */
export declare function parseTier(raw: string | undefined): AutonomyTier | undefined;
/** True when the operator explicitly approved Tier 2 on production. */
export declare function tier2ProductionConfirmed(env?: NodeJS.ProcessEnv): boolean;
/**
 * Mechanical gate for Tier 2 on production. Tier 2 chains toward critical
 * assets — on production that needs an explicit operator decision, exactly
 * like the staging→production graduation itself. Fail fast, before the
 * engagement directory is even created.
 */
export declare function requireTier2ProductionApproval(tier: AutonomyTier, environment: "staging" | "production", confirmed: boolean): void;
/**
 * Minimum tier for a tool call. Three tools are argument-sensitive:
 *  - secscan_exec: depth=passive is Tier 0; depth=deep runs the embedded
 *    engine's verification-gated active web app tests → Tier 1 (the ladder
 *    the retired scan_url wrapper used; the verification-record refusal
 *    itself lives in the dispatch handler, which can name what is missing).
 *  - msf_exec: search/suggest never fire → Tier 1; run fires exploits and
 *    the session actions (session_command / credential_dump /
 *    session_close) act through a live session on the target → Tier 2.
 *  - nuclei_exec: templates never fires (local template listing) → Tier 1;
 *    run executes templates against the target → Tier 2.
 *  - nmap_exec: profiles touches no target (it runs `nmap --version`) → Tier 0;
 *    scan fires packets, and the tier is the SELECTED PROFILE's own minTier.
 *    All six profiles share one tool name, so without this a 65535-port sweep
 *    would be as reachable at Tier 0 as a top-100 sweep. The same gate is
 *    enforced again in the nmap dispatch handler, which is where the refusal
 *    can name the tier that would allow it.
 *  - net_exec: caps touches no target → Tier 0; socket/packet/flood actions
 *    fire raw traffic → Tier 2 (see the branch below).
 */
export declare function toolMinTier(toolName: string, args?: Record<string, unknown>): AutonomyTier;
export declare function isExploitStepTool(toolName: string, args?: Record<string, unknown>): boolean;
/** Tier 1 chain budget: validated exploit steps allowed per target per engagement. */
export declare const TIER1_CHAIN_BUDGET_PER_TARGET = 1;
export interface TierState {
    /** The tier currently in force (may rise via recorded escalation). */
    current: AutonomyTier;
    /** The tier declared at engagement start. */
    declared: AutonomyTier;
    /** Target → validated exploit steps used (Tier 1 chain budget). */
    chainSteps: Map<string, number>;
}
/**
 * Pure tier check, called by the dispatcher before any packet. Returns the
 * denial text, or undefined when the call is allowed. Chain-budget denials
 * name the re-approval path (Tier 2, operator-approved) — never silent.
 */
export declare function checkTierAllows(state: TierState, toolName: string, args: Record<string, unknown>, host?: string): string | undefined;
/** Record a successful validated exploit step against the chain budget. */
export declare function recordExploitStep(state: TierState, toolName: string, args: Record<string, unknown>, host: string): void;
export declare function describeTier(tier: AutonomyTier): string;
