/**
 * SCRIBE GATE — the publisher seat's close-out review (Carlos's order,
 * 2026-11-01; spec: scribe-artifact-owner-spec-2026-11-01.md).
 *
 * At a completed close (never halted/blocked — those keep the
 * mechanical close), the Scribe re-reads its own finished deliverable
 * set against the report model and returns a structured verdict:
 *
 *  - sign    → the set is stamped `artifactSignoff` in the state record
 *              and report.json, and the package zip is re-fired so the
 *              shipped copy carries the stamp.
 *  - reject  → the defects are logged itemized (`artifact_rejected`),
 *              the mechanical formats are regenerated from the recorded
 *              state, the Scribe re-authors the HTML against its own
 *              defects, and the set is reviewed again — at most
 *              SCRIBE_MAX_CYCLES cycles (fleet knob, default 2).
 *  - exhausted / seat unavailable → the set ships UNSIGNED:
 *              `artifactUnsigned` carries the final defect list (or the
 *              unavailability reason) in state + report.json, in the
 *              same honesty class as `deliverableFailed` — it never
 *              reads as approved when it was not.
 *  - dry-run  → no review runs (a dry run has no agents to review
 *              with), but the close is still a completed close, so the
 *              set ships UNSIGNED with reason `dry-run` — exactly one
 *              stamp, as the deliverables contract requires.
 *
 * The gate never blocks the close and never fabricates a verdict: a
 * thrown provider error (after the chartered seam's own containment) or
 * an unparseable answer lands as `scribe_unavailable`, with the cause in
 * the event log. HaltError (a deliberate stop) rethrows untouched.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeErrorCause } from '@secscan/redteam-llm-router';
import { createCharteredComplete } from '../charter-completion.js';
import { HaltError } from '../context.js';
import { promptCtx } from '../agents.js';
import { publisherPrompt } from '../prompts.js';
import { tokenMeterFor } from '../harness2/trajectory-normalize.js';
import { bundleFileName } from '../proof/index.js';
import { DELIVERABLE_FILES, REPORT_JSON_NAME } from './deliverables.js';
import { regenerateReport } from './regenerate.js';
import { emitReportPackage } from './package.js';
import { rewriteAuthoredHtml } from './scribe-html.js';
import { parseScribeVerdict, scribeMaxCycles } from './scribe-verdict.js';
export { parseScribeVerdict, scribeMaxCycles } from './scribe-verdict.js';
/** The recorded report model in the engagement dir, or null when the
 * file is missing, unparseable, or not a report model. */
function readModel(dir) {
    const path = join(dir, REPORT_JSON_NAME);
    if (!existsSync(path))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return parsed?.kind === 'secscan-redteam-report' && Array.isArray(parsed.findings) ? parsed : null;
    }
    catch {
        return null;
    }
}
/** Read an artifact for the review brief, capped, with the truncation
 * (or the absence) stated in the text the seat reads. */
function readCapped(dir, name, cap) {
    const path = join(dir, name);
    if (!existsSync(path))
        return '(missing from the engagement directory)';
    const text = readFileSync(path, 'utf8');
    return text.length > cap ? `${text.slice(0, cap)}\n[truncated at ${cap} of ${text.length} bytes]` : text;
}
/**
 * The decisive PoC events for one finding, from its on-disk bundle
 * (poc/<finding-id>.json, written by the report phase before this gate
 * runs): the steps carrying a validation signal — the steps the
 * bundle's verdict rests on — rendered in the audit-event form
 * report/proof.ts uses for decisive events (result capped at 160).
 * A missing or unparseable bundle yields an empty string: the brief
 * carries no PoC claim for that finding rather than an invented one.
 *
 * @param dir - the engagement directory
 * @param findingId - the finding whose bundle to excerpt
 * @returns the excerpt lines, or "" when no bundle is on disk
 */
