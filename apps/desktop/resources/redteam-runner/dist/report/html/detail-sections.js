import { severityChip } from "./cards.js";
import { severityBar } from "./gauge.js";
import { esc } from "./tokens.js";
/** §3 — the detailed executive breakdown: deterministic lines, in order. */
export function breakdownSection(d) {
    if (d.breakdown.length === 0)
        return "";
    return (`<h2 class="sec-title">Detailed Executive Breakdown</h2>` +
        `<div class="breakdown">${d.breakdown.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`);
}
function diffList(entries, mark, cls) {
    if (entries.length === 0)
        return "";
    const items = entries
        .map((e) => {
        const change = e.fromSeverity && e.fromSeverity !== e.severity
            ? ` <span class="diff-note">${esc(e.fromSeverity)} → ${esc(e.severity)}</span>`
            : e.fromTier && e.toTier && e.fromTier !== e.toTier
                ? ` <span class="diff-note">${esc(e.fromTier)} → ${esc(e.toTier)}</span>`
                : "";
        const note = e.note ? ` <span class="diff-note">${esc(e.note)}</span>` : "";
        return (`<li><span class="mk ${cls}">${mark}</span>${severityChip(e.severity)}` +
            `<span>${esc(e.title)}</span>${change}${note}</li>`);
    })
        .join("");
    return `<ul class="diff-list">${items}</ul>`;
}
/** §2 — what changed against the recorded same-engine predecessor, or
 * the designed no-baseline panel (§2.4, verbatim) when none exists. */
export function whatChangedSection(d, target) {
    const head = `<h2 class="sec-title">What Changed</h2>`;
    if (!d.diff || !d.baselineLabel) {
        return (head +
            `<div class="panelbox"><p>First recorded scan of this target by this engine — ` +
            `there is no earlier scan to diff against. This report is the baseline: ` +
            `the next scan of ${esc(target)} will be diffed against it.</p></div>`);
    }
    const diff = d.diff;
    const counts = `<p class="diff-counts">${diff.newFindings.length} new · ${diff.resolved.length} resolved · ` +
        `${diff.worsened.length} worsened` +
        (diff.improved.length > 0 ? ` · ${diff.improved.length} improved` : "") +
        `</p>`;
    const findingsDelta = `Δ findings ${diff.findingsDelta > 0 ? `+${diff.findingsDelta}` : diff.findingsDelta < 0 ? `−${-diff.findingsDelta}` : "0"}`;
    const deltas = d.countsOnly
        ? `<p class="diff-counts">${findingsDelta}</p>` +
            `<p class="diff-note">The baseline engagement predates recorded scores — score delta omitted.</p>`
        : `<p class="diff-counts">Δ score ${diff.scoreDelta !== undefined ? (diff.scoreDelta > 0 ? `+${diff.scoreDelta}` : diff.scoreDelta < 0 ? `−${-diff.scoreDelta}` : "0") : "—"}` +
            ` · ${findingsDelta}</p>`;
    const groups = [];
    if (diff.newFindings.length)
        groups.push(`<h3 class="diff-group">New</h3>` + diffList(diff.newFindings, "+", "mk-new"));
    if (diff.resolved.length)
        groups.push(`<h3 class="diff-group">Resolved</h3>` + diffList(diff.resolved, "−", "mk-resolved"));
    const changed = [...diff.worsened, ...diff.improved];
    if (changed.length) {
        groups.push(`<h3 class="diff-group">Changed</h3>` +
            diffList(diff.worsened, "▲", "mk-worsened") +
            diffList(diff.improved, "▼", "mk-improved"));
    }
    return head + `<p class="sec-sub">Since ${esc(d.baselineLabel)}</p>` + counts + deltas + groups.join("");
}
/** §4 — key risk areas: one card per non-empty area; omitted entirely
 * when there are zero actionable findings (§4.5). */
