import { type ReportDocument } from "./document.js";
export interface ReportMarkdownAnnexes {
    /** The runner-computed battery coverage line (phase.ts). */
    batteryLine: string;
    /** The nuclei honest-count line, when nuclei ran. */
    nucleiLine?: string;
    /** The item reconciliation block (carries its own ## heading). */
    itemsMd?: string;
    /** The runner-computed proof section (carries its own ## heading). */
    proofMd: string;
    /** The integrations annex (tickets / SIEM / notify), when any ran. */
    integrationsMd: string;
}
/** Render report.md from the document, in the canonical anatomy. */
export declare function renderReportMarkdown(doc: ReportDocument, annexes: ReportMarkdownAnnexes): string;
