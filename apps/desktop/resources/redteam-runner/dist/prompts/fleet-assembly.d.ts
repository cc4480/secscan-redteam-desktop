/**
 * Fleet prompt assembly (Phase 2 W3): every live seat's system prompt is
 * assembled by @secscan/redteam-fleet-skills, in the prompt pack's fixed
 * order —
 *
 *   master → soul → verified-engagement injection → knobs → seat delta →
 *   Layer-1 skills index → Layer-2 skill bodies for the seat's phase
 *
 * The seat delta is the runner's EXISTING role prompt (coordinator.ts,
 * recon.ts, exploiter.ts, reporter.ts): nothing in those prompts is
 * deleted, the fleet layers wrap them. The package's own seat assets
 * (prompts/seats/*.md in the fleet package) are deliberately NOT also
 * spliced in — the runner prompts are their supersets (persona, doctrine,
 * ROE, batteries), and stacking both would double every persona block.
 *
 * The engagement record comes from the AUTHORIZE phase's stamped output
 * on the engagement context (see {@link verifiedRecordFor}): the fleet
 * prompt is built from the record that was actually attested, never from
 * the launch request alone. A context without that record renders the
 * historical seat text unchanged — that is the engagement-independent
 * path (the agent-docs canonical context, unit fixtures). Production is
 * gated in runEngagement, which requires the record immediately after a
 * successful authorize and fails loud without it, so a live engagement
 * never reaches a prompt without its attested record.
 */
import { type VerifiedEngagementRecord } from '@secscan/redteam-fleet-skills';
import type { Ctx } from '../context.js';
import type { PromptContext } from './shared.js';
/** The fleet seats this module assembles prompts for. */
export type FleetSeatRole = 'coordinator' | 'recon' | 'exploiter' | 'reporter' | 'coder';
/** The knob sources and record a production prompt context carries. */
export interface FleetPromptInput {
    /** The verified engagement record (see {@link verifiedRecordFor}). */
    record: VerifiedEngagementRecord;
    /** Fleet-wide CHARTER knob text (Prompt Pack §4), when a source exists. */
    charterKnobs?: string;
    /** Per-engagement ENGAGEMENT knob text; wins over the charter text. */
    engagementKnobs?: string;
}
/**
 * Resolve the fleet-skills package root. Candidates cover, in order: the
 * REDTEAM_FLEET_SKILLS_ROOT override, the installed workspace package
 * (node_modules, either side of the apps/ tree), the source-tree sibling
 * (src/prompts, dist/prompts, and dist-test/src/prompts all sit at a
 * depth one of the two traversals below matches), and vendored layouts
 * (the package copied beside the runner root or beside this module, as
 * the desktop vendor step places payload assets).
 *
 * @returns the first candidate directory holding prompts/master.md
 * @throws Error listing the searched candidates when none holds the assets
 */
export declare function fleetPackageRoot(): string;
/**
 * Build the fleet package's verified engagement record from the AUTHORIZE
 * phase's stamped output on the engagement context. Field mapping:
 *
 *   engagementId / recordId ← Ctx.events.engagementId (run.ts mints it)
 *   operator  ← EngagementInput.operatorName ?? client (types.ts)
 *   owner     ← EngagementInput.client ?? operatorName ?? Ctx.domain
 *   proofMethod ← Ctx.verificationProof (context.ts; authorize.ts stamps
 *                 the attestation / service verdict / test-mode text)
 *   verifiedAt  ← Ctx.verifiedAt (context.ts; authorize.ts stamps it
 *                 beside the proof on every success path)
 *   targets   ← Ctx.hosts (the scope hosts authorize checked), falling
 *               back to Ctx.verifiedScope (authorize's attested raw scope
 *               entries), then the input target
 *   outOfScope ← RulesOfEngagement.outOfScope (deny beats allow)
 *   accessLevel ← 'verified-domain' (authorize is the precondition)
 *   roe       ← {@link roeSummary} over the input ROE + mode + objective
 *   sessionsAllowed ← true here; the SESSIONS knob narrows it at assembly
 *
 * @param ctx - the engagement context, after authorize has run
 * @returns the verified engagement record for prompt assembly
 * @throws Error when authorize has not stamped proof data — a production
 *   fleet prompt is never assembled from an unattested record
 */
export declare function verifiedRecordFor(ctx: Ctx): VerifiedEngagementRecord;
/**
 * Assemble one seat's complete system prompt through the fleet package,
 * in the pack order (see the module header). Contexts that carry no
 * fleet input — the agent-docs canonical context and unit fixtures —
 * return the seat text unchanged, byte for byte.
 *
 * The SESSIONS knob narrows the record's session rule at assembly: with
 * SESSIONS=off in the charter/engagement knob sources, the injection
 * renders the no-sessions rule instead of the W8 session rule.
 *
 * @param role - the fleet seat the prompt is for
 * @param seatText - the runner's existing role prompt (the seat delta)
 * @param ctx - the prompt context; carries the fleet input in production
 * @returns the assembled system prompt, or `seatText` unchanged when the
 *   context carries no fleet input
 * @throws Error when a mapped soul or skill body is missing from the
 *   fleet package (a broken package must fail loud, not prompt silently)
 */
export declare function buildFleetPrompt(role: FleetSeatRole, seatText: string, ctx: PromptContext): string;
