import { type Ctx } from "../context.js";
import { type ArtifactSignoff, type ArtifactUnsigned } from "../events.js";
import { type Finding } from "../types.js";
import { type ReportDocument } from "./document.js";
export declare const REPORT_JSON_NAME = "report.json";
export declare const REPORT_TXT_NAME = "report.txt";
/** The full deliverable set, in package order (the zip itself last). */
export declare const DELIVERABLE_FILES: readonly ["report.html", "report.md", "report.json", "report.txt", "findings.csv", "report.docx", "report-package.zip"];
export type DeliverableEndStatus = "complete" | "halted" | "blocked" | "dry-run";
export interface ReportModel {
    kind: "secscan-redteam-report";
    version: 1;
    engagementId: string;
    target: string;
    mode: string;
    objective: string;
    /** How the engagement ended; "dry-run" marks a no-live-agents run. */
    status: DeliverableEndStatus;
    /** The halt/block reason, when the end was not a completion. */
    reason?: string;
    dryRun: boolean;
    generatedAt: string;
    /** The anchored grade; null when the end was halted/blocked (N/A). */
    grade: {
        letter: string;
        score: number;
        rating: string;
    } | null;
    severityCounts: {
        critical: number;
        high: number;
        medium: number;
        low: number;
        info: number;
    };
    /** Truth-tier counts from the report document, when it was built. */
    tierCounts?: {
        proven: number;
        confirmed: number;
        deferred: number;
        "ruled-out": number;
    };
    /** Canonical section ids the record carries, when the document was built. */
    sections?: string[];
    /** The consolidated fix prompt, when the document was built. */
    fixPrompt?: string;
    /** SCRIBE GATE: the publisher seat's sign-off on this set, stamped
     * into report.json by report/scribe.ts after the model is emitted. */
    artifactSignoff?: ArtifactSignoff | null;
    /** SCRIBE GATE: why this set shipped unsigned, when it did. */
    artifactUnsigned?: ArtifactUnsigned | null;
    findingCount: number;
    batteryTotals: {
        total: number;
        confirmed: number;
        executedClean: number;
        killed: number;
        blocked: number;
        na: number;
        pending: number;
    };
    coverageCells: {
        target: string;
        category: string;
        state: string;
    }[];
    findings: Finding[];
}
export interface ReportModelArgs {
    findings: Finding[];
    totals: ReportModel["batteryTotals"];
    cells: readonly {
        t: string;
        c: string;
        s: string;
    }[];
    haltedReason?: string;
    blockedReason?: string;
}
/** Assemble the report model from the phase's final records — the same
 * findings, posture, totals, and cells the HTML renders from, so every
 * format reconciles by construction. When the shared report document
 * was built, its canonical counts win: severityCounts are the
 * posture's counts over confirmed findings (the counts report.html,
 * report.md, and report.docx print), not a second all-findings count
 * that disagreed with the flagship whenever killed/deferred findings
 * existed. */
export declare function buildReportModel(ctx: Ctx, args: ReportModelArgs, doc?: ReportDocument): ReportModel;
export declare function renderReportJson(model: ReportModel): string;
/** The plain-text renderer lives in ./text.ts (it renders the model +
 * the shared report document); re-exported here for the module's
 * existing consumers. */
export { renderReportTxt } from "./text.js";
/** Write report.json + report.txt from the model. Each is its own
 * failure domain in the established emitter style: a failure is an
 * event, never a lost report — finalizeDeliverables is the backstop
 * that refuses a clean completion when a file is missing. */
export declare function emitReportModel(ctx: Ctx, model: ReportModel, doc?: ReportDocument): void;
/** The chat surface's field names for the deliverable paths
 * (ui/engagement-tools.ts `engagement_report`): every present file under
 * its tool field name, plus a `deliverableGap` entry when the HTML is
 * missing — the gap is surfaced, never silently omitted (probe 7). */
export declare function deliverableToolFields(dir: string): Record<string, string>;
export interface DeliverablesOutcome {
    ok: boolean;
    /** Absolute path per deliverable file present on disk. */
    paths: Record<string, string>;
    /** Deliverable file names missing (or not regular files) on disk. */
    missing: string[];
}
/** Verify the set on disk: every deliverable present as a regular file. */
export declare function verifyDeliverables(dir: string): DeliverablesOutcome;
/** The close-out stamp every recorded engagement end runs: verify the
 * deliverable set, record the outcome as an event, and stamp the state
 * record the result and surfaces read. */
export declare function finalizeDeliverables(ctx: Ctx): DeliverablesOutcome;
