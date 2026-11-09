/**
 * The unified engagement report renderer — the design study's Part D
 * template, assembled deterministically from structured records.
 *
 * Inputs are the report phase's own objects (posture, findings, PoC
 * bundles, coverage, activity) — never agent-authored HTML and never a
 * markdown string whose prose structure the renderer must guess at. The
 * one prose input is the reporter narrative, rendered through the same
 * escaping markdown renderer the UI uses, into the executive-summary slot.
 *
 * Output: one self-contained HTML file — inline CSS, inline SVG, no
 * external requests, readable with scripts off (the single script is a
 * copy-button enhancement).
 */
import { type SecurityPosture, type PostureBanner } from '../posture.js';
import { type Finding } from '../../types.js';
import { type PocBundle, type NegativeProof } from '../../proof/index.js';
import { type ReportMeta } from '../html.js';
import { type FindingMeta } from './cards.js';
import { type ActivityInput, type CoverageInput, type TeamMember } from './sections.js';
import type { ReportDetail } from '../detail.js';
import type { ReportMatter } from '../detail-matter.js';
import type { HostInventoryArtifact } from '../host-inventory.js';
export type { ActivityInput, CoverageInput } from './sections.js';
export type { FindingMeta } from './cards.js';
export interface EngagementReportInput {
    meta: ReportMeta;
    title: string;
    /** Reporter narrative markdown (the executive-summary prose slot). */
    narrativeMd: string;
    /** The anchored grade over the confirmed findings (grading seam). */
    posture: SecurityPosture;
    banner: PostureBanner | null;
    /** The fleet seats that ran this engagement (team section). */
    team?: TeamMember[];
    findings: Finding[];
    bundles: ReadonlyMap<string, PocBundle>;
    /** Runner-computed reason each confirmed finding has no bundle. */
    noBundleReasons: ReadonlyMap<string, string>;
    negativeProof: NegativeProof[];
    findingMeta: ReadonlyMap<string, FindingMeta>;
    /** The Q-REPORT-DETAIL derivations (report/detail.ts), when the
     * phase assembled them. Absent => the pre-detail anatomy renders. */
    detail?: ReportDetail;
    /** The Q-RP-11 host inventory (report/host-inventory.ts), when the
     * engagement dir carries the artifact. Absent => no inventory
     * sections render (web/remote engagements are unchanged). */
    inventory?: HostInventoryArtifact;
    coverage: CoverageInput;
    activity: ActivityInput;
    /** The Q-RP-7 / Q-RP-8 matter derivations (report/detail-matter.ts),
     * when the phase assembled them. Absent => no matter sections render. */
    matter?: ReportMatter;
    haltedReason?: string;
    /** Authorization was denied before testing (Q-DELIVERABLES-AUTOFIRE
     * P3): the cover renders N/A and the blocked banner leads. */
    blockedReason?: string;
    dryRun?: boolean;
}
export declare function renderEngagementReportHtml(o: EngagementReportInput): string;
