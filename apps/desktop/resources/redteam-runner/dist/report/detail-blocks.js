/**
 * Q-REPORT-DETAIL — the section-data builders behind report/detail.ts
 * (spec §§3/7/8): the pillar cards, the surface rows, the breakdown
 * lines, and the coverage-figures line they share. Pure derivations
 * like the rest of the detail module — detail.ts owns the types, the
 * diff, grouping, impact, and ranking; this file exists because the
 * 300-line budget splits the module (the spec §11 escape, applied the
 * same way the wiring split into predecessor.ts + detail-sections.ts).
 */
import { ANCHOR_CLAUSE, ARM_UNIVERSE, ENGINE_ARM, PILLARS, SEVERITY_RANK, TIER_RANK, armOf, compareIds, isActionable, normalizeLabel, plural, req, signed, } from './detail-tables.js';
const zeroSeverities = () => ({
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
});
/** §7 — pillar cards from the single-primary attribution. DAST's
 * ran-state includes the SecScan engine (§7.1); EASM is fed by recon
 * facts and never reads SECURE or NOT COVERED (§7.3). */
export function buildPillars(input, pillarOf) {
    const counts = new Map();
    for (const f of input.findings) {
        if (f.tier === 'deferred')
            continue;
        const rec = counts.get(req(pillarOf.get(f.id), `pillar for ${f.id}`)) ?? zeroSeverities();
        rec[f.severity]++;
        counts.set(req(pillarOf.get(f.id), `pillar for ${f.id}`), rec);
    }
    const armName = (a) => armOf(a.name) ?? normalizeLabel(a.name);
    const ran = new Set(input.coverage.arms.filter(a => a.state === 'ran').map(armName));
    const engineRan = input.coverage.arms.some(a => a.state === 'ran' && normalizeLabel(a.name) === ENGINE_ARM);
    const s = input.surface;
    const surfaceFacts = Boolean((s.ips && s.ips.length > 0) || (s.nameservers && s.nameservers.length > 0) ||
        s.tlsGrade || s.tlsDetail || s.servedVia ||
        (s.technologies && s.technologies.length > 0) ||
        (s.serverHeaders && s.serverHeaders.length > 0));
    return PILLARS.map((def) => {
        const bySeverity = counts.get(def.name) ?? zeroSeverities();
        const findingCount = Object.values(bySeverity).reduce((n, v) => n + v, 0);
        const base = { pillar: def.name, scopeLabel: def.scopeLabel, findingCount, bySeverity };
        if (def.noArmReason)
            return { ...base, status: 'NO ARM', reason: def.noArmReason };
        if (def.name === 'EASM') {
            return {
                ...base,
                status: (surfaceFacts || findingCount > 0 ? 'MAPPED' : 'NO DATA'),
                footnote: "Fed by the recon phase and the SecScan engine's surface discovery; no battery arm runs for this pillar.",
            };
        }
        const ranCount = def.arms.filter(a => ran.has(a)).length;
        const pillarRan = ranCount > 0 || (def.name === 'DAST' && engineRan);
        if (findingCount > 0)
            return { ...base, status: 'FINDINGS' };
        if (!pillarRan) {
            const reasons = [...new Set(input.coverage.arms
                    .filter(a => a.state !== 'ran' && def.arms.includes(armName(a)) && a.reason)
                    .flatMap(a => (a.reason ? [a.reason] : [])))];
            return {
                ...base, status: 'NOT COVERED',
                reason: reasons.length > 0 ? reasons.join('; ') : "None of this pillar's arms ran in this pass — see Coverage.",
            };
        }
        const rest = def.arms.length - ranCount;
        return {
            ...base, status: 'SECURE',
            footnote: `${ranCount} of ${def.arms.length} arms executed${def.name === 'DAST' && engineRan ? ', plus the SecScan engine' : ''}${rest > 0 ? `; ${rest} did not run — see Coverage` : ''}.`,
        };
    });
}
/** §3 line 4 — the coverage figures, composed once (the §6.2
 * zero-action entry reuses the same figures). */
export function coverageLine(c) {
    const t = c.totals;
    const head = `${t.executedClean + t.confirmed} of ${t.total} battery items executed; ` +
        `${t.blocked} blocked and ${t.na} not-applicable, each with its recorded reason under Coverage.`;
    if (c.fullBattery)
        return head;
    return `Scoped run: ${head}${c.planOnly.length > 0 ? ` Plan-only items: ${c.planOnly.join(', ')}.` : ''}`;
}
/** §8 — surface rows: a field renders only when the record carries
 * it; the network block is null when no row has data. */
