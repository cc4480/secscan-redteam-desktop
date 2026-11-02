import { severityRank, tierOf } from './html/cards.js';
import { buildFixPrompt } from './html/sections.js';
import { TIER_ORDER } from './html/tokens.js';
/** The canonical anatomy, in order. Every renderer's section sequence
 * is a subsequence of this list; `sections` on the document names the
 * ones the record actually carries. */
export const REPORT_SECTION_ORDER = [
    'cover',
    'banner',
    'team',
    'executive-summary',
    'coverage',
    'severity-breakdown',
    'findings',
    'fix-prompt',
    'priority-actions',
    'pillars',
    'strengths',
    'surface',
    'inventory',
    'activity',
    'recorded-frame',
    'limitations',
    'footer',
];
const norm = (s) => s.trim().toLowerCase();
function tierGroupsOf(o) {
    const byTier = new Map();
    for (const f of o.findings) {
        const tier = tierOf(f, o.bundles.get(f.id));
        const list = byTier.get(tier) ?? [];
        list.push(f);
        byTier.set(tier, list);
    }
    const killedTitles = new Set((byTier.get('ruled-out') ?? []).map(f => norm(f.title)));
    const extraNegatives = o.negativeProof.filter(n => !killedTitles.has(norm(n.hypothesis)));
    const groups = [];
    const counts = { proven: 0, confirmed: 0, deferred: 0, 'ruled-out': 0 };
    const ordered = [];
    for (const tier of TIER_ORDER) {
        const list = (byTier.get(tier) ?? [])
            .slice()
            .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));
        const negatives = tier === 'ruled-out' ? extraNegatives : [];
        counts[tier] = list.length + negatives.length;
        ordered.push(...list);
        if (list.length > 0 || negatives.length > 0) {
            groups.push({ tier, findings: list, negativeProof: negatives });
        }
    }
    return { groups, counts, ordered };
}
function sectionsOf(o, doc) {
    const d = o.detail;
    const present = new Set([
        'cover',
        'coverage',
        'severity-breakdown',
        'findings',
        'footer',
    ]);
    // The banner slot renders the halt/block banner when the end was not
    // a completion, else the posture banner when the grading seam
    // produced one.
    if (o.haltedReason || o.blockedReason || o.banner)
        present.add('banner');
    if (o.team && o.team.length > 0)
        present.add('team');
    // The activity section renders only over a non-empty audit log (the
    // HTML section's own guard); an engagement always has events in
    // practice, but the manifest states the record, not the habit.
    if (o.activity.eventCount > 0)
        present.add('activity');
    // The detail derivations render inside the executive-summary segment
    // (breakdown / what-changed / risk areas / impact) whenever they
    // exist, even when the reporter narrative itself is empty.
    if (o.narrativeMd.trim() || d)
        present.add('executive-summary');
    if (doc.fixPrompt)
        present.add('fix-prompt');
    if (d) {
        if (d.priority.zeroNote || d.priority.actions.length > 0 || d.priority.verifyNext.length > 0) {
            present.add('priority-actions');
        }
        present.add('pillars');
        if ((d.surfaceNetwork && d.surfaceNetwork.length > 0) || d.surfaceDynamic.length > 0) {
            present.add('surface');
        }
    }
    if (o.matter?.strengths)
        present.add('strengths');
    if (o.inventory !== undefined)
        present.add('inventory');
    if (o.matter) {
        present.add('recorded-frame');
        present.add('limitations');
    }
    return REPORT_SECTION_ORDER.filter(s => present.has(s));
}
/** Build the one report document from the phase's structured input. */
export function buildReportDocument(o) {
    const { groups, counts, ordered } = tierGroupsOf(o);
    const fixPrompt = buildFixPrompt(o.meta.target, o.findings, o.bundles);
    const partial = { fixPrompt, tierGroups: groups };
    return {
        meta: o.meta,
        title: o.title,
        narrativeMd: o.narrativeMd,
        posture: o.posture,
        banner: o.banner,
        team: o.team,
        haltedReason: o.haltedReason,
        blockedReason: o.blockedReason,
        dryRun: o.dryRun,
        severityCounts: { ...o.posture.findingsBySeverity },
        tierCounts: counts,
        tierGroups: groups,
        findingsInReportOrder: ordered,
        fixPrompt,
        bundles: o.bundles,
        noBundleReasons: o.noBundleReasons,
        findingMeta: o.findingMeta,
        detail: o.detail,
        matter: o.matter,
        coverage: o.coverage,
        activity: o.activity,
        inventory: o.inventory,
        sections: sectionsOf(o, partial),
    };
}
//# sourceMappingURL=document.js.map