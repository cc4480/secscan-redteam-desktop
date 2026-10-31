/**
 * Trust derivation (brief §4.3) — pure, no I/O. Trust is computed from
 * proof at write time and recomputed at apply time; an extractor
 * proposes content, never a tier. There is no vote, no feedback tool,
 * and retrieval counters never move trust (the Hermes trust-feedback
 * loop is DO-NOT-PORT). An asserted proof tier whose receipts do not
 * hold is an overclaim: `deriveTrust` throws TRUST_OVERCLAIM instead of
 * quietly downgrading the claim.
 */

import { MemoryError } from "./errors.js";
import type {
  MemoryCorroboration,
  MemorySourceClass,
  TrustBlock,
  TrustDerivationInput,
  TrustTier,
} from "./types.js";

/** The §4.3 table's base scores, by tier. */
export const TRUST_BASE_SCORES: Record<TrustTier, number> = {
  proven: 1.0,
  confirmed: 0.85,
  killed: 0.8,
  corroborated: 0.65,
  "single-source": 0.45,
  "untrusted-target": 0.2,
};

/** The §4.3 sourceKey form: "<sourceClass>:<engagementId|operator>". */
export function sourceKeyFor(sourceClass: MemorySourceClass, origin: string): string {
  return `${sourceClass}:${origin}`;
}

function hasResolvableReceipt(input: TrustDerivationInput): boolean {
  return input.proof.receipts.some((r) => typeof r.ref === "string" && r.ref.trim().length > 0);
}

function overclaim(asserted: string, missing: string): MemoryError {
  return new MemoryError(
    "TRUST_OVERCLAIM",
    `proof.state "${asserted}" asserted without ${missing} — overclaim is a validation failure, never a silent downgrade`,
  );
}

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
export function deriveTrust(input: TrustDerivationInput, derivedAt: string): TrustBlock {
  const { proof, corroboration, contentClass } = input;
  const count = corroboration.independentCount;

  if (proof.state === "proven") {
    if (!hasResolvableReceipt(input)) throw overclaim("proven", "any resolvable receipt");
    if (proof.cellState !== "proven" || !proof.negativeControlReceiptRef) {
      throw overclaim("proven", "cellState \"proven\" with a negative-control receipt");
    }
    return {
      tier: "proven",
      baseScore: TRUST_BASE_SCORES.proven,
      derivedAt,
      derivation: ["CELL_PROVEN", "NEGATIVE_CONTROL_OK", "RECEIPT_LINKED"],
    };
  }

  if (proof.state === "confirmed") {
    if (!hasResolvableReceipt(input)) throw overclaim("confirmed", "any resolvable receipt");
    const derivation = ["RECEIPT_LINKED"];
    if (proof.registryEntryId) derivation.push("REGISTRY_ENTRY_LINKED");
    return { tier: "confirmed", baseScore: TRUST_BASE_SCORES.confirmed, derivedAt, derivation };
  }

  if (proof.state === "killed") {
    const killingLinked =
      hasResolvableReceipt(input) ||
      typeof proof.registryEntryId === "string" ||
      input.sourceRefs.some((r) => r.kind === "registry-entry");
    if (!killingLinked) throw overclaim("killed", "a killing-observation source ref");
    return {
      tier: "killed",
      baseScore: TRUST_BASE_SCORES.killed,
      derivedAt,
      derivation: ["KILLING_OBSERVATION_LINKED"],
    };
  }

  // Poisoning guard (§4.3): target-derived content keeps the hard cap
  // until >= 2 INDEPENDENT corroborations exist.
  if (contentClass === "target-derived-untrusted" && count < 2) {
    return {
      tier: "untrusted-target",
      baseScore: TRUST_BASE_SCORES["untrusted-target"],
      derivedAt,
      derivation: ["TARGET_DERIVED_UNTRUSTED", "HARD_CAP_APPLIED"],
    };
  }

  // A deferred finding was never confirmed; it derives to single-source
  // at most, whatever the corroboration count says.
  if (proof.state === "deferred") {
    return {
      tier: "single-source",
      baseScore: TRUST_BASE_SCORES["single-source"],
      derivedAt,
      derivation: ["DEFERRED_NOT_CONFIRMED"],
    };
  }

  if (count >= 2) {
    return {
      tier: "corroborated",
      baseScore: TRUST_BASE_SCORES.corroborated,
      derivedAt,
      derivation: [`INDEPENDENT_CORROBORATIONS_${count}`],
    };
  }

  return {
    tier: "single-source",
    baseScore: TRUST_BASE_SCORES["single-source"],
    derivedAt,
    derivation: ["SINGLE_SOURCE"],
  };
}

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
export function evaluateCorroboration(
  existing: Pick<MemoryCorroboration, "sourceKeys"> & { artifactSha256s?: string[] },
  candidate: CorroborationCandidate,
): { counted: boolean; reason: "INDEPENDENT" | "SAME_SOURCE_KEY" | "SAME_ARTIFACT" } {
  if (existing.sourceKeys.includes(candidate.sourceKey)) {
    return { counted: false, reason: "SAME_SOURCE_KEY" };
  }
  if (
    candidate.artifactSha256 &&
    (existing.artifactSha256s ?? []).includes(candidate.artifactSha256)
  ) {
    return { counted: false, reason: "SAME_ARTIFACT" };
  }
  return { counted: true, reason: "INDEPENDENT" };
}
