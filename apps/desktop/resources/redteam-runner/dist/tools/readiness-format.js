/** "~12m" / "~3h" for a bench's remaining time. */
export function formatBenchRemaining(remainingMs) {
    const minutes = Math.max(1, Math.round(remainingMs / 60_000));
    return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}
/**
 * The `llm_credential_pool` readiness item (pool-persistence spec §1.6):
 * rendered ONLY when some pool entry is dead or benched — a healthy or
 * empty pool omits the item entirely rather than taking a green line.
 * The detail names each affected key by fingerprint (never key material):
 * dead keys with their recorded reason plus, when the pool recorded them,
 * the killing response's HTTP status/code and the death time; benched (key, model) pairs with
 * the time until they are eligible again, or "no automatic return" for
 * permanent (entitlement) benches. Benches that have already lapsed by
 * render time are skipped. Pure over the snapshots so tests feed it
 * fixtures; the report builder passes the router's live poolSnapshots().
 */
export function credentialPoolItem(snapshots, nowMs) {
    const segments = [];
    for (const snap of snapshots) {
        for (const entry of snap.entries) {
            if (entry.dead) {
                // Death evidence when the pool recorded it (FIX-DEADKEY): what the
                // provider answered and when the death was recorded, so the remedy
                // (re-seat the key) is checkable against the provider account.
                const said = [];
                if (entry.deadStatus !== undefined)
                    said.push(`HTTP ${entry.deadStatus}`);
                if (entry.deadCode !== undefined)
                    said.push(entry.deadCode);
                segments.push(`${snap.providerId}: key …${entry.fingerprint} dead${entry.deadReason !== undefined ? ` (${entry.deadReason})` : ''}` +
                    (said.length > 0 ? ` — provider answered ${said.join(' ')}` : '') +
                    (entry.deadAtMs !== undefined ? ` at ${new Date(entry.deadAtMs).toISOString()}` : ''));
            }
            for (const bench of entry.benchedModels) {
                if (bench.untilMs === null) {
                    segments.push(`${snap.providerId}: key …${entry.fingerprint} benched for ${bench.model} — no automatic return`);
                }
                else if (bench.untilMs > nowMs) {
                    segments.push(`${snap.providerId}: key …${entry.fingerprint} benched for ${bench.model} — eligible again in ~${formatBenchRemaining(bench.untilMs - nowMs)}`);
                }
            }
        }
    }
    if (segments.length === 0)
        return undefined;
    return {
        id: 'llm_credential_pool',
        label: 'LLM credential pool (dead / benched keys)',
        state: 'missing',
        detail: segments.join('; '),
        fix: 'A benched key returns on its own when the bench lapses; a dead key stays dead until the key is replaced (check the provider account, then update the key in the Secure Vault). To reset all pool bookkeeping, delete the pool state file (llm-pool-state.json — see REDTEAM_LLM_POOL_STATE_FILE / REDTEAM_HOME).',
        required: false,
    };
}
/** Render a report as a plain-text table for the CLI. */
export function formatReadiness(report) {
    const lines = [`readiness: ${report.summary}`, ''];
    for (const item of report.items) {
        const mark = item.state === 'ready' ? 'OK  ' : item.state === 'paused' ? 'PAUS' : item.state === 'missing' ? 'MISS' : item.state === 'unreachable' ? 'DOWN' : 'CFG ';
        lines.push(`${mark} ${item.label.padEnd(48)} ${item.detail ?? ''}`.trimEnd());
        if (item.fix && item.state !== 'ready')
            lines.push(`     → ${item.fix}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=readiness-format.js.map