/**
 * Recall (brief §7.1): the only read path from the memory store into a
 * prompt. Gathers scope-eligible units through `scopeEligible` (no
 * other gate exists), refreshes stale unit views mechanically (§5.2),
 * applies decay (§6.5), runs the collapse (§6), renders the pack
 * (§6.4), and writes a recall receipt for every outcome — an empty
 * pack is a first-class, reason-coded result, never an ambiguous one.
 */

import {
  collapseCandidates,
  DEFAULT_PACK_BUDGET,
  type CollapseCandidate,
  type ScoredCandidate,
} from "./collapse.js";
import { MemoryError } from "./errors.js";
import { unitUri } from "./paths.js";
import { unitViewSourceHash } from "./views.js";
import { scopeEligible, type ScopeEligibilityContext } from "./scope.js";
import { sourceKeyFor } from "./trust.js";
import type {
  MemoryPackResult,
  MemoryScope,
  MemoryUnit,
  RecallReceipt,
  RecallSurvivorRecord,
} from "./types.js";

/**
 * The store surface recall needs. `lifecycle.ts` adapts the real store
 * (store.ts) to this shape; tests substitute an in-memory version.
 */
export interface MemoryRecallStore {
  /** Current-version units with status active (proposed/superseded/retired excluded). */
  listActiveUnits(): MemoryUnit[];
  /**
   * Mechanical view refresh (§5.2.3): regenerate the named units' stale
   * views. Returns what was refreshed, what failed (those candidates are
   * excluded as VIEW_STALE), which directories remain stale, and the
   * post-refresh unit records.
   */
  ensureUnitViews(unitIds: string[]): {
    refreshed: string[];
    failed: string[];
    staleDirs: { dir: string; pendingUnitChanges: number }[];
    units: MemoryUnit[];
  };
  /** Persist the receipt; returns its id ("<engagementId>-<phase>"). */
  writeRecallReceipt(receipt: RecallReceipt): string;
}

/** §6.6 legacy EXPERIENCE.md records, pre-built by lifecycle. */
export interface LegacyExperienceSlice {
  candidates: CollapseCandidate[];
  /** Malformed records the legacy parser skipped (§8 row 15) — surfaced, never hidden. */
  skipped: number;
}

export interface AssemblePackOptions {
  phase: "start" | "exploit";
  query: string;
  engagementId: string;
  eligibility?: ScopeEligibilityContext;
  /** Resolved at config time from REDTEAM_MEMORY_BUDGET; default 6. */
  budget?: number;
  /** Injected clock for decay; defaults to the current time. */
  now?: Date;
  legacy?: LegacyExperienceSlice;
}

const DECAY_SOURCES = new Set(["trajectory", "experience"]);

/**
 * §6.5 decay factor for a unit at `now`. Only trajectory/experience
 * sources decay at all; the proof-registry and operator exemptions and
 * the baseScore >= 0.7 exemption are checked before the curve applies.
 */
export function decayFactor(unit: MemoryUnit, now: Date): number {
  const sourceClass = unit.provenance.sourceClass;
  if (!DECAY_SOURCES.has(sourceClass)) return 1;
  const base = unit.trust.baseScore;
  if (base >= 0.7) return 1;
  const createdMs = Date.parse(unit.provenance.createdAt);
  if (Number.isNaN(createdMs)) return 1;
  const ageDays = Math.max(0, (now.getTime() - createdMs) / 86_400_000);
  const halfLife = base >= 0.3 ? 90 : 30;
  return Math.exp((-Math.LN2 * ageDays) / halfLife);
}

