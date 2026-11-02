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
 *   - Every response is classified, with the real artifact flag for
 *     artifact-producing phases (report/scribe — M6), so a soft
 *     refusal (cooperative prose, no artifact) runs the §3 chain too.
 *     An explicit refusal with no tool
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
    /**
     * M6: true when this call must produce an artifact (soft-refusal
     * detection applies in classifyResponse). Absent = derived from the
     * completion's phase via {@link isArtifactPhase} — artifact-producing
     * phases (report/scribe) are artifact tasks, all other phases are
     * not. An explicit value wins over the phase default, so a side call
     * inside an artifact phase (reflection, repair) can opt out.
     */
    artifactTask?: boolean;
    /**
     * M6: caller-supplied artifact check for an artifact task — true when
     * the response text IS the artifact in the required format. Absent =
     * {@link artifactCheckForPhase} for artifact phases; without any
     * check, classifyResponse still catches prose-substitute soft
     * refusals on artifact tasks.
     */
    artifactCheck?: (text: string) => boolean;
}
/**
 * M6: the phases whose chartered calls must produce an artifact — the
 * report phase (the report document, the Scribe's authored HTML, the
 * scribe/peer-review verdict JSON). Every createCharteredComplete
 * caller that serves the report phase passes 'report' (report/phase.ts
 * via agentLoop, report/scribe.ts, report/scribe-html.ts,
 * phases/peer-review.ts), so the flag originates here, from the phase
 * the factory was built for, not from a per-call guess.
 *
 * @param phase - the phase a chartered completion serves
 * @returns true when that phase's calls are artifact-producing tasks
 */
export declare function isArtifactPhase(phase: EngagementPhase): boolean;
/**
 * M6: the default artifact check for an artifact phase's response: the
 * text carries a complete HTML document (Scribe-authored report.html),
 * a parseable JSON object (a whole-text verdict, or a fenced ```json
 * block — the report's findings block), or a markdown report heading.
 * Cooperative prose with none of these is not the artifact.
 *
 * @param text - the response text to check
 * @returns true when the text carries an artifact in a required format
 */
export declare function reportArtifactCheck(text: string): boolean;
/**
 * M6: the phase-derived artifact check paired with {@link isArtifactPhase}.
 *
 * @param phase - the phase a chartered completion serves
 * @returns the artifact check for artifact phases, or undefined
 */
export declare function artifactCheckForPhase(phase: EngagementPhase): ((text: string) => boolean) | undefined;
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
