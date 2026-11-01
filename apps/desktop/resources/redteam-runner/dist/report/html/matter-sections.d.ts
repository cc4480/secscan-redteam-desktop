/**
 * The Q-RP-7 / Q-RP-8 matter sections: scope & authorisation and the
 * method / risk-rating notes (front matter, after the cover), what is
 * working well (beside Coverage), and limitations & residual unknowns
 * (back matter, before the footer). Markup only — every row, line, and
 * count arrives slot-filled from report/detail-matter.ts; a fact the
 * record does not carry is absent here because it is absent there.
 */
import { type ReportMatter } from "../detail-matter.js";
/** Front matter 1 — scope & authorisation: the engagement's recorded
 * frame (ROE lists, the ownership-verification record, the operator of
 * record, the timestamps), stated once, before the narrative. */
export declare function scopeSection(m: ReportMatter): string;
/** Front matter 2 — method & tooling: mode/tier, battery composition,
 * the plan's phases, and the recorded activity volume. */
export declare function methodSection(m: ReportMatter): string;
/** Front matter 3 — risk rating method: how the anchored grade on the
 * cover is produced, with the truth-tier definitions the findings
 * below are grouped by. */
export declare function riskMethodSection(m: ReportMatter): string;
/** Q-RP-8 — what is working well: executed-clean checks by area and the
 * ruled-out count, from the coverage/proof record. Renders nothing
 * when the derivation found no strength evidence. */
export declare function strengthsSection(m: ReportMatter): string;
/** Back matter — limitations & residual unknowns: what was blocked,
 * left uncovered, or left pending, restated at the close from the same
 * coverage record the Coverage section renders. */
export declare function limitationsSection(m: ReportMatter): string;