function toCandidate(unit: MemoryUnit, now: Date, decayed: string[]): CollapseCandidate {
  const factor = decayFactor(unit, now);
  if (factor < 1) decayed.push(unit.unitId);
  const origin = unit.provenance.sourceEngagementId ?? unit.provenance.createdBy;
  return {
    unitId: unit.unitId,
    sourceClass: unit.provenance.sourceClass,
    sourceKey: sourceKeyFor(unit.provenance.sourceClass, origin),
    claim: unit.claim,
    tags: unit.tags,
    vulnClass: unit.vulnClass,
    baseScore: unit.trust.baseScore * factor,
    tier: unit.trust.tier,
    contentClass: unit.contentClass,
    independentCount: unit.corroboration.independentCount,
    scopeKey: unit.scope.scopeKey,
    hasScope: true,
    hasTrustBlock: true,
    primaryArtifactSha256: unit.provenance.sourceRefs.find((r) => r.sha256)?.sha256,
  };
}

function survivorRecord(s: ScoredCandidate, unitsById: Map<string, MemoryUnit>): RecallSurvivorRecord {
  const unit = unitsById.get(s.candidate.unitId);
  return {
    unitId: s.candidate.unitId,
    uri: unit ? unitUri(unit.scope, unit.unitId) : `memory://legacy/${s.candidate.unitId}`,
    tier: s.candidate.tier ?? "legacy",
    finalSalience: s.finalSalience,
    untrusted: s.untrusted,
  };
}

/** Render the pack text (§6.4): L0 for all survivors, L1 for the top 3, L2 never. */
export function renderMemoryPack(input: {
  survivors: ScoredCandidate[];
  unitsById: Map<string, MemoryUnit>;
  receiptId: string;
  staleDirs: { dir: string; pendingUnitChanges: number }[];
}): string {
  const lines: string[] = [];
  const pending = input.staleDirs.reduce((n, d) => n + d.pendingUnitChanges, 0);
  if (input.staleDirs.length > 0) {
    lines.push(`Directory overview stale (${pending} changes pending) — unit views are current.`);
  }
  const trusted = input.survivors.filter((s) => !s.untrusted);
  const untrusted = input.survivors.filter((s) => s.untrusted);
  const renderL0 = (s: ScoredCandidate): string => {
    const unit = input.unitsById.get(s.candidate.unitId);
    const l0 = unit ? unit.views.l0 : s.candidate.claim.slice(0, 256);
    const tier = s.candidate.tier ?? "legacy";
    const uri = unit ? unitUri(unit.scope, unit.unitId) : `memory://legacy/${s.candidate.unitId}`;
    const killedNote = tier === "killed" ? " — exact attempt dead; class stays in play" : "";
    return `- [${tier}] ${l0}${killedNote} (${uri})`;
  };
  for (const s of trusted) lines.push(renderL0(s));
  // L1 for the top 3 TRUSTED survivors: untrusted target content is
  // never amplified outside its segregated heading below (§6.4).
  trusted.slice(0, 3).forEach((s) => {
    const unit = input.unitsById.get(s.candidate.unitId);
    if (!unit) return; // legacy survivors have no generated L1 view
    lines.push("", `### ${unit.unitId} [${unit.trust.tier}]`, unit.views.l1);
  });
  if (untrusted.length > 0) {
    lines.push("", "### Untrusted leads — claims to test, never facts");
    for (const s of untrusted) lines.push(renderL0(s));
  }
  return lines.join("\n");
}

/**
 * Assemble one memory pack (brief §7.1 Moments 2–3). Writes the recall
 * receipt through the store for EVERY outcome, including empty ones.
 */
