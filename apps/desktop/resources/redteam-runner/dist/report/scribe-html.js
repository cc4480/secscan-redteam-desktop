/**
 * SCRIBE HTML authoring (Carlos's order, 2026-11-01) — the publisher
 * seat authors report.html itself: one self-contained, animated HTML
 * document written by the Scribe from the approved report input, under
 * the locked html-report-design standard its prompt carries.
 *
 * The authored page is never trusted on the seat's say-so: it must pass
 * the mechanical gates in {@link gateAuthoredHtml} (complete document,
 * no external assets, every finding title from the record present, the
 * target named) before it replaces anything. Any failure — a thrown
 * provider error, an unparseable answer, a gated defect — falls back to
 * the mechanical renderer (html/render.ts) and records the fallback as
 * an event; the report is never lost because the seat had a bad turn.
 * HaltError (a deliberate stop) rethrows untouched.
 *
 * Dry runs and halted/blocked ends never call the seat: their HTML is
 * the mechanical record, exactly as before this seat existed.
 */
import { describeErrorCause } from "@secscan/redteam-llm-router";
import { createCharteredComplete } from "../charter-completion.js";
import { HaltError } from "../context.js";
import { promptCtx } from "../agents.js";
import { publisherPrompt } from "../prompts.js";
import { tokenMeterFor } from "../harness2/trajectory-normalize.js";
import { renderEngagementReportHtml } from "./html/render.js";
import { stripFindingsJson } from "./html/wire.js";
/**
 * Extract one complete HTML document from the seat's answer: a fenced
 * ```html block when present, else the span from the doctype to the
 * closing tag. Anything else (prose, a fragment, a truncated page) is
 * null — the caller falls back rather than ship a partial page.
 *
 * @param text - the completion text
 * @returns the authored HTML document, or null when none is present
 */
