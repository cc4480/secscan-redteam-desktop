/**
 * Q-REPORT-DETAIL — pure derivations for the detail sections (spec
 * §§2–8): the predecessor diff, risk-area grouping, the business-impact
 * statement selection, and priority ranking. No rendering, no I/O —
 * every string is slot-filled here from the engagement record; the
 * renderer (html/detail-sections.ts) adds markup only. Fixed tables
 * live in detail-tables.ts, section-data builders in detail-blocks.ts,
 * the impact derivations (band + per-finding, Q-RP-4) in
 * detail-impact.ts. Honesty rules bind: a fact the record does not
 * carry stays absent, and an unclassifiable finding fails loud (§7.4),
 * never drops out.
 */
import { ARM_AREA, ARM_PILLAR, DEDUCTION_WEIGHT, ENGINE_ARM, FAMILY_AREA, SEVERITY_RANK, TIER_RANK, armOf, byRankThenId, compareIds, familyClass, isActionable, normalizeLabel, req, } from './detail-tables.js';
import { buildBreakdown, buildPillars, buildSurface, coverageLine, diffFindings } from './detail-blocks.js';
import { buildFindingImpacts, buildImpact } from './detail-impact.js';
export { diffFindings } from './detail-blocks.js';
/** The finding's own fix, truncated at its first sentence boundary. */
export function firstSentence(text) {
    const t = text.trim();
    const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(t);
    return m ? m[0].trim() : t;
}
/** §4/§7 attribution for one actionable finding: arm table first,
 * then the §4.3 family table (engine findings split EASM/DAST per
 * §7.2). A single-token label that is not a known arm throws — the
 * §7.4 build error, so a finding can never fall out of every pillar. */
function classify(f) {
    const arm = armOf(f.sourceLabel);
    if (arm) {
        const area = ARM_AREA[arm];
        const pillar = ARM_PILLAR[arm];
        if (area === undefined || pillar === undefined) {
            throw new Error(`report detail: arm ${arm} missing from an attribution table`);
        }
        return { area, pillar };
    }
    const raw = f.sourceLabel.trim();
    if (raw !== '' && !/\s/.test(raw) && normalizeLabel(raw) !== ENGINE_ARM) {
        throw new Error(`report detail: source label ${JSON.stringify(raw)} is not a known arm (§7.1 table)`);
    }
    const fam = familyClass(f);
    return { area: fam ? FAMILY_AREA[fam] : 'General', pillar: fam === 'exposure' ? 'EASM' : 'DAST' };
}
function buildRiskAreas(actionable, areaOf) {
    const byArea = new Map();
    for (const f of actionable) {
        const name = req(areaOf.get(f.id), `risk area for ${f.id}`);
        byArea.set(name, [...(byArea.get(name) ?? []), f]);
    }
    return [...byArea.entries()]
        .map(([name, fs]) => ({
        name,
        worst: req([...fs].sort(byRankThenId)[0], 'risk-area member').severity,
        findings: [...fs].sort(byRankThenId).map(f => ({ id: f.id, title: f.title, severity: f.severity })),
    }))
        .sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] ||
        b.findings.length - a.findings.length || (a.name < b.name ? -1 : 1));
}
/** §6.1 order: tier, then anchored deduction weight, then F-id. */
function priorityOrder(fs) {
    return [...fs].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        DEDUCTION_WEIGHT[b.severity] - DEDUCTION_WEIGHT[a.severity] || compareIds(a.id, b.id));
}
const toEntry = (f) => ({
    id: f.id, title: f.title, severity: f.severity, tier: f.tier, fixSentence: firstSentence(f.fix),
});
/** Assemble every detail derivation for one report. */
export function buildReportDetail(input) {
    const actionable = input.findings.filter(isActionable);
    const deferred = input.findings.filter(f => !isActionable(f));
    const areaOf = new Map();
    const pillarOf = new Map();
    for (const f of actionable) {
        const c = classify(f);
        areaOf.set(f.id, c.area);
        pillarOf.set(f.id, c.pillar);
    }
    const riskAreas = buildRiskAreas(actionable, areaOf);
    const diff = input.baseline ? diffFindings(input.findings, input.baseline, input.posture.score) : null;
    const countsOnly = input.baseline ? typeof input.baseline.score !== 'number' : false;
    return {
        breakdown: buildBreakdown(input, riskAreas, diff, countsOnly),
        diff,
        countsOnly,
        ...(input.baseline
            ? { baselineLabel: `${input.baseline.engagementId} · ${input.baseline.startedAt}` } : {}),
        riskAreas,
        deferredCount: deferred.length,
        impact: buildImpact(actionable, areaOf, input.coverage.totals),
        findingImpacts: buildFindingImpacts(actionable, areaOf),
        priority: {
            actions: priorityOrder(actionable).map(toEntry),
            verifyNext: [...deferred]
                .sort((a, b) => DEDUCTION_WEIGHT[b.severity] - DEDUCTION_WEIGHT[a.severity] || compareIds(a.id, b.id))
                .map(toEntry),
            ...(actionable.length === 0 && deferred.length === 0
                ? { zeroNote: coverageLine(input.coverage) } : {}),
        },
        pillars: buildPillars(input, pillarOf),
        ...buildSurface(input),
        actionableCount: actionable.length,
    };
}
//# sourceMappingURL=detail.js.map