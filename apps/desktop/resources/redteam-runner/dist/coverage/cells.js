import { BATTERY_CATEGORIES } from '../battery.js';
import { TARGET_PROFILES, activeTargets, targetCellStatus } from '../targets.js';
import { memoryDigestLine } from '../memory/lifecycle.js';
/**
 * Runner-computed battery coverage line. Generic engagements: 3 global
 * categories. Full-battery engagements: 3 categories × selected targets
 * (12 cells by default). ✓ probed · ⊘ blocked (prerequisite) · … missing.
 */
export function batteryStatusLine(ctx) {
    if (ctx.input.fullBattery) {
        return activeTargets(ctx.input)
            .map(t => `${t}: ${BATTERY_CATEGORIES.map((c) => {
            const s = targetCellStatus(TARGET_PROFILES[t], c, ctx.targetCoverage.get(t));
            return `${c}${s === 'done' ? '✓' : s === 'blocked' ? '⊘' : '…'}`;
        }).join(' ')}`)
            .join(' | ');
    }
    return BATTERY_CATEGORIES.map(c => `${c}${ctx.coverage.has(c) ? '✓' : '…'}`).join(' ');
}
/** Compact shared-state digest appended to every tool result — the team's common picture, never stale. */
export function sharedStateDigest(ctx, phase) {
    const parts = [`[SHARED STATE · phase=${phase}]`];
    if (ctx.plan)
        parts.push(`plan: ${ctx.plan.steps.length} steps (${ctx.plan.adversaryProfile})`);
    if (ctx.targetMap.length) {
        const entries = ctx.targetMap
            .slice(0, 10)
            .map(t => `${t.method} ${t.area}${t.authState ? ` [${t.authState}]` : ''}${t.attackId ? ` ${t.attackId}` : ''}`);
        parts.push(`target-map(${ctx.targetMap.length}): ${entries.join(' | ')}${ctx.targetMap.length > 10 ? ` +${ctx.targetMap.length - 10} more` : ''}`);
    }
    if (ctx.liveFindings.length) {
        parts.push(`findings(${ctx.liveFindings.length}): ${ctx.liveFindings.slice(0, 5).map(f => `[${f.severity}] ${f.title}`).join(' | ')}`);
    }
    if (ctx.killedLive.length) {
        parts.push(`killed(${ctx.killedLive.length}): ${ctx.killedLive.slice(0, 5).map(k => k.hypothesis).join(' | ')}`);
    }
    if (ctx.registryHits.length)
        parts.push(`registry: ${ctx.registryHits.length} relevant hits surfaced this engagement`);
    parts.push(`battery: ${batteryStatusLine(ctx)}`);
    if (ctx.opsecCooldown.size)
        parts.push(`OPSEC cooldowns: ${ctx.opsecCooldown.size}`);
    if (ctx.redirects)
        parts.push(`redirects used: ${ctx.redirects}/2`);
    // Q-MEMTIER: one line when a recall pack exists (survivor counts by
    // tier + receipt id); memoryDigestLine returns null otherwise. The
    // 1600-char cap below applies to the joined digest as before.
    const memoryLine = memoryDigestLine(ctx);
    if (memoryLine)
        parts.push(memoryLine);
    const s = parts.join('\n');
    return s.length > 1600 ? s.slice(0, 1600) + '…' : s;
}
//# sourceMappingURL=cells.js.map