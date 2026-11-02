/**
 * Wave planner (Q-CAMPAIGN, scoping N4 / decisions D-3, D-4).
 *
 * One coordinator-model completion proposes the next wave: an aim and
 * a focus roster drawn from the kind's vector list. The output is
 * treated as untrusted structured data, exactly the way the workgraph
 * refiner's output is treated inside an engagement: parsed, validated
 * field by field, invalid entries dropped WITH the reason kept — and
 * if the reply cannot be read at all, the wave falls back to a
 * deterministic coverage-gap roster. A planner failure never becomes
 * an improvisation and never stops the campaign: the fallback is a
 * fixed matrix, and the reason it was used is recorded in the plan.
 *
 * The planner seat (D-4) is the coordinator completion, injected here
 * so tests run keyless and the CLI wires the real router.
 *
 * Audit M7 exemption — no charter/containment on this call, by design:
 * this is a PRE-ENGAGEMENT planning tool. planNextWave runs before any
 * wave launches (gate.ts's operator decision + launch are what turn a
 * plan into an engagement), so no verified engagement record exists at
 * this stage for completeWithCharter to consume: a CampaignRecord
 * carries only scope.hosts + scope.verificationRef (a reference
 * string, store.ts/createCampaign) — not the CharterEngagement fields
 * (owner, proofMethod) a chartered call requires, and building one
 * here would fabricate the proof the authorize phase has not yet
 * produced. The injected completion therefore stays the bare
 * coordinator completion (cli.ts defaultCompletion). Charter applies
 * when a plan becomes an engagement: the launched wave runs through
 * runEngagement/agentLoop, whose production completion is
 * createCharteredComplete with the authorize-stamped record.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractJsonBlock } from '../util.js';
import { waveHistory } from './brief.js';
/** How many vectors one wave may focus — breadth beyond this is a second wave. */
export const MAX_FOCUS_VECTORS = 4;
/** How many vectors a fallback wave takes from the gap list. */
export const FALLBACK_FOCUS_COUNT = 3;
function nowIso(now) {
    return (now ?? new Date()).toISOString();
}
/**
 * The deterministic fallback plan: the next unfocused vectors from the
 * kind's roster, rotating by wave so successive fallback waves do not
 * repeat each other. Used whenever the coordinator's reply is missing,
 * unreadable, or invalid — the reason is carried on the plan.
 * @param rec - The campaign record.
 * @param kind - The campaign kind (roster source).
 * @param waveIndex - The wave being planned.
 * @param reason - Why the fallback is being used (recorded verbatim).
 * @param opts - Prior waves' focused vector names, and the clock.
 * @returns The fallback plan.
 */
export function deterministicFallbackPlan(rec, kind, waveIndex, reason, opts = {}) {
    const focused = new Set(opts.priorFocusVectors ?? []);
    const roster = kind.vectors;
    const start = ((waveIndex - 1) * FALLBACK_FOCUS_COUNT) % roster.length;
    const ordered = [...roster.slice(start), ...roster.slice(0, start)];
    const fresh = ordered.filter(v => !focused.has(v.name));
    const pool = fresh.length > 0 ? fresh : ordered;
    const focus = pool.slice(0, FALLBACK_FOCUS_COUNT).map(v => v.name);
    return {
        waveIndex,
        aim: `Coverage wave: ${focus.join(', ')} against ${rec.scope.hosts.join(', ')}`,
        focusVectors: focus,
        rationale: `Deterministic fallback roster (coverage-gap order). Fallback reason: ${reason}`,
        source: 'fallback',
        fallbackReason: reason,
        dropped: [],
        plannedAt: nowIso(opts.now),
    };
}
function plannerMessages(rec, kind, waveIndex, historyDigest) {
    const history = waveHistory(rec).filter(h => h.waveIndex < waveIndex);
    const digest = {
        campaign: rec.name,
        kind: kind.name,
        waveIndex,
        maxWaves: rec.caps.maxWaves,
        scopeHosts: rec.scope.hosts,
        objective: rec.objective,
        vectorRoster: kind.vectors.map(v => v.name),
        priorWaves: history.map(h => ({
            wave: h.waveIndex,
            aim: h.aim ?? null,
            engagementStatus: h.engagementStatus ?? null,
            findings: h.totalFindings,
            confirmed: h.confirmed,
            killed: h.killed,
            deferred: h.deferred,
        })),
        ...(historyDigest ? { historyDetail: historyDigest } : {}),
    };
    return [
        { role: 'system', content: `${kind.plannerPrompt}\n\n${kind.contract}` },
        { role: 'user', content: JSON.stringify(digest, null, 2) },
    ];
}
/**
 * Plan the next wave: ask the coordinator, validate what comes back,
 * and fall back deterministically when the reply cannot be used.
 * Never throws for planner/output failures — the fallback IS the
 * failure path, and its reason is on the returned plan.
 * @param rec - The campaign record.
 * @param kind - The campaign kind.
 * @param waveIndex - The wave to plan (>= 1).
 * @param opts - The injected completion, the history digest for the
 *   planner prompt, prior focus vectors (gap math), and the clock.
 * @returns The wave plan (coordinator-sourced or fallback).
 */
