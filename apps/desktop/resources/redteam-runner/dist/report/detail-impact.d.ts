/**
 * Q-REPORT-DETAIL §5 + Q-RP-4 — the impact derivations for report/detail.ts:
 * the report-level business-impact band and the per-finding Impact
 * statements. Both are composed ONLY from the spec's fixed statement
 * table (AREA_IMPACT) plus slots the record itself carries (severity,
 * tier, the finding's §4 risk area) — no freehand prose, no invented
 * consequences. A finding whose area has no clause fails loud via req(),
 * like every other derivation.
 */
import type { DetailFindingInput } from './detail.js';
export interface ImpactBand {
    level: 'critical' | 'high' | 'medium' | 'low' | 'none';
    text: string;
}
/** §5 — the impact band selects the first matching fixed statement. */
export declare function buildImpact(actionable: DetailFindingInput[], areaOf: Map<string, string>): ImpactBand;
/** Q-RP-4 — one Impact statement per finding of record (PROVEN +
 * CONFIRMED; the caller passes exactly the actionable set). DEFERRED
 * findings get none — verification is outstanding, so no consequence
 * may be asserted — and ruled-out findings are not in the set at all.
 * The exemplar's per-finding Impact block, derived mechanically at
 * report time: status lead-in + the finding's §5 area clause. */
export declare function buildFindingImpacts(actionable: DetailFindingInput[], areaOf: Map<string, string>): Record<string, string>;
