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

import { MemoryError } from "./errors.js";
import type { MemorySourceClass, TrustTier } from "./types.js";

export type CollapsePool = "proof-registry" | "experience" | "trajectory" | "notes";

/** §6.1 source mapping: provenance class → pool + prior. */
export const SOURCE_POOLS: Record<MemorySourceClass, { pool: CollapsePool; prior: number }> = {
  registry: { pool: "proof-registry", prior: 1.1 },
  "proof-bundle": { pool: "proof-registry", prior: 1.1 },
  experience: { pool: "experience", prior: 1.05 },
  trajectory: { pool: "trajectory", prior: 1.0 },
  operator: { pool: "notes", prior: 1.0 },
  "target-content": { pool: "notes", prior: 1.0 },
  "model-inference": { pool: "notes", prior: 1.0 },
};

export const DEFAULT_PACK_BUDGET = 6;
export const PRUNE_FLOOR_RATIO = 0.35;
export const NEAR_DUPLICATE_CONTAINMENT = 0.82;
export const CORROBORATION_CONTAINMENT = 0.5;
export const UNTRUSTED_SALIENCE_CAP = 0.25;

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
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function claimTokens(c: CollapseCandidate): Set<string> {
  return tokenSet(`${c.claim} ${c.tags.join(" ")} ${c.vulnClass ?? ""}`);
}

/** |A ∩ B| / min(|A|, |B|); 0 when either side is empty. */
export function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.min(a.size, b.size);
}

function validateCandidate(c: CollapseCandidate): void {
  const bad = (why: string): MemoryError =>
    new MemoryError("CANDIDATE_INVALID", `collapse candidate ${c.unitId || "<no unitId>"}: ${why}`);
  if (!c.unitId) throw bad("missing unitId");
  if (!SOURCE_POOLS[c.sourceClass]) throw bad(`unknown sourceClass "${String(c.sourceClass)}"`);
  if (!c.hasScope || !c.scopeKey) throw bad("missing scope");
  if (!c.hasTrustBlock && c.legacyExperience !== true) throw bad("missing trust block");
  if (!Number.isFinite(c.baseScore) || c.baseScore < 0 || c.baseScore > 1) {
    throw bad(`baseScore ${c.baseScore} outside 0..1`);
  }
}

/** §6.2 independence, inside the boost count (the §4.3 test, pool form). */
function boostIndependent(a: CollapseCandidate, b: CollapseCandidate): boolean {
  if (a.sourceKey === b.sourceKey) return false;
  if (a.primaryArtifactSha256 && a.primaryArtifactSha256 === b.primaryArtifactSha256) return false;
  // The target agreeing with itself is not corroboration.
  if (
    a.contentClass === "target-derived-untrusted" &&
    b.contentClass === "target-derived-untrusted" &&
    a.scopeKey === b.scopeKey
  ) {
    return false;
  }
  // Agreement across a contradiction is not corroboration: a killed
  // candidate is never boosted by a proven/confirmed one for the same
  // vulnClass, or vice versa. (Both may still survive and render.)
  const aKilled = a.tier === "killed";
  const bKilled = b.tier === "killed";
  const aProved = a.tier === "proven" || a.tier === "confirmed";
  const bProved = b.tier === "proven" || b.tier === "confirmed";
  if ((aKilled && bProved) || (bKilled && aProved)) {
    if (a.vulnClass && a.vulnClass === b.vulnClass) return false;
  }
  return true;
}

/**
 * Score every candidate (§6.2 formula, exact). Throws CANDIDATE_INVALID
 * on the first invalid candidate — the pool is never defaulted.
 */
