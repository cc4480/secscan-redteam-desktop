/**
 * Policy containment — the recovery paths for a chartered call whose
 * provider refuses it, extracted from charter-completion.ts.
 *
 * Two refusal shapes land here:
 *
 *   - The spec §3 fallback chain (createFallbackRunner): a call whose
 *     response is classified as a refusal — or whose thrown-policy
 *     containment also failed — is re-run through fresh contexts with
 *     refusal hygiene (the refused text never becomes context), and
 *     every hop's telemetry lands in the engagement audit trail.
 *   - Thrown-policy containment (callWithPolicyContainment): a provider
 *     that THROWS its content-policy rejection instead of returning
 *     refusal prose is contained at the call — logged with its full
 *     provider cause, re-issued once with the verified engagement
 *     record attached and the step context condensed to a structured
 *     summary (condensedReissueMessages), and routed into the §3 chain
 *     when the re-issue is rejected too. Non-policy errors propagate.
 */
import { type AgentRole, type CharterEngagement, type CharterRole, type ChatMessage, type ChatResult, type FallbackCallImpl, type RoleRoute } from '@secscan/redteam-llm-router';
import { type CharteredCallOptions } from './charter-completion.js';
import { type Ctx } from './context.js';
import { type EngagementPhase } from './types.js';
/**
 * Build the condensed re-issue for a call the provider content-policy
 * rejected: the chartered system head, then ONE user message carrying
 * the verified engagement record and a structured summary of the step
 * (first instruction + latest context, both truncated) in place of the
 * full prior context — the raw batch dump is what was rejected, and
 * resending it unchanged would be rejected again. The record block is
 * rendered locally in the fleet §2 shape from the charter engagement
 * fields: the runner does not yet depend on the fleet-skills package,
 * so its buildEngagementInjection cannot be imported here.
 *
 * @param messages - the rejected call's (chartered) messages
 * @param engagement - the charter engagement record for this run
 * @returns the condensed message list for the single re-issue
 */
export declare function condensedReissueMessages(messages: ChatMessage[], engagement: CharterEngagement): ChatMessage[];
/** The call context {@link createFallbackRunner} feeds the §3 chain from. */
export interface FallbackRunnerDeps {
    /** The engagement context (audit trail). */
    ctx: Ctx;
    /** The phase the refused call serves (telemetry keying). */
    phase: EngagementPhase;
    /** The agent role the refused call serves. */
    role: AgentRole;
    /** The charter seat the agent role sits in. */
    charterRole: CharterRole;
    /** The charter engagement record for this run. */
    engagement: CharterEngagement;
    /** The refused call's (chartered) messages. */
    messages: ChatMessage[];
    /** The refused call's resolved route (provider/model for the empty result). */
    resolvedRoute: RoleRoute;
    /** Fallback-chain call implementation seam; the chain supplies its own when absent. */
    fallbackCall?: FallbackCallImpl;
    /** Elicit (or fetch the cached) phase anchor for this call. */
    elicitAnchor: () => Promise<string | undefined>;
}
/**
 * The spec §3 fallback chain for one call, fed from the call's own
 * messages. Shared by the prose-refusal gate and the thrown-policy
 * containment: both end here rather than dying.
 *
 * @param deps - the refused call's context (see {@link FallbackRunnerDeps})
 * @returns a runner that resolves to the recovered result, or the empty turn-end result
 */
export declare function createFallbackRunner(deps: FallbackRunnerDeps): () => Promise<ChatResult>;
/** The call context {@link callWithPolicyContainment} contains a rejection for. */
export interface PolicyContainmentDeps {
    /** The provider call seam for the resolved route. */
    call: (route: RoleRoute, messages: ChatMessage[], opts: CharteredCallOptions) => Promise<ChatResult>;
    /** The call's resolved route. */
    route: RoleRoute;
    /** The call's (chartered) messages. */
    messages: ChatMessage[];
    /** The per-call options the completion received. */
    opts: CharteredCallOptions;
    /** The charter engagement record for this run. */
    engagement: CharterEngagement;
    /** The engagement context (audit trail). */
    ctx: Ctx;
    /** The phase the call serves (telemetry keying). */
    phase: EngagementPhase;
    /** The agent role the call serves. */
    role: AgentRole;
    /** The §3 fallback chain for this call, entered when containment also fails. */
    runFallback: () => Promise<ChatResult>;
}
/**
 * How a contained call ended: `result` carries a provider result the
 * caller continues with (the refusal gate still applies); `fallback`
 * carries the §3 chain's result, which the caller returns as-is.
 */
export type PolicyContainmentOutcome = {
    kind: 'result';
    result: ChatResult;
} | {
    kind: 'fallback';
    result: ChatResult;
};
/**
 * Run one chartered call under thrown-policy containment: a provider
 * that throws its safety rejection (instead of returning refusal
 * prose) is contained at this call — logged with its full provider
 * cause, re-issued once condensed with the engagement record attached,
 * and routed into the §3 fallback chain when the re-issue is rejected
 * too. Non-policy errors keep their historical behavior and propagate.
 *
 * @param deps - the call's context (see {@link PolicyContainmentDeps})
 * @returns the contained outcome (see {@link PolicyContainmentOutcome})
 */
export declare function callWithPolicyContainment(deps: PolicyContainmentDeps): Promise<PolicyContainmentOutcome>;