export function buildSurface(input) {
    const s = input.surface;
    const network = [];
    if (s.ips && s.ips.length > 0)
        network.push({ label: s.ips.length > 1 ? 'Resolved IPs' : 'Resolved IP', value: s.ips.join(', ') });
    if (s.nameservers && s.nameservers.length > 0)
        network.push({ label: 'Nameservers', value: s.nameservers.join(', ') });
    if (s.tlsGrade)
        network.push({ label: 'TLS grade', value: s.tlsGrade });
    if (s.tlsDetail)
        network.push({ label: 'TLS detail', value: s.tlsDetail });
    if (s.servedVia)
        network.push({ label: 'Served via', value: s.servedVia });
    if (s.technologies && s.technologies.length > 0)
        network.push({ label: 'Technologies', value: s.technologies.join(', ') });
    if (s.serverHeaders && s.serverHeaders.length > 0)
        network.push({ label: 'Server headers', value: s.serverHeaders.join(', ') });
    const c = input.coverage;
    const t = c.totals;
    const dynamic = [
        {
            label: 'Battery items',
            value: `${t.total} items — ${t.confirmed} confirmed · ${t.executedClean} executed clean · ${t.blocked} blocked · ${t.na} not-applicable · ${t.pending} pending`,
        },
    ];
    if (c.probesUsed > 0)
        dynamic.push({ label: 'Probes used', value: String(c.probesUsed) });
    if (c.pathProbes) {
        dynamic.push({
            label: 'Sensitive paths probed',
            value: `${c.pathProbes.executed} probed — ${c.pathProbes.confirmedAmong} confirmed findings among them`,
        });
    }
    if (c.pagesDiscovered !== undefined)
        dynamic.push({ label: 'Pages discovered', value: String(c.pagesDiscovered) });
    if (c.endpointsDiscovered !== undefined)
        dynamic.push({ label: 'Endpoints discovered', value: String(c.endpointsDiscovered) });
    if (c.arms.length > 0) {
        const ranSet = new Set(c.arms.filter(a => a.state === 'ran').map(a => armOf(a.name) ?? normalizeLabel(a.name)));
        const ranArms = ARM_UNIVERSE.filter(a => ranSet.has(a));
        const notRun = ARM_UNIVERSE.filter(a => !ranSet.has(a));
        dynamic.push({
            label: 'Arms',
            value: `${ranArms.length} of ${ARM_UNIVERSE.length} arms executed` +
                (notRun.length > 0 ? ` — not run: ${notRun.join(', ')}` : ''),
        });
    }
    return { surfaceNetwork: network.length > 0 ? network : null, surfaceDynamic: dynamic };
}
/** §3 — the deterministic breakdown lines, each included only when
 * its inputs exist, in the spec's order. */
export function buildBreakdown(input, riskAreas, diff, countsOnly) {
    const lines = [];
    const n = riskAreas.reduce((sum, a) => sum + a.findings.length, 0);
    lines.push(`Automated ${input.mode} assessment of ${input.target}: ${n} active ${plural(n, 'finding', 'findings')} ` +
        `across ${riskAreas.length} ${plural(riskAreas.length, 'area', 'areas')}; overall posture ${input.posture.postureRating}.`);
    const worst = input.worstConfirmed ?? null;
    const anchor = worst ? ANCHOR_CLAUSE[worst.severity] : undefined;
    lines.push(anchor && worst
        ? `The grade is anchored by ${worst.id} (${worst.severity} · ${worst.title}) — ${anchor}.`
        : 'No single finding anchors the grade; it follows the confirmed set.');
    const by = input.findingsBySeverity;
    const tc = input.tierCounts;
    lines.push(`${by.critical} critical · ${by.high} high · ${by.medium} medium · ${by.low} low · ${by.info} info — ` +
        `${tc.proven} proven · ${tc.confirmed} confirmed · ${tc.deferred} deferred.`);
    lines.push(coverageLine(input.coverage));
    if (input.baseline && diff) {
        const counts = `${diff.newFindings.length} new, ${diff.resolved.length} resolved, ${diff.worsened.length} worsened` +
            (diff.improved.length > 0 ? `, ${diff.improved.length} improved` : '');
        lines.push(countsOnly
            ? `Against ${input.baseline.engagementId}: findings ${signed(diff.findingsDelta)} — ${counts}.`
            : `Against ${input.baseline.engagementId}: score ${signed(diff.scoreDelta ?? 0)}, findings ${signed(diff.findingsDelta)} — ${counts}.`);
    }
    if (input.coverage.notCovered.length > 0) {
        const k = input.coverage.notCovered.length;
        lines.push(`${k} ${plural(k, 'arm', 'arms')} did not run: ${input.coverage.notCovered.join(', ')} — reasons under Coverage.`);
    }
    return lines;
}
/** §2.1 identity: normalized title + primary ref (first attackId,
 * else the normalized source label, else ""). */