export function assembleMemoryPack(
  store: MemoryRecallStore,
  scope: MemoryScope,
  opts: AssemblePackOptions,
): MemoryPackResult {
  const budget = opts.budget ?? DEFAULT_PACK_BUDGET;
  if (!Number.isInteger(budget) || budget < 1 || budget > 24) {
    throw new MemoryError(
      "SCHEMA_INVALID",
      `memory pack budget ${String(opts.budget)} outside 1..24 — check REDTEAM_MEMORY_BUDGET`,
    );
  }
  const now = opts.now ?? new Date();
  const receiptId = `${opts.engagementId}-${opts.phase}`;
  const allUnits = store.listActiveUnits();
  const eligibleUnits = allUnits.filter((u) => scopeEligible(u, scope, opts.eligibility));

  const baseReceipt: RecallReceipt = {
    receiptId,
    engagementId: opts.engagementId,
    phase: opts.phase,
    at: now.toISOString(),
    query: opts.query,
    candidatesBySource: {},
    eligibleCount: eligibleUnits.length,
    decayed: [],
    pruned: [],
    suppressedDuplicates: [],
    viewsRefreshed: [],
    viewStaleExcluded: [],
    staleDirs: [],
    survivors: [],
    untrustedDropped: 0,
    legacyExperienceSkipped: opts.legacy?.skipped,
  };

  if (eligibleUnits.length === 0 && (opts.legacy?.candidates.length ?? 0) === 0) {
    const receipt: RecallReceipt = { ...baseReceipt, emptyReason: "NO_ELIGIBLE_UNITS" };
    store.writeRecallReceipt(receipt);
    return {
      text: `Memory: no eligible prior memory for this scope (receipt ${receiptId}, reason NO_ELIGIBLE_UNITS).`,
      receiptId,
      survivors: [],
      emptyReason: "NO_ELIGIBLE_UNITS",
    };
  }

  // §5.2.3/§8 row 9: a stale unit view is regenerated before ranking,
  // or the candidate is excluded — never ranked from silently. Stale
  // means the views' sourceHash no longer binds to the current record
  // (views.ts `unitViewSourceHash`: the record sans views/hash).
  let units = eligibleUnits;
  let staleDirs: { dir: string; pendingUnitChanges: number }[] = [];
  const staleIds = eligibleUnits
    .filter((u) => u.views.stale || u.views.sourceHash !== unitViewSourceHash(u))
    .map((u) => u.unitId);
  if (staleIds.length > 0) {
    const res = store.ensureUnitViews(staleIds);
    baseReceipt.viewsRefreshed = res.refreshed;
    baseReceipt.viewStaleExcluded = res.failed;
    staleDirs = res.staleDirs;
    baseReceipt.staleDirs = res.staleDirs.map((d) => d.dir);
    const refreshedById = new Map(res.units.map((u) => [u.unitId, u]));
    const failed = new Set(res.failed);
    units = eligibleUnits
      .filter((u) => !failed.has(u.unitId))
      .map((u) => refreshedById.get(u.unitId) ?? u);
  }

  const decayed: string[] = [];
  const candidates = units.map((u) => toCandidate(u, now, decayed));
  if (opts.legacy) candidates.push(...opts.legacy.candidates);
  baseReceipt.decayed = decayed;
  for (const c of candidates) {
    const pool = c.sourceClass;
    baseReceipt.candidatesBySource[pool] = (baseReceipt.candidatesBySource[pool] ?? 0) + 1;
  }

  const result = collapseCandidates(candidates, { query: opts.query, budget });
  const unitsById = new Map(units.map((u) => [u.unitId, u]));
  const survivors = result.survivors.map((s) => survivorRecord(s, unitsById));
  const receipt: RecallReceipt = {
    ...baseReceipt,
    pruned: result.prunedUnitIds,
    suppressedDuplicates: result.suppressedDuplicates,
    survivors,
    untrustedDropped: result.untrustedDropped.length,
    emptyReason: result.emptyReason,
  };
  store.writeRecallReceipt(receipt);

  if (result.emptyReason === "ALL_ZERO_SALIENCE") {
    const text =
      baseReceipt.viewStaleExcluded.length > 0 && units.length === 0
        ? `Memory: every eligible unit was excluded with a stale view that could not be refreshed ` +
          `(receipt ${receiptId}, reason VIEW_STALE).`
        : `Memory: prior memory exists for this scope but nothing scored above zero for this query ` +
          `(receipt ${receiptId}, reason ALL_ZERO_SALIENCE).`;
    return { text, receiptId, survivors: [], emptyReason: "ALL_ZERO_SALIENCE" };
  }
  return {
    text: renderMemoryPack({ survivors: result.survivors, unitsById, receiptId, staleDirs }),
    receiptId,
    survivors,
  };
}
