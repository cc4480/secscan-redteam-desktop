/**
 * The collapse port (brief §6) — the Hermes collapse mechanism
 * re-implemented as original, pure, deterministic TypeScript: no I/O,
 * no Date.now, no randomness. Same inputs → same survivors, everywhere.
 *
 * Failure posture is inverted from Hermes's caller: Hermes fails open
 * (exception → inject everything). Ours fails loud — an invalid
 * candidate throws CANDIDATE_INVALID, and an all-zero pool is an
 * explicit, reason-coded empty. There is no unfiltered-injection path.
 */
import type { MemorySourceClass, TrustTier } from "./types.js";
export type CollapsePool = "proof-registry" | "experience" | "trajectory" | "notes";
/** §6.1 source mapping: provenance class → pool + prior. */
export declare const SOURCE_POOLS: Record<MemorySourceClass, {
    pool: CollapsePool;
    prior: number;
}>;
export declare const DEFAULT_PACK_BUDGET = 6;
export declare const PRUNE_FLOOR_RATIO = 0.35;
export declare const NEAR_DUPLICATE_CONTAINMENT = 0.82;
export declare const CORROBORATION_CONTAINMENT = 0.5;
export declare const UNTRUSTED_SALIENCE_CAP = 0.25;
export interface CollapseCandidate {
    unitId: string;
    sourceClass: MemorySourceClass;
    /** The unit's own provenance sourceKey (§4.3 form). */
    sourceKey: string;
    claim: string;
    tags: string[];
    vulnClass?: string;
    /** Effective base — trust.baseScore, decay-adjusted by recall (§6.5) before the call. */
    baseScore: number;
    /** Absent only for legacy experience candidates (§6.6). */
    tier?: TrustTier;
    contentClass: "normal" | "target-derived-untrusted";
    independentCount: number;
    scopeKey: string;
    hasScope: boolean;
    hasTrustBlock: boolean;
    /** §6.6 legacy EXPERIENCE.md record: neutral base, no trust block. */
    legacyExperience?: boolean;
    primaryArtifactSha256?: string;
}
export interface ScoredCandidate {
    candidate: CollapseCandidate;
    pool: CollapsePool;
    queryOverlap: number;
    blended: number;
    rankWithinSource: number;
    salience0: number;
    boostCount: number;
    boostAmount: number;
    finalSalience: number;
    untrusted: boolean;
}
export interface CollapseResult {
    survivors: ScoredCandidate[];
    emptyReason?: "ALL_ZERO_SALIENCE";
    prunedUnitIds: string[];
    suppressedDuplicates: string[];
    untrustedDropped: string[];
    budgetDroppedUnitIds: string[];
    maxFinalSalience: number;
}
/** Lowercase, split on non-alphanumeric, drop tokens of length < 2. */
export declare function tokenize(text: string): string[];
export declare function tokenSet(text: string): Set<string>;
/** |A ∩ B| / min(|A|, |B|); 0 when either side is empty. */
export declare function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number;
/**
 * Score every candidate (§6.2 formula, exact). Throws CANDIDATE_INVALID
 * on the first invalid candidate — the pool is never defaulted.
 */
export declare function scoreCandidates(candidates: CollapseCandidate[], query: string): ScoredCandidate[];
/**
 * Full pipeline (§6.3): score → poisoning caps → relative prune → sort →
 * near-duplicate suppression → budget (trusted survivors spend the
 * budget first; untrusted fill leftovers, §6.4).
 */
export declare function collapseCandidates(candidates: CollapseCandidate[], opts: {
    query: string;
    budget?: number;
}): CollapseResult;
