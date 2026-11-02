import { scoreGauge, severityBar } from './gauge.js';
import { severityRank } from './cards.js';
import { esc } from './tokens.js';
function signed(n) {
    return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}
function deltaClass(n, upIsGood) {
    if (n === 0)
        return 'd-flat';
    return n > 0 === upIsGood ? 'd-good' : 'd-bad';
}
/** Section 1 — the cover: SecScan's composition (target + summary meta on
 * the left, the score block on the right) in Seclayer's tokens. A halted
 * engagement renders the N/A gauge and states why it halted. */
export function coverSection(o) {
    const m = o.meta;
    const halted = typeof o.haltedReason === 'string' && o.haltedReason.length > 0;
    const blocked = typeof o.blockedReason === 'string' && o.blockedReason.length > 0;
    const ended = halted || blocked;
    const gauge = ended
        ? scoreGauge({ score: null, grade: 'N/A' })
        : scoreGauge({ score: o.posture.score, grade: o.posture.grade });
    const counts = ended
        ? `<div class="counts-line">engagement ${blocked ? 'blocked' : 'halted'}</div>`
        : `<div class="counts-line">${o.tierCounts.proven} proven · ${o.tierCounts.confirmed} confirmed · ${o.tierCounts.deferred} deferred</div>`;
    const statusPill = m.status === 'complete' ? 'ok' : m.status === 'halted' || m.status === 'blocked' ? 'bad' : '';
    const rows = [
        `<div><dt>Engagement</dt><dd>${esc(m.engagementId)}</dd></div>`,
        `<div><dt>Status</dt><dd><span class="pill ${statusPill}">${esc(m.status)}</span></dd></div>`,
        `<div><dt>Mode</dt><dd>${esc(m.mode)} · tier ${m.tier} · ${esc(m.environment)}</dd></div>`,
        `<div><dt>Authorisation</dt><dd>${m.verified ? '<span class="pill ok">ownership verified</span>' : '<span class="pill bad">not verified</span>'}</dd></div>`,
    ];
    if (m.operator)
        rows.push(`<div><dt>Operator</dt><dd>${esc(m.operator)}</dd></div>`);
    if (m.client)
        rows.push(`<div><dt>Client</dt><dd>${esc(m.client)}</dd></div>`);
    rows.push(`<div><dt>Started</dt><dd>${esc(m.startedAt)}</dd></div>`);
    rows.push(`<div><dt>Generated</dt><dd>${esc(m.generatedAt)}</dd></div>`);
    const eyebrow = 'SecScan RedTeam — Engagement Report' + (o.dryRun ? ' · Dry Run' : '') + (m.client ? ` · ${esc(m.client)}` : '');
    return (`<section class="cover">${brandRow()}<div class="eyebrow">${eyebrow}</div><div class="cover-grid">` +
        `<div class="cover-meta"><div class="target">${esc(m.target)}</div>` +
        (m.objective ? `<p class="objective">${esc(m.objective)}</p>` : '') +
        `<dl class="meta-grid">${rows.join('')}</dl></div>` +
        `<div class="score-block">${gauge}` +
        `<div class="posture-word">${ended ? 'Incomplete' : esc(o.posture.postureRating)}</div>` +
        severityBar(o.posture.findingsBySeverity) +
        counts +
        (o.delta && !ended
            ? '<div class="delta-line">' +
                (o.delta.scoreDelta !== undefined
                    ? `Δ score <span class="${deltaClass(o.delta.scoreDelta, true)}">${signed(o.delta.scoreDelta)}</span> · `
                    : '') +
                `Δ findings <span class="${deltaClass(o.delta.findingsDelta, false)}">${signed(o.delta.findingsDelta)}</span>` +
                ` since ${esc(o.delta.baselineLabel)}</div>`
            : '') +
        '</div></div></section>');
}
/** The SecScan RedTeam brand mark (the app icon's diamond and
 * crosshair), inlined so the standalone report file carries the brand
 * with no external asset. Artwork: apps/desktop/resources/icon.svg. */
export const BRAND_MARK_SVG = '<svg width="46" height="46" viewBox="0 0 1104 1104" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="SecScan RedTeam">' +
    '<g transform="translate(40 32)"><rect x="56" y="56" width="912" height="912" rx="225" fill="#0B1120"/>' +
    '<path fill="#CF2B4D" fill-rule="evenodd" d="M512 117L917 210L917 483L512 927L107 483L107 210Z M512 242L787 295L787 480L512 795L237 480L237 295Z"/>' +
    '<circle cx="512" cy="481" r="101" fill="none" stroke="#38BDF8" stroke-width="22"/>' +
    '<g fill="#38BDF8"><rect x="501" y="342" width="22" height="103"/><rect x="501" y="517" width="22" height="103"/><rect x="373" y="470" width="103" height="22"/><rect x="548" y="470" width="103" height="22"/><circle cx="512" cy="481" r="18"/></g></g></svg>';
