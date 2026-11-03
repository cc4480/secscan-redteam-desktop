/**
 * Deterministic proposal extractors (brief §7.2). Free-form model text
 * is never an extractor: a model's words reach memory only as records
 * the runner already adjudicated (registry verdicts, cell outcomes) or
 * as `target-derived-claim` intake. Every projector emits DRAFTS —
 * validation, trust derivation, and sealing happen in commit.ts /
 * store.ts, and an extractor never proposes a tier.
 */
import type { UnitDraft } from './store.js';
import type { MemoryScope } from './types.js';
import type { LiveFinding } from '../context.js';
import type { RegistryEntry } from '../registry.js';
export { projectExperience, projectTrajectory } from './extract-projections.js';
export type { ExperienceProjectionInput, TrajectoryProjectionInput } from './extract-projections.js';
/** One extractor output: a draft unit plus the lane it belongs in. */
export interface MemoryProposal {
    /** "auto" = mechanical projection of a proof-bearing record; "proposed" = awaits a named operator (§7.3). */
    lane: 'auto' | 'proposed';
    /** The producing projector's name (the diff's per-projector skip accounting, §8 row 12). */
    projector: string;
    draft: UnitDraft;
}
export declare const EXTRACTOR_VERSIONS: Record<string, string>;
export declare function extractor(name: string, input: unknown): {
    name: string;
    version: string;
    inputHash: string;
};
export interface RegistryProjectionInput {
    engagementId: string;
    /** The engagement's derived scope (its originEngagementIds seed each unit's). */
    scope: MemoryScope;
    /** This engagement's registry entries only (caller filters by engagementId). */
    entries: readonly RegistryEntry[];
    /** Live findings from the same run, for the adjudicated cellState copy. */
    liveFindings?: readonly LiveFinding[];
    nowIso: string;
}
/**
 * Project every registry entry of the engagement to a `finding` /
 * `killed-hypothesis` unit. Content is a direct, field-for-field
 * projection of a proof-bearing record — no semantic transformation —
 * so these ride the auto-apply lane (§7.2). `cellState` is copied from
 * the matching live finding's adjudication, never asserted here.
 *
 * @param input - The engagement's entries and scope.
 * @returns One auto-lane proposal per entry.
 */
export declare function projectRegistryEntries(input: RegistryProjectionInput): MemoryProposal[];
export interface TargetDerivedClaimInput {
    /** What the target asserted (page text, response string, banner, doc). */
    text: string;
    /** The in-scope host the content came from. */
    host: string;
    /** Where the content was captured (engagement-relative ref). */
    sourceUri: string;
    engagementId: string;
    nowIso: string;
}
/**
 * Intake one target-asserted claim. The ONLY shape target content may
 * enter memory in: `target-derived-claim`, engagement-target scope,
 * `target-derived-untrusted` content class, unproven — it keeps the
 * §4.3 hard cap until independent corroboration exists. The claim is
 * the normalized text capped at the §4.1 budget; the body carries the
 * fuller capture.
 *
 * @param input - The captured claim and its origin.
 * @returns One proposed-lane, untrusted proposal.
 */
export declare function intakeTargetDerivedClaim(input: TargetDerivedClaimInput): MemoryProposal;
