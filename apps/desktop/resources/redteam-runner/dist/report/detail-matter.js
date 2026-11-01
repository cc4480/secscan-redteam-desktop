/**
 * Q-RP-7 / Q-RP-8 — pure derivations for the report's front/back matter
 * and the "what is working well" section (parity audit rows 3, 5–7, 10,
 * 27). No rendering, no I/O — every row and line is slot-filled here
 * from the engagement record; the renderer (html/matter-sections.ts)
 * adds markup only. Honesty rules bind (detail spec §1): a fact the
 * record does not carry stays absent — an empty ROE list omits its row,
 * an unverified engagement states so plainly, and an engagement with
 * no executed-clean checks and no ruled-out hypotheses gets NO
 * strengths section at all rather than filler.
 */
import { ANCHOR_CLAUSE, DEDUCTION_WEIGHT } from './detail-tables.js';
function scopeRows(i) {
    const rows = [{ label: 'Target', value: i.target }];
    if (i.objective)
        rows.push({ label: 'Objective', value: i.objective });
    if (i.scope.length)
        rows.push({ label: 'In scope', value: i.scope.join(', ') });
    if (i.outOfScope.length)
        rows.push({ label: 'Out of scope', value: i.outOfScope.join(', ') });
    if (i.excludedTechniques.length) {
        rows.push({ label: 'Excluded techniques', value: i.excludedTechniques.join(', ') });
    }
    if (i.testWindow)
        rows.push({ label: 'Test window', value: `${i.testWindow.start} → ${i.testWindow.end}` });
    if (i.stopConditions.length)
        rows.push({ label: 'Stop conditions', value: i.stopConditions.join('; ') });
    if (i.deconflictionContact)
        rows.push({ label: 'Deconfliction contact', value: i.deconflictionContact });
    return rows;
}
function authorisationRows(i) {
    const rows = [
        { label: 'Ownership verification', value: i.verified ? 'Verified' : 'Not verified' },
    ];
    if (i.verificationProof)
        rows.push({ label: 'Verification proof', value: i.verificationProof });
    if (i.verifiedAt)
        rows.push({ label: 'Verified at', value: i.verifiedAt });
    if (i.operator)
        rows.push({ label: 'Accountable operator', value: i.operator });
    if (i.client)
        rows.push({ label: 'Client', value: i.client });
    rows.push({ label: 'Engagement started', value: i.startedAt });
    rows.push({ label: 'Report generated', value: i.generatedAt });
    return rows;
}
function methodLines(i) {
    const lines = [
        `${i.mode} mode · autonomy tier ${i.tier} · ${i.environment} environment` +
            (i.localHost ? ' · local-host engagement' : '') +
            (i.dryRun ? ' · dry run' : '') +
            '.',
    ];
    if (i.fullBattery) {
        if (i.batteryTargets.length) {
            const items = i.batteryTargets.reduce((n, t) => n + t.items, 0);
            lines.push(`Full battery — ${i.batteryTargets.length} target batteries ` +
                `(${i.batteryTargets.map((t) => t.id).join(', ')}), ${items} battery items ` +
                'across the logic, functionality and validation categories.');
        }
    }
    else if (i.categoriesProbed.length) {
        lines.push(`Scoped run — probed categories: ${i.categoriesProbed.join(', ')} ` +
            '(of logic, functionality, validation).');
    }
    if (i.planPhases.length) {
        lines.push(`Engagement phases, in plan order: ${i.planPhases.join(' → ')}.`);
    }
    const activity = [];
    if (i.eventCount > 0)
        activity.push(`${i.eventCount} audit events`);
    if (i.toolActions > 0)
        activity.push(`${i.toolActions} distinct tool actions`);
    if (i.probesUsed > 0)
        activity.push(`${i.probesUsed} probes`);
    if (activity.length)
        lines.push(`Recorded activity: ${activity.join(' · ')}.`);
    return lines;
}
/** The anchored grading method, as documented at the grading seam
 * (report/grading.ts): weights and anchor clauses come from the fixed
 * tables, never from the findings being graded. */
function riskMethodLines() {
    const w = DEDUCTION_WEIGHT;
    return [
        'The score and grade come from the anchored scoring engine — the one grading voice for every SecScan report. The score starts at 100.',
        `A confirmed finding deducts its full severity weight — critical ${w.critical} · high ${w.high} · medium ${w.medium} · low ${w.low} · info ${w.info}.`,
        `The grade is anchored to the worst confirmed severity: ${ANCHOR_CLAUSE.critical}; ${ANCHOR_CLAUSE.high}. Finding count alone cannot produce an F, and the score floors at 10.`,
        'Heuristic findings are damped (×0.5 at medium confidence, ×0.25 at low), their combined deduction is capped at 40, and they cannot pull the score below 60 on their own.',
        'Only confirmed findings are graded. Deferred findings are carried forward unresolved and ruled-out findings are excluded — neither moves the score.',
    ];
}
function limitationLines(i) {
    const lines = [];
    if (i.haltedReason)
        lines.push(`The engagement halted before completion: ${i.haltedReason}`);
    if (i.dryRun) {
        lines.push('Dry run — agent decisions were simulated; no live traffic was sent to the target.');
    }
    for (const cell of i.blockedCells)
        lines.push(`Blocked (prerequisite not met): ${cell}`);
    for (const p of i.planOnly)
        lines.push(`Executes when its prerequisite is supplied: ${p}`);
    for (const n of i.notCovered)
        lines.push(`Not covered: ${n}`);
    if (i.totals.pending > 0) {
        lines.push(`${i.totals.pending} battery item(s) had no verdict at report time; no disposition is claimed for them.`);
    }
    if (i.totals.na > 0) {
        lines.push(`${i.totals.na} battery item(s) were recorded not-applicable to this target.`);
    }
    if (lines.length === 0) {
        lines.push('Nothing in the coverage record was blocked, left uncovered, or left pending at report time.');
    }
    return lines;
}
function strengths(i) {
    if (i.executedClean === 0 && i.ruledOut.length === 0)
        return undefined;
    const parts = [];
    if (i.executedClean > 0)
        parts.push(`${i.executedClean} battery check(s) executed and returned no finding`);
    if (i.ruledOut.length > 0)
        parts.push(`${i.ruledOut.length} hypothesis(es) were tested and ruled out`);
    return {
        summary: `${parts.join(' · ')}. The ruled-out hypotheses are named under Findings — Ruled out.`,
        areaLines: i.cleanAreas.map((a) => `${a.target} · ${a.category}: ${a.items} check(s) ran and produced no finding`),
    };
}
/** Assemble every front/back-matter derivation for one report. */
export function buildReportMatter(input) {
    const s = strengths(input);
    return {
        scopeRows: scopeRows(input),
        authorisationRows: authorisationRows(input),
        methodLines: methodLines(input),
        riskMethodLines: riskMethodLines(),
        limitationLines: limitationLines(input),
        ...(s ? { strengths: s } : {}),
    };
}
//# sourceMappingURL=detail-matter.js.map