/** The cover's brand row: the mark plus the SecScan RedTeam wordmark. */
function brandRow() {
    return (`<div class="brand-row">${BRAND_MARK_SVG}<div class="brand-words">` +
        '<div class="brand-name">SecScan <span>RedTeam</span></div>' +
        '<div class="brand-sub">Autonomous Red Team Operations</div></div></div>');
}
/** The engagement team: every fleet seat that ran, its role, and its
 * contribution — rendered after the posture banner. */
export function teamSection(team) {
    const cards = team.map(m => `<div class="team-card"><div class="team-agent">${esc(m.agent)}</div>` +
        `<div class="team-seat">${esc(m.seat)}</div>` +
        `<p class="team-role">${esc(m.role)}</p>` +
        (m.summary ? `<p class="team-summary">${esc(m.summary)}</p>` : '') +
        '</div>');
    return `<h2 class="sec-title">Engagement Team</h2><div class="team-grid">${cards.join('')}</div>`;
}
/** The halt banner: why the engagement stopped, in place of a grade. */
export function haltBanner(reason) {
    return ('<div class="banner critical"><h3>Engagement Halted</h3>' +
        `<p>${esc(reason)} Findings, coverage, and proof below are the runner-computed record of work completed up to the halt.</p></div>`);
}
/** The blocked banner: authorization denied before any testing ran —
 * the block is the headline and no grade is issued (Q-DELIVERABLES-AUTOFIRE P3). */
export function blockedBanner(reason) {
    return ('<div class="banner critical"><h3>Engagement Blocked</h3>' +
        `<p>${esc(reason)} Authorization was denied before any testing ran; this record of the block is the engagement's complete deliverable content.</p></div>`);
}
/** Section 2 — the posture banner: severity-proportioned, worst finding
 * named (the grading seam's bannerForPosture output, verbatim). */
export function bannerSection(banner) {
    const cls = banner.level === 'critical' ? 'critical' : banner.level === 'warning' ? 'warning' : 'notice';
    return `<div class="banner ${cls}"><h3>${esc(banner.title)}</h3><p>${esc(banner.message)}</p></div>`;
}
const CELL_WORD = { done: 'Probed', blocked: 'Blocked', missing: 'Not covered' };
/** Section 4 — the coverage strip: what was actually checked, cell by
 * cell, with the honest limits named. This is what makes a zero-finding
 * report credible. */
