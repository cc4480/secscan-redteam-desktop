/**
 * Trust derivation (brief §4.3) — pure, no I/O. Trust is computed from
 * proof at write time and recomputed at apply time; an extractor
 * proposes content, never a tier. There is no vote, no feedback tool,
 * and retrieval counters never move trust (the Hermes trust-feedback
 * loop is DO-NOT-PORT). An asserted proof tier whose receipts do not
 * hold is an overclaim: `deriveTrust` throws TRUST_OVERCLAIM instead of
 * quietly downgrading the claim.
 */
import type { MemoryCorroboration, MemorySourceClass, TrustBlock, TrustDerivationInput, TrustTier } from "./types.js";
/** The §4.3 table's base scores, by tier. */
export declare const TRUST_BASE_SCORES: Record<TrustTier, number>;
/** The §4.3 sourceKey form: "<sourceClass>:<engagementId|operator>". */
export declare function sourceKeyFor(sourceClass: MemorySourceClass, origin: string): string;
/**
 * Compute the TrustBlock for a unit (first matching §4.3 row wins).
 * `derivedAt` is injected so the function stays pure and golden-testable.
 *
 * The proven row's proof-bundle path (a bundle receipt carrying
 * validationTier "execution") is subsumed by the cell path below: in
 * this runner a unit's `cellState: "proven"` is set only by exploit-cell
 * adjudication (both cell signatures + a passing negative control,
 * brief §1.4), which is the same machinery that mints execution-tier
 * bundles — so cellState + negativeControlReceiptRef is the reachable,
 * checkable form of the row.
 */
export declare function deriveTrust(input: TrustDerivationInput, derivedAt: string): TrustBlock;
export interface CorroborationCandidate {
    sourceClass: MemorySourceClass;
    /** sourceKeyFor(sourceClass, engagementId|operator) — embeds the origin. */
    sourceKey: string;
    /** Hash of the artifact this corroboration derives from, when it has one. */
    artifactSha256?: string;
}
/**
 * The §4.3 independence test. A candidate corroboration counts only when
 * its sourceKey is new (a different engagement or a non-target source —
 * the origin is embedded in the key) AND it does not derive from an
 * artifact already counted. The target agreeing with itself — a second
 * capture under the same sourceKey or of the same artifact — never counts.
 */
export declare function evaluateCorroboration(existing: Pick<MemoryCorroboration, "sourceKeys"> & {
    artifactSha256s?: string[];
}, candidate: CorroborationCandidate): {
    counted: boolean;
    reason: "INDEPENDENT" | "SAME_SOURCE_KEY" | "SAME_ARTIFACT";
};
