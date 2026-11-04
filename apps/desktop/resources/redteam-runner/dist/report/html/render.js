import { renderMarkdown } from '../../ui/markdown.js';
import { renderHtmlDocument } from "./shell.js";
import { severityChips } from './gauge.js';
import { findingCard, negativeProofCard } from './cards.js';
import { buildReportDocument } from '../document.js';
import { activitySection, allClearSection, bannerSection, blockedBanner, coverSection, coverageSection, fixPromptSection, footerSection, haltBanner, teamSection, } from './sections.js';
import { TIER_DEFINITION, TIER_LABEL } from './tokens.js';
import { limitationsSection, methodSection, riskMethodSection, scopeSection, strengthsSection, } from './matter-sections.js';
import { breakdownSection, impactSection, pillarSection, prioritySection, riskAreasSection, surfaceSection, whatChangedSection, } from './detail-sections.js';
import { inventorySection } from './inventory-sections.js';
/** Render one tier group of the shared report document: finding cards
 * in report order, then the group's negative-proof cards (ruled-out
 * tier). The grouping itself — tiers, ordering, negative-proof
 * de-duplication — is the document's (report/document.ts), so every
 * format groups identically. */
function tierGroupHtml(o, group) {
    const cards = group.findings.map(f => findingCard({
        finding: f,
        bundle: o.bundles.get(f.id),
        noBundleReason: o.noBundleReasons.get(f.id),
        meta: o.findingMeta.get(f.id),
        impact: o.detail?.findingImpacts[f.id],
    }));
    for (const n of group.negativeProof)
        cards.push(negativeProofCard(n));
    return (`<h3 class="tier-head">${TIER_LABEL[group.tier]} — ${cards.length}</h3>` +
        `<p class="tier-def">${TIER_DEFINITION[group.tier]}</p>` +
        cards.join(''));
}
export function renderEngagementReportHtml(o) {
    // The sections render from the ONE shared report document
    // (report/document.ts) in its canonical order — the same model the
    // markdown, JSON, TXT, CSV, and DOCX renderers consume, so no format
    // can drift from the flagship's structure or counts.
    const doc = buildReportDocument(o);
    const counts = doc.tierCounts;
    const halted = typeof o.haltedReason === 'string' && o.haltedReason.length > 0;
    const blocked = typeof o.blockedReason === 'string' && o.blockedReason.length > 0;
    const activeCount = counts.proven + counts.confirmed + counts.deferred;
    const parts = [];
    const d = o.detail;
    // The cover carries live deltas only when the baseline diff carries a
    // numeric score delta (a counts-only baseline renders none anywhere).
    const coverDelta = d && d.diff && d.diff.scoreDelta !== undefined && o.meta.baseline
        ? {
            scoreDelta: d.diff.scoreDelta,
            findingsDelta: d.diff.findingsDelta,
            baselineLabel: o.meta.baseline.startedAt.slice(0, 10),
        }
        : undefined;
    parts.push(coverSection({ meta: o.meta, posture: o.posture, tierCounts: counts, haltedReason: o.haltedReason, blockedReason: o.blockedReason, dryRun: o.dryRun, delta: coverDelta }));
    if (halted)
        parts.push(haltBanner(o.haltedReason));
    else if (blocked)
        parts.push(blockedBanner(o.blockedReason));
    else if (o.banner)
        parts.push(bannerSection(o.banner));
    if (o.team && o.team.length > 0)
        parts.push(teamSection(o.team));
    const narrative = o.narrativeMd.trim();
    if (narrative) {
        parts.push(`<h2 class="sec-title">Executive Summary</h2><div class="prose">${renderMarkdown(narrative)}</div>`);
    }
    // The detail derivations ride inside the executive-summary segment:
    // breakdown, what changed (real predecessors only), risk areas,
    // business impact.
    if (d) {
        parts.push(breakdownSection(d));
        parts.push(whatChangedSection(d, o.meta.target));
        if (d.riskAreas.length > 0)
            parts.push(riskAreasSection(d));
        parts.push(impactSection(d));
    }
    parts.push(coverageSection(o.coverage));
    parts.push(severityChips(doc.severityCounts) +
        `<p class="accuracy">${counts.proven} proven · ${counts.confirmed} confirmed · ${counts.deferred} deferred · ${counts['ruled-out']} ruled out</p>`);
    parts.push('<h2 class="sec-title">Findings</h2>');
    if (activeCount === 0 && !halted && !blocked)
        parts.push(allClearSection());
    for (const g of doc.tierGroups)
        parts.push(tierGroupHtml(o, g));
    parts.push(fixPromptSection(o.meta.target, o.findings, o.bundles));
    if (d) {
        parts.push(prioritySection(d));
        parts.push(pillarSection(d));
    }
    if (o.matter)
        parts.push(strengthsSection(o.matter));
    if (d)
        parts.push(surfaceSection(d));
    const inventoryHtml = inventorySection(o.inventory);
    if (inventoryHtml)
        parts.push(inventoryHtml);
    parts.push(activitySection(o.activity));
    // The recorded frame (scope, authorisation, method, grading method)
    // and the limitations close the report as back matter — the RC6
    // exemplar's order — before the audit footer.
    if (o.matter) {
        parts.push(scopeSection(o.matter));
        parts.push(methodSection(o.matter));
        parts.push(riskMethodSection(o.matter));
        parts.push(limitationsSection(o.matter));
    }
    parts.push(footerSection(o.meta));
    return renderHtmlDocument({ title: `${o.title} — ${o.meta.target}`, body: parts.join('\n') });
}
//# sourceMappingURL=render.js.map