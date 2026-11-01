/**
 * High-quality HTML rendering for engagement reports.
 *
 * The runner already writes report.md, compliance-pack.md, attestation.md and
 * safety-manifest.md. Those stay — they are the diffable, greppable record and
 * the input to other tooling. This renders the same content as a self-contained
 * HTML document meant to be read by a person, opened in a browser, and printed.
 *
 * Deliberate properties:
 *
 *   - Self-contained. No CDN, no web fonts, no external images. A pentest report
 *     is read on client networks, in air-gapped review, and years after the
 *     engagement; a stylesheet that 404s turns a deliverable into a wall of
 *     unstyled text. Everything is inlined.
 *   - Safe. Body markdown goes through the same renderer the UI uses, which
 *     escapes all raw HTML and restricts links to http(s). Finding text embeds
 *     target-derived strings, so this is not a nicety.
 *   - Dark/light aware via prefers-color-scheme, with print rules that force
 *     light and drop interactive chrome, so "print to PDF" produces something
 *     worth sending without editing.
 *   - Severity colour-coded at the source. A reader scanning for the critical
 *     item should not have to read every line to find it.
 */
import { type Ctx } from "../context.js";
import { type Finding } from "../types.js";
export interface ReportMeta {
    engagementId: string;
    target: string;
    mode: string;
    environment: string;
    tier: number;
    operator?: string;
    client?: string;
    status: string;
    phase: string;
    verified: boolean;
    objective: string;
    startedAt: string;
    generatedAt: string;
    /** The recorded same-engine predecessor this report diffs against
     * (spec §1.2), when one exists. score/grade absent => the baseline
     * predates recorded scores and the diff renders counts-only. */
    baseline?: {
        engagementId: string;
        startedAt: string;
        score?: number;
        grade?: string;
    };
    /** Counts shown in the summary strip. */
    findings?: {
        critical: number;
        high: number;
        medium: number;
        low: number;
        info: number;
    };
    battery?: {
        total: number;
        confirmed: number;
        executedClean: number;
        killed: number;
        blocked: number;
        na: number;
        pending: number;
    };
}
export interface RenderHtmlOptions {
    /** Document title, shown as the page title and the H1. */
    title: string;
    /** Short line under the title. */
    subtitle?: string;
    meta: ReportMeta;
    /** The report body, as markdown. */
    markdown: string;
    /** Show the finding/battery summary strip. Off for attestation and manifests. */
    showStrip?: boolean;
}
/**
 * Build the metadata block shared by every HTML artifact, from the engagement
 * context. Severity counts are derived from the findings; battery figures are
 * passed in when the caller has them (the report does, the manifest does not).
 *
 * `ctx.events.state` is private; the snapshot getter is the supported read path
 * and copies findings so nothing here can mutate the live state.
 */
export declare function buildEngagementMeta(ctx: Ctx, findings: Finding[], battery?: ReportMeta["battery"]): ReportMeta;
export declare function renderReportHtml(o: RenderHtmlOptions): string;