export async function planNextWave(rec, kind, waveIndex, opts = {}) {
    const fallback = (reason, dropped = []) => ({
        ...deterministicFallbackPlan(rec, kind, waveIndex, reason, opts),
        dropped,
    });
    if (!opts.completion)
        return fallback('no coordinator completion configured');
    let raw;
    try {
        raw = await opts.completion(plannerMessages(rec, kind, waveIndex, opts.historyDigest));
    }
    catch (err) {
        return fallback(`coordinator completion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    let parsed;
    try {
        parsed = extractJsonBlock(raw);
    }
    catch {
        return fallback('planner reply could not be read as JSON');
    }
    if (parsed === null)
        return fallback('planner reply could not be read as JSON');
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fallback('planner reply was not a JSON object');
    }
    const o = parsed;
    const dropped = [];
    const aim = typeof o.aim === 'string' ? o.aim.trim() : '';
    if (aim === '')
        return fallback('planner reply carried no usable aim', [{ item: 'plan', reason: 'missing or empty aim' }]);
    if (!Array.isArray(o.focusVectors)) {
        return fallback('planner reply carried no focusVectors array', [{ item: 'plan', reason: 'focusVectors missing or not an array' }]);
    }
    const roster = new Set(kind.vectors.map(v => v.name));
    const focus = [];
    for (const entry of o.focusVectors) {
        if (typeof entry !== 'string' || !roster.has(entry)) {
            dropped.push({ item: JSON.stringify(entry) ?? String(entry), reason: 'not a vector in the kind roster' });
            continue;
        }
        if (focus.includes(entry)) {
            dropped.push({ item: entry, reason: 'duplicate focus entry' });
            continue;
        }
        if (focus.length >= MAX_FOCUS_VECTORS) {
            dropped.push({ item: entry, reason: `focus cap is ${MAX_FOCUS_VECTORS} vectors per wave` });
            continue;
        }
        focus.push(entry);
    }
    if (focus.length === 0) {
        return fallback('planner reply named no valid focus vector', dropped);
    }
    return {
        waveIndex,
        aim,
        focusVectors: focus,
        rationale: typeof o.rationale === 'string' && o.rationale.trim() !== '' ? o.rationale.trim() : 'coordinator plan (no rationale given)',
        source: 'coordinator',
        dropped,
        plannedAt: nowIso(opts.now),
    };
}
/**
 * The plan artifact path for a wave: `<campaignDir>/wave-<n>/plan.json`.
 * @param campaignDir - The campaign's own directory.
 * @param waveIndex - The wave index.
 * @returns The plan file path.
 */
export function wavePlanPath(campaignDir, waveIndex) {
    return join(campaignDir, `wave-${waveIndex}`, 'plan.json');
}
/**
 * Persist a wave plan as the wave's artifact (plan.json + a readable
 * plan.md). The record's `planRef` points at the JSON.
 * @param campaignDir - The campaign's own directory.
 * @param plan - The plan to write.
 * @returns The planRef to store on the wave record (`wave-<n>/plan.json`).
 */
export function writeWavePlan(campaignDir, plan) {
    const dir = join(campaignDir, `wave-${plan.waveIndex}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    const md = [
        `# Wave ${plan.waveIndex} plan`,
        '',
        `- Aim: ${plan.aim}`,
        `- Focus: ${plan.focusVectors.join(', ')}`,
        `- Source: ${plan.source}${plan.fallbackReason ? ` (fallback: ${plan.fallbackReason})` : ''}`,
        `- Planned at: ${plan.plannedAt}`,
        '',
        plan.rationale,
        ...(plan.dropped.length > 0
            ? ['', 'Dropped planner entries:', ...plan.dropped.map(d => `- ${d.item} — ${d.reason}`)]
            : []),
        '',
    ].join('\n');
    writeFileSync(join(dir, 'plan.md'), md, 'utf8');
    return `wave-${plan.waveIndex}/plan.json`;
}
/**
 * Read a wave plan artifact back. Returns undefined when the file is
 * absent or unreadable — a missing plan is repaired by re-planning,
 * never treated as authority.
 * @param campaignDir - The campaign's own directory.
 * @param waveIndex - The wave index.
 * @returns The parsed plan, or undefined.
 */
export function loadWavePlan(campaignDir, waveIndex) {
    try {
        const raw = JSON.parse(readFileSync(wavePlanPath(campaignDir, waveIndex), 'utf8'));
        if (raw.waveIndex !== waveIndex || typeof raw.aim !== 'string' || !Array.isArray(raw.focusVectors))
            return undefined;
        return raw;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=planner.js.map