function pocExcerpt(dir, findingId) {
    try {
        const bundle = JSON.parse(readFileSync(join(dir, 'poc', bundleFileName(findingId)), 'utf8'));
        const decisive = (bundle.steps ?? []).filter(s => s.validation !== 'none');
        if (decisive.length === 0)
            return '';
        return (`\n  PoC (${bundle.validationTier} tier, poc/${bundleFileName(findingId)}): ${bundle.proves.slice(0, 500)}` +
            `\n  Decisive PoC events: ${decisive.map(e => `seq ${e.seq} ${e.tool}: ${e.result.slice(0, 160)}`).join(' | ')}`);
    }
    catch {
        return '';
    }
}
/** The review brief: the model of truth, then the artifacts themselves. */
function reviewMessages(ctx, dir, model) {
    const user = 'Review the finished deliverable set — Step 3 of your instructions. Read every artifact below against the report model, then answer with the verdict JSON only.\n\n' +
        `REPORT MODEL (the record of truth): engagement ${model.engagementId}, target ${model.target}, status ${model.status}, ` +
        `grade ${model.grade ? `${model.grade.letter} (${model.grade.score}/100, ${model.grade.rating})` : 'N/A'}, ` +
        `severity counts ${JSON.stringify(model.severityCounts)}, ${model.findingCount} findings, battery totals ${JSON.stringify(model.batteryTotals)}` +
        `${model.sections ? `, document sections: ${model.sections.join(', ')}` : ''}.\n` +
        `Findings of record:\n${model.findings.map(f => `- [${f.severity}] ${f.title}\n  Evidence of record: ${f.evidence.slice(0, 500)}${pocExcerpt(dir, f.id)}`).join('\n') || '(none)'}\n\n` +
        `The deliverable set is: ${DELIVERABLE_FILES.join(', ')}. report.docx and ${DELIVERABLE_FILES[DELIVERABLE_FILES.length - 1]} are binary, rendered from the same document as report.md — judge them by it.\n\n` +
        `=== report.md ===\n${readCapped(dir, 'report.md', 12000)}\n\n` +
        `=== report.txt ===\n${readCapped(dir, 'report.txt', 6000)}\n\n` +
        `=== findings.csv ===\n${readCapped(dir, 'findings.csv', 6000)}\n\n` +
        `=== report.html (the presenting artifact — judge craft against the design standard) ===\n${readCapped(dir, 'report.html', 24000)}`;
    return [
        { role: 'system', content: publisherPrompt(promptCtx(ctx)) },
        { role: 'user', content: user },
    ];
}
/** Merge a signoff/unsigned stamp into report.json on disk. A missing
 * or unparseable file is left alone — the state stamp still lands and
 * the deliverable verification names the gap. */
function stampReportJson(dir, patch) {
    const path = join(dir, REPORT_JSON_NAME);
    try {
        const model = JSON.parse(readFileSync(path, 'utf8'));
        if (patch.artifactSignoff !== undefined)
            model.artifactSignoff = patch.artifactSignoff;
        if (patch.artifactUnsigned !== undefined)
            model.artifactUnsigned = patch.artifactUnsigned;
        writeFileSync(path, `${JSON.stringify(model, null, 2)}\n`);
    }
    catch {
        /* the state record carries the stamp regardless */
    }
}
function stampSignoff(ctx, cycles) {
    const signoff = { by: 'scribe', at: new Date().toISOString(), cycles };
    ctx.events.updateState({ artifactSignoff: signoff, artifactUnsigned: null });
    stampReportJson(ctx.events.dir, { artifactSignoff: signoff, artifactUnsigned: null });
    emitReportPackage(ctx);
    ctx.events.append({
        phase: 'report',
        actor: 'publisher',
        action: 'artifact_signed',
        result: `Scribe signed the deliverable set after ${cycles} review cycle(s): claims traced to the record, counts reconciled across formats, set complete, HTML at the design standard.`,
    });
}
function stampUnsigned(ctx, unsigned, cause) {
    ctx.events.updateState({ artifactSignoff: null, artifactUnsigned: unsigned });
    stampReportJson(ctx.events.dir, { artifactSignoff: null, artifactUnsigned: unsigned });
    emitReportPackage(ctx);
    ctx.events.append({
        phase: 'report',
        actor: 'runner',
        action: 'artifact_unsigned',
        result: `Deliverable set shipped UNSIGNED (${unsigned.reason}) after ${unsigned.cycles} cycle(s) — ${cause}` +
            (unsigned.defects.length > 0
                ? ` Open defects: ${unsigned.defects.map(d => `[${d.class}] ${d.file}: ${d.detail}`).join('; ')}`
                : ''),
    });
}
/**
 * The Scribe gate: review the closing deliverable set, sign it, or
 * reject-and-rewrite within the cycle budget, else ship it unsigned.
 * Runs only at a completed close; a dry run stamps the set UNSIGNED
 * (reason `dry-run`, no review) and returns, and halted/blocked ends
 * never reach it (their close stays mechanical).
 *
 * @param ctx - the engagement context, after the report phase
 * @param opts - test seam: the regeneration step (defaults to
 *   {@link regenerateReport} over the engagement directory)
 * @returns the gate outcome; never throws except a rethrown HaltError
 */
