/**
 * The Q-REPORT-DETAIL sections (spec §§2–8): breakdown, what-changed,
 * key risk areas, business impact, priority actions, pillar cards, and
 * the surface/detail wells. Markup only — every figure, grouping, and
 * sentence arrives slot-filled from report/detail.ts; a section whose
 * inputs the record does not carry renders its designed absent state
 * or nothing, per the spec section it implements.
 */
import { type ReportDetail } from "../detail.js";
/** §3 — the detailed executive breakdown: deterministic lines, in order. */
export declare function breakdownSection(d: ReportDetail): string;
/** §2 — what changed against the recorded same-engine predecessor, or
 * the designed no-baseline panel (§2.4, verbatim) when none exists. */
export declare function whatChangedSection(d: ReportDetail, target: string): string;
/** §4 — key risk areas: one card per non-empty area; omitted entirely
 * when there are zero actionable findings (§4.5). */
export declare function riskAreasSection(d: ReportDetail): string;
/** §5 — the business-impact band: the fixed statement table's selected
 * row, composed in detail.ts; the class follows its level. */
export declare function impactSection(d: ReportDetail): string;
/** §6 — priority actions, ranked in detail.ts; deferred findings follow
 * as the "Verify next" sub-list. */
export declare function prioritySection(d: ReportDetail): string;
/** §7 — per-pillar cards: always all seven, in the fixed order; a
 * pillar's status word and counts come from detail.ts's single-primary
 * attribution, so the counts reconcile to the cover total. */
export declare function pillarSection(d: ReportDetail): string;
/** §8 — surface & coverage detail wells, immediately after the coverage
 * strip. The network well renders only when recon recorded surface
 * facts; an empty block would fabricate a surface record. */
export declare function surfaceSection(d: ReportDetail): string;
