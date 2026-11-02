import { type Ctx } from "../context.js";
import { type ScribeDefect } from "../events.js";
import { type ReportModel } from "./deliverables.js";
import { type EngagementReportInput } from "./html/render.js";
/** The facts the authored page must reconcile with: the engagement
 * target and the findings of record. Both the phase's report input and
 * the recorded report model satisfy this shape. */
export interface HtmlRecordFacts {
    target: string;
    findings: readonly {
        title: string;
    }[];
}
/**
 * Extract one complete HTML document from the seat's answer: a fenced
 * ```html block when present, else the span from the doctype to the
 * closing tag. Anything else (prose, a fragment, a truncated page) is
 * null — the caller falls back rather than ship a partial page.
 *
 * @param text - the completion text
 * @returns the authored HTML document, or null when none is present
 */
export declare function extractAuthoredHtml(text: string): string | null;
/**
 * The mechanical gates an authored page must pass before it may ship:
 * a complete document of substance, fully self-contained (no external
 * asset of any kind — the file must survive zipping and emailing),
 * every finding title from the record present, and the target named.
 *
 * @param html - the authored HTML document
 * @param facts - the record facts the page must reconcile with
 * @returns the gate defects; empty when the page passes
 */
export declare function gateAuthoredHtml(html: string, facts: HtmlRecordFacts): string[];
/**
 * Resolve the HTML for the report phase: the Scribe's authored page
 * when the seat answers and the page passes the mechanical gates, the
 * mechanical renderer's page otherwise (and always for dry runs and
 * halted/blocked ends).
 *
 * @param ctx - the engagement context
 * @param input - the report input the phase assembled
 * @returns the report.html content to write
 */
export declare function resolveReportHtml(ctx: Ctx, input: EngagementReportInput): Promise<string>;
/**
 * The gate loop's rewrite step: the Scribe re-authors the presenting
 * artifact against its own itemized defects, from the recorded model
 * and the current page. Returns the gated replacement page, or null
 * when the rewrite fails its gates or the seat cannot answer — the
 * caller keeps the current (regenerated) page either way.
 *
 * @param ctx - the engagement context
 * @param args - the recorded model, the current report.html, and the
 *   defects the rewrite must fix
 * @returns the replacement HTML, or null
 */
export declare function rewriteAuthoredHtml(ctx: Ctx, args: {
    model: ReportModel;
    currentHtml: string;
    defects: readonly ScribeDefect[];
}): Promise<string | null>;