export async function scribeGate(ctx, opts = {}) {
    if (ctx.config.dryRunAgents) {
        // S6-H2b: a dry run closes as "complete", and the deliverables
        // contract stamps exactly one of signoff/unsigned on a completed
        // close — so the dry-run branch stamps the unsigned record through
        // the same stamp the other unsigned paths use (state + report.json
        // + the package zip re-fire), instead of returning stamp-free.
        stampUnsigned(ctx, { reason: 'dry-run', defects: [], cycles: 0, at: new Date().toISOString() }, 'a dry run runs no review seat.');
        return { signed: false, cycles: 0, reason: 'dry-run' };
    }
    const dir = ctx.events.dir;
    const maxCycles = scribeMaxCycles();
    const regenerate = opts.regenerate ?? ((d) => { regenerateReport(d); });
    const complete = ctx.deps.completeForRole ?? createCharteredComplete(ctx, 'report');
    const unavailable = (cycles, cause) => {
        stampUnsigned(ctx, { reason: 'scribe_unavailable', defects: [], cycles, at: new Date().toISOString() }, cause);
        return { signed: false, cycles, reason: 'scribe_unavailable' };
    };
    let lastDefects = [];
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
        const model = readModel(dir);
        if (!model)
            return unavailable(cycle, `${REPORT_JSON_NAME} is missing or unparseable — there is no model of truth to review the set against.`);
        let verdict;
        try {
            const res = await complete('reporter', reviewMessages(ctx, dir, model), {
                tools: [],
                responseFormat: { type: 'json_object' },
            });
            tokenMeterFor(ctx).record(res.usage);
            verdict = parseScribeVerdict(res.text);
        }
        catch (err) {
            if (err instanceof HaltError)
                throw err;
            return unavailable(cycle, `the review call failed: ${describeErrorCause(err)}.`);
        }
        if (!verdict)
            return unavailable(cycle, 'the seat answered no parseable verdict — no signature was fabricated.');
        if (verdict.verdict === 'sign') {
            stampSignoff(ctx, cycle);
            return { signed: true, cycles: cycle };
        }
        lastDefects = verdict.defects;
        ctx.events.append({
            phase: 'report',
            actor: 'publisher',
            action: 'artifact_rejected',
            result: `Scribe rejected the deliverable set (cycle ${cycle}/${maxCycles}): ` +
                verdict.defects.map(d => `[${d.class}] ${d.file}: ${d.detail} (fix: ${d.fix})`).join('; '),
        });
        if (cycle === maxCycles)
            break;
        // Repair: the mechanical formats regenerate from the recorded state,
        // then the seat re-authors the presenting artifact against its defects.
        try {
            regenerate(dir);
        }
        catch (err) {
            ctx.events.append({
                phase: 'report',
                actor: 'runner',
                action: 'scribe_regenerate_failed',
                result: `Regeneration after the Scribe's rejection failed: ${err.message} — the set goes back for review as it stands.`,
            });
        }
        try {
            const modelNow = readModel(dir);
            const currentHtml = existsSync(join(dir, 'report.html')) ? readFileSync(join(dir, 'report.html'), 'utf8') : '';
            const rewritten = modelNow ? await rewriteAuthoredHtml(ctx, { model: modelNow, currentHtml, defects: lastDefects }) : null;
            if (rewritten) {
                writeFileSync(join(dir, 'report.html'), rewritten);
                ctx.events.append({
                    phase: 'report',
                    actor: 'publisher',
                    action: 'scribe_html_rewritten',
                    result: `Scribe re-authored report.html against its defect list (${rewritten.length} bytes, gates passed).`,
                });
            }
            else {
                ctx.events.append({
                    phase: 'report',
                    actor: 'runner',
                    action: 'scribe_rewrite_failed',
                    result: "The Scribe's HTML rewrite did not pass the mechanical gates — the regenerated page stands for the next review.",
                });
            }
        }
        catch (err) {
            if (err instanceof HaltError)
                throw err;
            ctx.events.append({
                phase: 'report',
                actor: 'runner',
                action: 'scribe_rewrite_failed',
                result: `The Scribe's HTML rewrite failed: ${describeErrorCause(err)} — the regenerated page stands for the next review.`,
            });
        }
    }
    stampUnsigned(ctx, { reason: 'defects', defects: lastDefects, cycles: maxCycles, at: new Date().toISOString() }, 'the defect list was not cleared within the cycle budget.');
    return { signed: false, cycles: maxCycles, reason: 'defects' };
}
//# sourceMappingURL=scribe.js.map