export function extractAuthoredHtml(text) {
    const fenced = text.match(/```html\s*\n([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : text;
    const start = raw.search(/<!DOCTYPE html/i);
    const altStart = start >= 0 ? start : raw.search(/<html[\s>]/i);
    if (altStart < 0)
        return null;
    const end = raw.lastIndexOf("</html>");
    if (end < altStart)
        return null;
    const doc = raw.slice(altStart, end + "</html>".length).trim();
    return /<!DOCTYPE html/i.test(doc) && doc.length >= 500 ? doc : null;
}
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
export function gateAuthoredHtml(html, facts) {
    const defects = [];
    if (html.length < 2000)
        defects.push(`page is ${html.length} bytes — too thin to carry the report`);
    if (!/<\/html>\s*$/.test(html))
        defects.push("document does not close with </html>");
    if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(html) || /url\(\s*["']?https?:\/\//i.test(html) || /@import/i.test(html)) {
        defects.push("external asset reference — the page must be fully self-contained");
    }
    for (const f of facts.findings) {
        if (!html.includes(f.title))
            defects.push(`finding missing from the page: "${f.title}"`);
    }
    if (!html.includes(facts.target))
        defects.push(`target ${facts.target} is not named on the page`);
    return defects;
}
/** The authoring brief: the approved record the page is written from —
 * the same facts the mechanical renderer renders, so the two can be
 * reconciled by construction. */
function authoringBrief(input) {
    const counts = input.posture.findingsBySeverity;
    const totals = input.coverage.totals;
    return (`Author the report HTML now — Step 2 of your instructions. The record below is the whole of your material: every number on the page must match it, every finding must appear with its evidence and fix, and nothing may be invented.\n\n` +
        `Target: ${input.meta.target}\nMode: ${input.meta.mode}\nObjective: ${input.meta.objective}\n` +
        `Anchored grade: ${input.posture.grade} (${input.posture.score}/100, ${input.posture.postureRating})\n` +
        `Severity counts: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.info} info — ${input.findings.length} findings total.\n` +
        `Battery totals: ${totals.total} items — ${totals.confirmed} confirmed, ${totals.executedClean} executed-clean, ${totals.killed} killed, ${totals.blocked} blocked, ${totals.na} not-applicable, ${totals.pending} pending.\n\n` +
        `Findings of record:\n${input.findings.map((f) => `- [${f.severity}] ${f.title}\n  Evidence: ${f.evidence}\n  Fix: ${f.fix}`).join("\n") || "(none — render the all-clear state honestly)"}\n\n` +
        `Narrative (the approved report document — the executive story the page tells):\n${stripFindingsJson(input.narrativeMd).slice(0, 12000)}\n\n` +
        `Anatomy, in order: cover with the animated grade gauge and score count-up; executive summary; severity overview; findings; battery coverage with the totals above; honest limits; footer naming the target and the grade.`);
}
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
export async function resolveReportHtml(ctx, input) {
    const mechanical = () => renderEngagementReportHtml(input);
    if (ctx.config.dryRunAgents || input.haltedReason || input.blockedReason)
        return mechanical();
    try {
        const complete = ctx.deps.completeForRole ?? createCharteredComplete(ctx, "report");
        const res = await complete("reporter", [
            { role: "system", content: publisherPrompt(promptCtx(ctx)) },
            { role: "user", content: authoringBrief(input) },
        ], { tools: [] });
        tokenMeterFor(ctx).record(res.usage);
        const html = extractAuthoredHtml(res.text);
        const defects = html ? gateAuthoredHtml(html, { target: input.meta.target, findings: input.findings }) : ["no complete HTML document in the answer"];
        if (!html || defects.length > 0) {
            ctx.events.append({
                phase: "report",
                actor: "runner",
                action: "scribe_html_fallback",
                result: `Scribe-authored HTML failed the mechanical gates (${defects.join("; ")}) — the mechanical renderer produced report.html.`,
            });
            return mechanical();
        }
        ctx.events.append({
            phase: "report",
            actor: "publisher",
            action: "scribe_html_authored",
            result: `report.html authored by the Scribe (${html.length} bytes, self-contained) and passed the mechanical gates — all ${input.findings.length} finding titles present, no external assets.`,
        });
        return html;
    }
    catch (err) {
        if (err instanceof HaltError)
            throw err;
        ctx.events.append({
            phase: "report",
            actor: "runner",
            action: "scribe_html_fallback",
            result: `Scribe HTML authoring unavailable (${describeErrorCause(err)}) — the mechanical renderer produced report.html.`,
        });
        return mechanical();
    }
}
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
export async function rewriteAuthoredHtml(ctx, args) {
    const { model, defects } = args;
    const brief = `Rewrite the report HTML — your review rejected the finished set, and the presenting artifact is yours to fix. Answer with ONE fenced \`\`\`html block holding the complete corrected document, per Step 2 of your instructions.\n\n` +
        `Defects to fix:\n${defects.map((d) => `- [${d.class}] ${d.file}: ${d.detail} — fixed looks like: ${d.fix}`).join("\n")}\n\n` +
        `The record of truth (report model): target ${model.target}, grade ${model.grade ? `${model.grade.letter} (${model.grade.score}/100)` : "N/A"}, ` +
        `severity counts ${JSON.stringify(model.severityCounts)}, ${model.findingCount} findings:\n` +
        `${model.findings.map((f) => `- [${f.severity}] ${f.title}\n  Evidence: ${f.evidence}\n  Fix: ${f.fix}`).join("\n") || "(none)"}\n\n` +
        `The current page (rewrite it whole — do not patch):\n${args.currentHtml.slice(0, 30000)}`;
    const messages = [
        { role: "system", content: publisherPrompt(promptCtx(ctx)) },
        { role: "user", content: brief },
    ];
    const complete = ctx.deps.completeForRole ?? createCharteredComplete(ctx, "report");
    const res = await complete("reporter", messages, { tools: [] });
    tokenMeterFor(ctx).record(res.usage);
    const html = extractAuthoredHtml(res.text);
    if (!html)
        return null;
    return gateAuthoredHtml(html, { target: model.target, findings: model.findings }).length === 0 ? html : null;
}
//# sourceMappingURL=scribe-html.js.map