export function scoreCandidates(
  candidates: CollapseCandidate[],
  query: string,
): ScoredCandidate[] {
  for (const c of candidates) validateCandidate(c);
  const queryTokens = tokenSet(query);
  const tokenMap = new Map<string, Set<string>>();
  for (const c of candidates) tokenMap.set(c.unitId, claimTokens(c));

  // Rank within each source pool: baseScore desc, then unitId asc.
  const pools = new Map<CollapsePool, CollapseCandidate[]>();
  for (const c of candidates) {
    const { pool } = SOURCE_POOLS[c.sourceClass];
    const list = pools.get(pool) ?? [];
    list.push(c);
    pools.set(pool, list);
  }
  const rankOf = new Map<string, number>();
  for (const list of pools.values()) {
    const sorted = [...list].sort(
      (x, y) => y.baseScore - x.baseScore || (x.unitId < y.unitId ? -1 : x.unitId > y.unitId ? 1 : 0),
    );
    sorted.forEach((c, i) => rankOf.set(c.unitId, i));
  }

  return candidates.map((c) => {
    const tokens = tokenMap.get(c.unitId) as Set<string>;
    let overlapHits = 0;
    for (const t of queryTokens) if (tokens.has(t)) overlapHits++;
    const queryOverlap = queryTokens.size === 0 ? 0 : overlapHits / queryTokens.size;
    const blended = 0.55 * queryOverlap + 0.45 * c.baseScore;
    const rankWithinSource = rankOf.get(c.unitId) as number;
    const { pool, prior } = SOURCE_POOLS[c.sourceClass];
    const salience0 = blended * Math.pow(0.85, rankWithinSource) * prior;

    let boostCount = 0;
    for (const other of candidates) {
      if (other.unitId === c.unitId) continue;
      if (SOURCE_POOLS[other.sourceClass].pool === pool) continue;
      if (containment(tokens, tokenMap.get(other.unitId) as Set<string>) < CORROBORATION_CONTAINMENT) {
        continue;
      }
      if (!boostIndependent(c, other)) continue;
      boostCount++;
    }
    const boostAmount = Math.min(boostCount * 0.15 * salience0, 0.5);
    let finalSalience = salience0 * (1 + boostAmount);
    const untrusted = c.contentClass === "target-derived-untrusted" && c.independentCount < 2;
    if (untrusted) finalSalience = Math.min(finalSalience, UNTRUSTED_SALIENCE_CAP);
    return {
      candidate: c,
      pool,
      queryOverlap,
      blended,
      rankWithinSource,
      salience0,
      boostCount,
      boostAmount,
      finalSalience,
      untrusted,
    };
  });
}

/**
 * Full pipeline (§6.3): score → poisoning caps → relative prune → sort →
 * near-duplicate suppression → budget (trusted survivors spend the
 * budget first; untrusted fill leftovers, §6.4).
 */
export function collapseCandidates(
  candidates: CollapseCandidate[],
  opts: { query: string; budget?: number },
): CollapseResult {
  const budget = opts.budget ?? DEFAULT_PACK_BUDGET;
  const scored = scoreCandidates(candidates, opts.query);
  const maxFinalSalience = scored.reduce((m, s) => Math.max(m, s.finalSalience), 0);
  if (scored.length === 0 || maxFinalSalience === 0) {
    return {
      survivors: [],
      emptyReason: "ALL_ZERO_SALIENCE",
      prunedUnitIds: scored.map((s) => s.candidate.unitId),
      suppressedDuplicates: [],
      untrustedDropped: [],
      budgetDroppedUnitIds: [],
      maxFinalSalience,
    };
  }

  const floor = PRUNE_FLOOR_RATIO * maxFinalSalience;
  const kept: ScoredCandidate[] = [];
  const prunedUnitIds: string[] = [];
  for (const s of scored) {
    if (s.finalSalience < floor) prunedUnitIds.push(s.candidate.unitId);
    else kept.push(s);
  }
  kept.sort(
    (x, y) =>
      y.finalSalience - x.finalSalience ||
      y.candidate.baseScore - x.candidate.baseScore ||
      (x.candidate.unitId < y.candidate.unitId ? -1 : x.candidate.unitId > y.candidate.unitId ? 1 : 0),
  );

  const deduped: ScoredCandidate[] = [];
  const suppressedDuplicates: string[] = [];
  const keptTokens: { unitId: string; tokens: Set<string> }[] = [];
  for (const s of kept) {
    const tokens = claimTokens(s.candidate);
    if (keptTokens.some((k) => containment(tokens, k.tokens) >= NEAR_DUPLICATE_CONTAINMENT)) {
      suppressedDuplicates.push(s.candidate.unitId);
      continue;
    }
    deduped.push(s);
    keptTokens.push({ unitId: s.candidate.unitId, tokens });
  }

  const ordered = [
    ...deduped.filter((s) => !s.untrusted),
    ...deduped.filter((s) => s.untrusted),
  ];
  const survivors = ordered.slice(0, budget);
  const survivorIds = new Set(survivors.map((s) => s.candidate.unitId));
  return {
    survivors,
    prunedUnitIds,
    suppressedDuplicates,
    untrustedDropped: ordered
      .filter((s) => s.untrusted && !survivorIds.has(s.candidate.unitId))
      .map((s) => s.candidate.unitId),
    budgetDroppedUnitIds: ordered
      .filter((s) => !s.untrusted && !survivorIds.has(s.candidate.unitId))
      .map((s) => s.candidate.unitId),
    maxFinalSalience,
  };
}
