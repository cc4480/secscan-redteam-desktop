/**
 * Charter completion — the live wiring of the fleet charter (spec §2/§3)
 * into the agent loop.
 *
 * agentLoop drives every fleet agent through one completion seam. When
 * the caller does not inject a completion (production), this module's
 * factory supplies it, and every call is a chartered call:
 *
 *   - The charter is assembled at the head of EVERY call's messages:
 *     charter first, the phase persona after it, per spec §2. The
 *     assembled head replaces the call's initial messages in place, so
 *     it persists across the loop's turns without re-assembly — and
 *     side calls that build fresh message arrays (reflector verdicts,
 *     tool-call repair) are chartered too, idempotently: an array is
 *     never spliced twice.
 *   - The seat's route is charter routing as data (resolveCharterRoute),
 *     not the bare role policy.
 *   - At each phase's first chartered loop, the agent's phase anchor is
 *     elicited (the four marker questions, answered from the engagement
 *     record) and carried into the assembly (SCAN re-anchoring, spec
 *     §2). A phase whose elicitation fails proceeds without an anchor
 *     and the absence is recorded in the audit trail — the spec's flag,
 *     never a silent skip and never a blocked engagement.
 *   - Every response is classified. An explicit refusal with no tool
 *     calls runs the spec §3 fallback chain (fresh contexts, refusal
 *     hygiene: the refused text is never written into the loop's
 *     messages, notes, or events). Telemetry lands in the engagement
 *     audit trail. When every hop refuses, the turn returns an empty
 *     result and the loop's own idle/deliverable machinery decides what
 *     happens next — the refusal itself never becomes context.
 *   - A THROWN content-policy rejection is contained at this call, not
 *     allowed to kill the turn: the failure is logged with its full
 *     provider cause, the call is re-issued once with the verified
 *     engagement record attached and the step context condensed to a
 *     structured summary, and if the re-issue is rejected too the call
 *     routes into the same §3 fallback chain. Non-policy errors keep
 *     their historical behavior and propagate to the caller.
 *
 * Known limitation (spec §4): no per-engagement pseudonym map is built
 * yet, so assembly runs without pseudonymization; the runner's existing
 * PII redaction on tool outputs and evidence still applies.
 */
import { type AgentRole, type CharterEngagement, type CharterRole, type ChatMessage, type ChatResult, type FallbackCallImpl, type JsonSchemaTool, type ResponseFormat, type RoleRoute } from '@secscan/redteam-llm-router';
import { type Ctx } from './context.js';
import { type EngagementPhase } from './types.js';
export { condensedReissueMessages } from './policy-containment.js';
/**
 * The charter engagement record for one run, filled from what the runner
 * actually holds. Every field is required by the charter loader, so each
 * fallback states plainly what the record does and does not contain —
 * nothing is invented (an attestation is labeled an attestation).
 *
 * @param ctx - the engagement context
 * @returns the charter engagement record for this run
 */
export declare function charterEngagementFor(ctx: Ctx): CharterEngagement;
/** The per-call options a completion receives (completeForRole's shape). */
export interface CharteredCallOptions {
    tools?: JsonSchemaTool[];
    signal?: AbortSignal;
    maxTokens?: number;
    temperature?: number;
    /** Structured-output constraint for this call (Q-STRUCT A1 seam).
     * Absent = unconstrained, exactly the historical behavior. */
    responseFormat?: ResponseFormat;
}
/** Injectable provider seam for tests; production uses the router registry. */
export interface CharteredCallSeams {
    /** Raw provider call for one resolved route. */
    call?: (route: RoleRoute, messages: ChatMessage[], opts: CharteredCallOptions) => Promise<ChatResult>;
    /** Fallback-chain call implementation (defaults to the chain's own). */
    fallbackCall?: FallbackCallImpl;
    /** Chartered single-shot call, used for anchor elicitation. */
    elicitationCall?: (engagement: CharterEngagement, role: CharterRole, messages: ChatMessage[]) => Promise<ChatResult>;
}
type CompleteForRole = (role: AgentRole, messages: ChatMessage[], opts?: CharteredCallOptions) => Promise<ChatResult>;
/**
 * Build the production completion for one agentLoop invocation: a
 * drop-in for the router's completeForRole that charters the call.
 *
 * @param ctx - the engagement context (engagement record, audit trail)
 * @param phase - the phase this loop serves (anchor + telemetry keying)
 * @param seams - test seams; production passes none
 * @returns a completion with completeForRole's signature
 */
export declare function createCharteredComplete(ctx: Ctx, phase: EngagementPhase, seams?: CharteredCallSeams): CompleteForRole;
