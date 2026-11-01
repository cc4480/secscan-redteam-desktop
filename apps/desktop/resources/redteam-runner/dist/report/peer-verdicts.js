function matches(f, lf) {
    if (lf.title.trim().toLowerCase() !== f.title.trim().toLowerCase())
        return false;
    return f.attackIds.some((a) => a.toUpperCase() === lf.attackId.toUpperCase());
}
function stampFrom(f, lf) {
    f.producer = lf.producer;
    f.peerReview = lf.peerReview;
}
export function applyPeerVerdicts(findings, sources) {
    const used = {
        live: new Set(),
        killed: new Set(),
        deferred: new Set(),
    };
    for (const f of findings) {
        let hit = false;
        for (const key of ["killed", "deferred"]) {
            const list = sources[key];
            const i = list.findIndex((lf, idx) => !used[key].has(idx) && matches(f, lf));
            if (i >= 0) {
                stampFrom(f, list[i]);
                f.status = key === "killed" ? "killed" : "deferred";
                used[key].add(i);
                hit = true;
                break;
            }
        }
        if (hit)
            continue;
        const i = sources.live.findIndex((lf, idx) => !used.live.has(idx) && matches(f, lf));
        if (i < 0)
            continue;
        const lf = sources.live[i];
        stampFrom(f, lf);
        if (lf.peerReview?.disposition === "downgraded" && lf.peerReview.toSeverity) {
            f.severity = lf.peerReview.toSeverity;
        }
        used.live.add(i);
    }
}
/** The report-phase call site for the peer join, with the sources read
 * from the engagement context (extracted from report/phase.ts so the
 * orchestrator stays inside the file budget; arguments unchanged). */
export function stampPeerVerdicts(findings, ctx) {
    applyPeerVerdicts(findings, { live: ctx.liveFindings, killed: ctx.peerKilledLive ?? [], deferred: ctx.peerDeferredLive ?? [] });
}
/** The per-finding peer fragment of the reporter prompt's shared-verdicts
 * list: the checker's verdict and seat, or nothing when unchallenged. */
export function peerVerdictSuffix(f) {
    return f.peerReview ? `, peer: ${f.peerReview.verdict} by ${f.peerReview.checker}` : "";
}
/** The reporter prompt's peer-deferred section: findings a different
 * seat challenged and sent back for more evidence, listed so the
 * reporter marks any write-up deferred. Ends with a newline. */
export function peerDeferredPromptSection(deferred) {
    const list = deferred ?? [];
    const body = list.map((f) => `- [${f.severity}] ${f.title} (${f.attackId}) — deferred by ${f.peerReview?.checker}: ${f.peerReview?.rationale}`).join("\n") || "(none)";
    return `Peer-review deferred (${list.length}) — challenged by a different seat and sent back for more evidence; NOT confirmed findings, mark any write-up deferred:\n${body}\n`;
}
//# sourceMappingURL=peer-verdicts.js.map