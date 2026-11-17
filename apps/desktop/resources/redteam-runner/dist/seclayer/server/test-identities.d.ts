/**
 * Authoritative manifest of distinct native Seclayer test identities.
 *
 * "Test identity" here means a distinct probe/check class executed by one of the
 * 6 native Seclayer tools (`seclayer_redteam`, `seclayer_bola`, `seclayer_api`,
 * `seclayer_webhook`, `seclayer_dast`, `seclayer_aggressive`) — not the A/B auth
 * identities used for BOLA (`BolaIdentity`).
 *
 * Counting rules (evidence-based, reconciled against Blueprint Item 10):
 * - Count each distinct probe/check implementation that a tool executes as one
 *   identity, even if conditionally not-run for a target (e.g. blind/OOB probes
 *   on remote targets are still suite identities; dispatch reports them not-run).
 * - Count `seclayer_dast` `llm` fan-out as three distinct executed subprobes:
 *   prompt injection, memory poisoning, and insecure tool use.
 * - Count the two-identity BOLA/IDOR probe once even though it is invocable via
 *   both `seclayer_bola` and `seclayer_api` (same probe identity/implementation).
 * - Exclude utility capture analyzers not executed by the 6 tools (e.g.
 *   `exposedUserListInCapture` / `exposedCredentialListInCapture` in
 *   `apiProbes.ts` are exported but not invoked by tool dispatch paths).
 *
 * Blueprint Item 10 states "36 distinct test identities"; the enumerated native
 * runner suite identities provided by these 6 tools total 29. This manifest is the
 * source of truth for the implemented suite and should be updated if probes are
 * added/removed/rewired.
 */
export type SeclayerToolName = "seclayer_redteam" | "seclayer_bola" | "seclayer_api" | "seclayer_webhook" | "seclayer_dast" | "seclayer_aggressive";
export interface SeclayerTestIdentity {
    /** Stable identity id for this probe/check within the native Seclayer suite. */
    id: string;
    /** Human-readable test/probe name. */
    name: string;
    /** Seclayer tool(s) that execute this identity. */
    tools: readonly SeclayerToolName[];
    /** Suite/family grouping. */
    family: "redteam" | "bola" | "api" | "webhook" | "dast" | "aggressive";
    /** Primary implementation module/symbol (evidence anchor). */
    probe: string;
    /** Optional clarifying note (subprobe, conditional availability, etc.). */
    note?: string;
}
export declare const SECLAYER_TEST_IDENTITIES: readonly SeclayerTestIdentity[];
export declare const SECLAYER_TEST_IDENTITY_COUNT: number;
/** Count stated by Blueprint Item 10; see module note for reconciliation. */
export declare const SECLAYER_BLUEPRINT_IDENTITY_COUNT = 36;
export declare function getSeclayerTestIdentities(): readonly SeclayerTestIdentity[];
