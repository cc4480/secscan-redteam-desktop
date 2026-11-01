/**
 * Q-REPORT-DETAIL — the fixed tables behind report/detail.ts (spec
 * §§4–7): severity order and anchored deduction weights, the arm →
 * risk-area and arm → pillar maps, pillar definitions, the family
 * classification for engine findings, and the impact clauses. Data
 * and lookups only; derivations live in detail.ts + detail-blocks.ts.
 */
import type { DetailFindingInput, DetailSeverity, DetailTier } from './detail.js';
/** Severity order, worst first — the rank drives every sort below. */
export declare const SEVERITY_ORDER: readonly DetailSeverity[];
export declare const SEVERITY_RANK: Record<DetailSeverity, number>;
/** The anchored engine's deduction weights (report/grading.ts):
 * the order in which fixing findings recovers the grade. */
export declare const DEDUCTION_WEIGHT: Record<DetailSeverity, number>;
/** Grade-cap clauses (§3 line 2), from grading.ts's documented math. */
export declare const ANCHOR_CLAUSE: Partial<Record<DetailSeverity, string>>;
/** Recorded source labels normalize to one token form: lowercase,
 * `-`/space runs collapse to single underscores (B's inventory rule). */
export declare function normalizeLabel(raw: string): string;
/** §4.2 — arm → key risk area. Keys are exactly the 21 battery arms. */
export declare const ARM_AREA: Record<string, string>;
/** §7.1 — arm → its ONE primary pillar (no double counting). */
export declare const ARM_PILLAR: Record<string, string>;
/** The 21-arm universe in §7.1 listing order (§8.2's "of 21 arms"). */
export declare const ARM_UNIVERSE: readonly string[];
/** The normalized label of the SecScan engine pseudo-arm. */
export declare const ENGINE_ARM = "secscan_engine";
/** The canonical arm a recorded source label names, or null when the
 * label is not an arm (an engine category, or an unknown token —
 * detail.ts decides which, and fails loud on the latter). */
export declare function armOf(rawLabel: string): string | null;
export interface PillarDef {
    name: string;
    scopeLabel: string;
    arms: readonly string[];
    /** Set only for the pillars that have no arm at all (§7.1). */
    noArmReason?: string;
}
/** §7 — the seven pillar cards, in the reference's fixed order. */
export declare const PILLARS: readonly PillarDef[];
/** §4.3 family classes for engine findings and unlisted sources. */
export type FamilyClass = 'headers' | 'exposure' | 'transport' | 'auth';
export declare const FAMILY_AREA: Record<FamilyClass, string>;
/**
 * The §4.3 family a finding's recorded signals identify, evaluated in
 * the table's order: CWE/WSTG refs from `signals` + `attackIds`, plus
 * the SecScan engine's own category names carried in the source label.
 * Returns null when no family signal is present.
 */
export declare function familyClass(input: {
    sourceLabel: string;
    signals: readonly string[];
    attackIds: readonly string[];
}): FamilyClass | null;
/** §5 — the fixed business-impact clause per risk area. Text states
 * only what findings in the area mechanically imply; nothing else
 * may render in the impact band. */
export declare const AREA_IMPACT: Record<string, string>;
/** Signed delta rendering for the detail strings (+4 / −1 / 0). */
export declare const signed: (n: number) => string;
/** Singular/plural pick for the fixed template strings. */
export declare const plural: (n: number, one: string, many: string) => string;
/** F-id order: numeric suffix ascending (F-2 before F-10). */
export declare function compareIds(a: string, b: string): number;
/** Severity rank, then F-id — the member order inside area cards. */
export declare const byRankThenId: (a: DetailFindingInput, b: DetailFindingInput) => number;
/** §6.1 tier order: PROVEN ranks before CONFIRMED. */
export declare const TIER_RANK: Record<DetailTier, number>;
/** Actionable = a finding of record (PROVEN or CONFIRMED tier). */
export declare const isActionable: (f: DetailFindingInput) => boolean;
/** Fail-loud lookup: a derivation missing its input throws, so the
 * report degrades whole rather than rendering a partial derivation. */
export declare function req<V>(v: V | undefined, what: string): V;
