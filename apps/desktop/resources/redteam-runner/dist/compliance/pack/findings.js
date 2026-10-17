/**
 * Compliance pack finding/retest types + before/after evidence builder.
 */
export function buildRetestEvidence(registry) {
    const byClass = new Map();
    for (const c of registry.confirmed) {
        const list = byClass.get(c.vulnClass) ?? [];
        list.push(c);
        byClass.set(c.vulnClass, list);
    }
    const entries = [];
    for (const [vulnClass, list] of byClass) {
        const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const obs = (c) => ({
            engagementId: c.engagementId,
            date: c.date,
            severity: c.severity,
            evidenceRef: c.evidenceRef,
        });
        entries.push({ vulnClass, firstSeen: obs(first), latest: obs(last), observationCount: sorted.length });
    }
    return entries.sort((a, b) => a.vulnClass.localeCompare(b.vulnClass));
}
/** Human-readable markdown rendering of the pack (written next to report.md). */
//# sourceMappingURL=findings.js.map