export function riskAreasSection(d) {
    if (d.actionableCount === 0 || d.riskAreas.length === 0)
        return "";
    const cards = d.riskAreas
        .map((a) => {
        const rows = a.findings
            .map((f) => `<li>${severityChip(f.severity)}<a href="#finding-${esc(f.id)}">${esc(f.title)}</a>` +
            `<span class="card-id">${esc(f.id)}</span></li>`)
            .join("");
        return (`<div class="cell"><div class="cn">${esc(a.name)}</div>` +
            `<div class="area-count">${a.findings.length} finding${a.findings.length === 1 ? "" : "s"} · worst ${severityChip(a.worst)}</div>` +
            `<ul class="area-rows">${rows}</ul></div>`);
    })
        .join("");
    const deferred = d.deferredCount > 0
        ? `<p class="deferred-line">${d.deferredCount} deferred item${d.deferredCount === 1 ? "" : "s"} await verification — listed under Findings.</p>`
        : "";
    return `<h2 class="sec-title">Key Risk Areas</h2><div class="cells">${cards}</div>` + deferred;
}
const IMPACT_CLASS = {
    critical: "critical",
    high: "warning",
    medium: "warning",
    low: "notice",
    none: "notice",
};
/** §5 — the business-impact band: the fixed statement table's selected
 * row, composed in detail.ts; the class follows its level. */
export function impactSection(d) {
    return (`<h2 class="sec-title">Business Impact</h2>` +
        `<div class="banner ${IMPACT_CLASS[d.impact.level]}"><p>${esc(d.impact.text)}</p></div>`);
}
/** §6 — priority actions, ranked in detail.ts; deferred findings follow
 * as the "Verify next" sub-list. */
export function prioritySection(d) {
    const head = `<h2 class="sec-title">Priority Actions</h2>`;
    if (d.priority.zeroNote) {
        return head + `<ol class="priority"><li><span class="pri-rank">1.</span><span><strong>No action required</strong> — ${esc(d.priority.zeroNote)}</span></li></ol>`;
    }
    const entry = (verb) => (e, i) => `<li><span class="pri-rank">${i + 1}.</span>${severityChip(e.severity)}` +
        `<span><strong>${verb} ${esc(e.id)} — ${esc(e.title)}.</strong> ` +
        `<span class="pri-fix">${esc(e.fixSentence)}</span></span></li>`;
    const actions = d.priority.actions.length
        ? `<ol class="priority">${d.priority.actions.map(entry("Fix")).join("")}</ol>`
        : "";
    const verify = d.priority.verifyNext.length
        ? `<h3 class="diff-group">Verify next</h3><ol class="priority">${d.priority.verifyNext.map(entry("Verify")).join("")}</ol>`
        : "";
    if (!actions && !verify)
        return "";
    return head + actions + verify;
}
const PILLAR_STATUS_CLASS = {
    "NO ARM": "noarm",
    "NOT COVERED": "notcovered",
    FINDINGS: "findings",
    SECURE: "secure",
    MAPPED: "mapped",
    "NO DATA": "nodata",
};
/** §7 — per-pillar cards: always all seven, in the fixed order; a
 * pillar's status word and counts come from detail.ts's single-primary
 * attribution, so the counts reconcile to the cover total. */
export function pillarSection(d) {
    const cards = d.pillars
        .map((p) => {
        const status = esc(p.status) + (p.status === "FINDINGS" ? ` ${p.findingCount}` : "");
        const bar = p.findingCount > 0
            ? severityBar(p.bySeverity)
            : "";
        const reason = p.reason ? `<div class="pillar-reason">${esc(p.reason)}</div>` : "";
        const foot = p.footnote ? `<div class="pillar-foot">${esc(p.footnote)}</div>` : "";
        return (`<div class="cell pillar"><div class="ct">${esc(p.scopeLabel)}</div>` +
            `<div class="cn">${esc(p.pillar)}</div>` +
            `<div class="pillar-status ${PILLAR_STATUS_CLASS[p.status] ?? "nodata"}">${status}</div>` +
            bar + reason + foot + `</div>`);
    })
        .join("");
    return `<h2 class="sec-title">Pillar Coverage</h2><div class="cells">${cards}</div>`;
}
function well(title, rows) {
    const body = rows
        .map((r) => `<div class="wrow"><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`)
        .join("");
    return `<div class="well"><h3>${esc(title)}</h3><dl>${body}</dl></div>`;
}
/** §8 — surface & coverage detail wells, immediately after the coverage
 * strip. The network well renders only when recon recorded surface
 * facts; an empty block would fabricate a surface record. */
export function surfaceSection(d) {
    const wells = [];
    if (d.surfaceNetwork && d.surfaceNetwork.length > 0) {
        wells.push(well("Network & Attack Surface", d.surfaceNetwork));
    }
    if (d.surfaceDynamic.length > 0) {
        wells.push(well("Dynamic Coverage", d.surfaceDynamic));
    }
    if (wells.length === 0)
        return "";
    return `<h2 class="sec-title">Surface &amp; Coverage Detail</h2><div class="wells">${wells.join("")}</div>`;
}
//# sourceMappingURL=detail-sections.js.map