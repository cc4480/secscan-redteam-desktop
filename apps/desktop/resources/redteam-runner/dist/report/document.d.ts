/**
 * The authoritative report document (Carlos's order, 2026-11-01: ONE
 * template system for every artifact, the HTML flagship).
 *
 * Every deliverable format — report.html, report.md, report.json,
 * report.txt, findings.csv, report.docx — renders THIS model, and no
 * format assembles its own structure anymore. The model is built once
 * from the report phase's structured input (html/render.ts's
 * EngagementReportInput) and fixes, in one place:
 *
 *   - the canonical section order (REPORT_SECTION_ORDER — the locked
 *     design's anatomy: cover → posture banner → executive summary →
 *     coverage → severity breakdown → findings by truth tier → fix
 *     prompt → priority actions → pillars → strengths → surface →
 *     inventory → activity → recorded frame → limitations → footer);
 *   - the truth-tier grouping (PROVEN → CONFIRMED → DEFERRED → RULED
 *     OUT), severity-ordered within a tier, with ruled-out negative
 *     proofs de-duplicated against killed findings by exact normalized
 *     title — the same grouping rule the HTML cards have always used,
 *     now shared by every format;
 *   - the canonical counts: severity counts are the grading seam's
 *     posture counts (confirmed findings), and tier counts include the
 *     de-duplicated negative proofs in ruled-out — so the grade line,
 *     the severity line, and the tier line read identically in every
 *     artifact (previously report.json/report.txt counted ALL findings
 *     by severity while the HTML/DOCX showed the posture counts, and
 *     the same engagement disagreed with itself across formats);
 *   - the consolidated fix prompt, composed once by the HTML section
 *     builder (html/sections.ts buildFixPrompt) and carried as data.
 *
 * Nothing here invents content: a section is present exactly when the
 * engagement record carries its data (what-changed renders only
 * against a real predecessor scan — that rule lives in detail.ts; the
 * PROVEN tier exists only behind execution-tier proof — tierOf).
 */
import { type PostureBanner, type SecurityPosture } from "#seclayer/server/scoring.js";
import { type Finding } from "../types.js";
import { type NegativeProof, type PocBundle } from "../proof/index.js";
import { type ReportMeta } from "./html.js";
import { type FindingMeta } from "./html/cards.js";
import { type ReportTier, type SeverityName } from "./html/tokens.js";
import { type ActivityInput, type CoverageInput, type EngagementReportInput } from "./html/render.js";
import { type ReportDetail } from "./detail.js";
import { type ReportMatter } from "./detail-matter.js";
import { type HostInventoryArtifact } from "./host-inventory.js";
/** The canonical anatomy, in order. Every renderer's section sequence
 * is a subsequence of this list; `sections` on the document names the
 * ones the record actually carries. */
export declare const REPORT_SECTION_ORDER: readonly ["cover", "banner", "executive-summary", "coverage", "severity-breakdown", "findings", "fix-prompt", "priority-actions", "pillars", "strengths", "surface", "inventory", "activity", "recorded-frame", "limitations", "footer"];
export type ReportSectionId = (typeof REPORT_SECTION_ORDER)[number];
/** One truth tier of the Findings section: its findings in report
 * order, plus — on the ruled-out tier only — the negative proofs that
 * no killed finding already states. */
export interface ReportTierGroup {
    tier: ReportTier;
    findings: Finding[];
    negativeProof: NegativeProof[];
}
export interface ReportDocument {
    meta: ReportMeta;
    title: string;
    /** Reporter narrative markdown (findings JSON already stripped). */
    narrativeMd: string;
    /** The anchored grade over the confirmed findings (grading seam). */
    posture: SecurityPosture;
    banner: PostureBanner | null;
    haltedReason?: string;
    blockedReason?: string;
    dryRun?: boolean;
    /** Canonical severity counts — the posture's, in every format. */
    severityCounts: Record<SeverityName, number>;
    /** Canonical tier counts (ruled-out includes negative proofs). */
    tierCounts: Record<ReportTier, number>;
    /** Non-empty tier groups, in TIER_ORDER. */
    tierGroups: ReportTierGroup[];
    /** Every finding in report order (tier → severity → id). */
    findingsInReportOrder: Finding[];
    /** The consolidated fix prompt text; "" when nothing is actionable. */
    fixPrompt: string;
    bundles: ReadonlyMap<string, PocBundle>;
    noBundleReasons: ReadonlyMap<string, string>;
    findingMeta: ReadonlyMap<string, FindingMeta>;
    detail?: ReportDetail;
    matter?: ReportMatter;
    coverage: CoverageInput;
    activity: ActivityInput;
    inventory?: HostInventoryArtifact;
    /** The sections this record carries, in canonical order. */
    sections: ReportSectionId[];
}
/** Build the one report document from the phase's structured input. */
export declare function buildReportDocument(o: EngagementReportInput): ReportDocument;