export function coverageSection(c) {
    const cells = c.cells
        .map(cell => `<div class="cell"><div class="ct">${esc(cell.target)}</div><div class="cn">${esc(cell.category)}</div>` +
        `<div class="cs ${cell.state}">${CELL_WORD[cell.state]}</div></div>`)
        .join('');
    const t = c.totals;
    const totals = t.total > 0
        ? `<p class="totals">${t.total} battery items: ${t.confirmed} confirmed · ${t.executedClean} executed-clean · ${t.killed} killed · ${t.blocked} blocked · ${t.na} not-applicable · ${t.pending} pending${c.probesUsed > 0 ? ` · ${c.probesUsed} probes` : ''}</p>`
        : c.probesUsed > 0
            ? `<p class="totals">${c.probesUsed} probes used</p>`
            : '';
    const limits = [];
    for (const cell of c.cells)
        if (cell.state === 'blocked')
            limits.push(`Blocked (prerequisite not met): ${cell.target}:${cell.category}`);
    for (const p of c.planOnly)
        limits.push(`Executes when its prerequisite is supplied: ${p}`);
    for (const n of c.notCovered)
        limits.push(`Not covered: ${n}`);
    const limitsHtml = limits.length
        ? `<h3>Honest limits</h3><ul class="limits">${limits.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
        : '';
    return ('<h2 class="sec-title">Coverage</h2>' +
        `<p class="sec-sub">${c.fullBattery ? 'Full battery' : 'Scoped run'} — every cell states what actually ran; nothing below is inferred.</p>` +
        (cells ? `<div class="cells">${cells}</div>` : '') +
        totals +
        limitsHtml);
}
/** The consolidated fix prompt text (Seclayer's Complete Fix Prompt
 * pattern): role framing once, then every actionable finding as a compact
 * section. Composed mechanically from the finding records — never by an
 * agent — so the prompt and the report can never drift apart. */
export function buildFixPrompt(target, findings, bundles) {
    const actionable = findings
        .filter(f => f.status === 'confirmed' && f.severity !== 'info')
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));
    if (actionable.length === 0)
        return '';
    const lines = [
        `You are fixing the security findings of an authorized penetration test against ${target}.`,
        'Work through the findings in order. For each one: apply the fix, then run the retest to confirm the issue no longer reproduces. Do not change behaviour beyond what each fix requires.',
        '',
    ];
    actionable.forEach((f, i) => {
        lines.push(`## ${i + 1}. [${f.severity.toUpperCase()}] ${f.title} (${f.id})`);
        if (f.attackIds.length)
            lines.push(`ATT&CK: ${f.attackIds.join(', ')}`);
        if (f.evidence)
            lines.push(`Evidence: ${f.evidence.slice(0, 400)}`);
        if (f.fix)
            lines.push(`Fix: ${f.fix}`);
        if (f.retest)
            lines.push(`Retest: ${f.retest}`);
        const b = bundles.get(f.id);
        if (b)
            lines.push(`Reverify: ${b.reverifyCommand}`);
        lines.push('');
    });
    return lines.join('\n').trimEnd();
}
/** Section 7 — the fix prompt panel: scrollable on screen, full in print. */
export function fixPromptSection(target, findings, bundles) {
    const text = buildFixPrompt(target, findings, bundles);
    if (!text)
        return '';
    return ('<h2 class="sec-title">Complete Fix Prompt</h2>' +
        '<p class="sec-sub">One consolidated, paste-ready prompt covering every actionable finding, composed from the records above.</p>' +
        '<button class="copybtn" data-copy="fixprompt" type="button">Copy fix prompt</button>' +
        `<pre class="fixprompt" id="fixprompt">${esc(text)}</pre>`);
}
/** Section 8 — tool activity + operator decisions + causality integrity,
 * projected from the audit log; the record, not a narrative about it. */
export function activitySection(a) {
    if (a.eventCount === 0)
        return '';
    const rows = a.rows
        .map(r => `<tr><td>${esc(r.action)}</td><td>${r.count}</td><td>${esc(r.attackIds.join(', ') || '—')}</td><td>${r.firstSeq}</td><td>${r.lastSeq}</td></tr>`)
        .join('');
    const more = a.totalActions > a.rows.length
        ? `<tr><td colspan="5">… ${a.totalActions - a.rows.length} more actions (see events.jsonl)</td></tr>`
        : '';
    const decisions = `Operator decisions recorded: ${a.decisions.length}` +
        (a.decisions.length ? ` — ${a.decisions.map(d => `${esc(d.action)} (seq ${d.seq})`).join(', ')}` : '');
    const causality = a.danglingCauses.length === 0
        ? 'Causality integrity: every causedBy link resolves.'
        : `Causality integrity: ${a.danglingCauses.length} dangling cause reference(s): seq ${a.danglingCauses.join(', ')}.`;
    return ('<h2 class="sec-title">Tool Activity</h2>' +
        `<p class="sec-sub">${a.eventCount} events across ${a.totalActions} distinct actions. ${decisions}. ${causality}</p>` +
        '<div class="tblwrap"><table class="act"><thead><tr><th>Action</th><th>Count</th><th>ATT&CK</th><th>First seq</th><th>Last seq</th></tr></thead>' +
        `<tbody>${rows}${more}</tbody></table></div>`);
}
/** The all-clear panel (Seclayer's pattern): a clean result is stated as
 * a result, with the coverage section above as its evidence. */
export function allClearSection() {
    return ('<div class="allclear"><h3>Zero Vulnerabilities Outstanding</h3>' +
        '<p>No confirmed findings this engagement. The coverage record above states what was actually checked.</p></div>');
}
/** Section 9 — artifacts & audit footer: the machine-readable records
 * alongside this file are authoritative for every figure shown. */
export function footerSection(meta) {
    return ('<footer class="doc">Artifacts: <code>report.md</code> · <code>item-verdicts.json</code> · ' +
        '<code>poc/*.json</code> · <code>compliance-pack.html</code> · <code>attestation.html</code> · ' +
        '<code>safety-manifest.html</code> · <code>state.json</code> · <code>events.jsonl</code>.<br>' +
        `Generated ${esc(meta.generatedAt)} by SecScan RedTeam from the engagement audit log. ` +
        'The machine-readable records are the authoritative source for every figure above — verify findings against them before acting.</footer>');
}
//# sourceMappingURL=sections.js.map