const normalizeTitle = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?;:]+$/, '');
const primaryRef = (f) => f.attackIds.length > 0 ? (f.attackIds[0] ?? '').toUpperCase() : normalizeLabel(f.sourceLabel);
const identityKey = (f) => `${normalizeTitle(f.title)}|${primaryRef(f)}`;
/**
 * §2 — diff the current actionable set against the baseline's.
 * Matching is two-pass: exact identity keys first, then leftover pairs
 * by normalized title alone when their refs do not conflict (one side
 * ref-less) — a baseline recorded without source labels still matches
 * its labeled current twin, while same-title findings carrying
 * different attackIds stay distinct (one new + one resolved).
 */
export function diffFindings(current, baseline, currentScore) {
    const cur = current.filter(isActionable);
    const base = baseline.findings.filter(isActionable);
    const pairs = new Map();
    const usedBase = new Set();
    const baseByKey = new Map(base.map(f => [identityKey(f), f]));
    for (const c of cur) {
        const b = baseByKey.get(identityKey(c));
        if (b && !usedBase.has(b)) {
            pairs.set(c, b);
            usedBase.add(b);
        }
    }
    const baseByTitle = new Map();
    for (const b of base) {
        const t = normalizeTitle(b.title);
        baseByTitle.set(t, [...(baseByTitle.get(t) ?? []), b]);
    }
    for (const c of cur) {
        if (pairs.has(c))
            continue;
        const cands = (baseByTitle.get(normalizeTitle(c.title)) ?? []).filter((b) => {
            if (usedBase.has(b))
                return false;
            const rb = primaryRef(b);
            const rc = primaryRef(c);
            return rb === rc || rb === '' || rc === '';
        });
        const only = cands[0];
        if (cands.length === 1 && only) {
            pairs.set(c, only);
            usedBase.add(only);
        }
    }
    const diff = {
        newFindings: [], resolved: [], worsened: [], improved: [],
        unchangedCount: 0, findingsDelta: cur.length - base.length,
        ...(typeof baseline.score === 'number' && typeof currentScore === 'number'
            ? { scoreDelta: currentScore - baseline.score } : {}),
    };
    const entry = (f, from) => ({
        id: f.id, title: f.title, severity: f.severity,
        ...(from ? { fromSeverity: from.severity, fromTier: from.tier, toTier: f.tier } : {}),
    });
    for (const c of cur) {
        const b = pairs.get(c);
        if (!b) {
            diff.newFindings.push(entry(c));
            continue;
        }
        const sevUp = SEVERITY_RANK[c.severity] < SEVERITY_RANK[b.severity];
        const sevDown = SEVERITY_RANK[c.severity] > SEVERITY_RANK[b.severity];
        if (sevUp || (c.severity === b.severity && TIER_RANK[c.tier] < TIER_RANK[b.tier])) {
            diff.worsened.push(entry(c, b));
        }
        else if (sevDown || (c.severity === b.severity && TIER_RANK[c.tier] > TIER_RANK[b.tier])) {
            diff.improved.push(entry(c, b));
        }
        else
            diff.unchangedCount++;
    }
    const deferredByKey = new Map(current.filter(f => !isActionable(f)).map(f => [identityKey(f), f]));
    for (const b of base) {
        if (usedBase.has(b))
            continue;
        diff.resolved.push({
            ...entry(b),
            ...(deferredByKey.has(identityKey(b))
                ? { note: 'now deferred — verification outstanding' } : {}),
        });
    }
    const sortEntries = (es) => {
        es.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || compareIds(x.id ?? '', y.id ?? ''));
    };
    sortEntries(diff.newFindings);
    sortEntries(diff.resolved);
    sortEntries(diff.worsened);
    sortEntries(diff.improved);
    return diff;
}
//# sourceMappingURL=detail-blocks.js.map