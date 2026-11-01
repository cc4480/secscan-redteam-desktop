/**
 * Operator console API — Scope & Safety view (Phase 5, view 4).
 *
 * GET /api/console/scope — read-only. Aggregates the refusal and halt
 * records the dispatcher already writes to each engagement's events.jsonl,
 * across the 25 most recent engagement dirs under the console engagements
 * dir (including a live/ level when the dir is the parent). Nothing here
 * is inferred: every count traces to an event action the code appends.
 *
 * Grounded event actions (append sites verified in source):
 *   scope_violation           dispatch/scope-gate.ts — deny-beats-allow
 *                             scope refusal (host or command-text target)
 *   policy_denied             dispatch/policy-gate.ts — operator policy
 *   hook_evaluated (deny)     dispatch/policy-gate.ts — PreToolUse hook
 *                             evaluations; a denial is the evaluation
 *                             whose result reads "<phase>:<name> deny …"
 *   scope_authorization_denied phases/authorize.ts — engagement refused
 *                             before it started (target = the domain)
 *   target_auto_halt          dispatch/router.ts — per-target distress
 *                             halt (target = halted host)
 *   abort_engagement          dispatch/router.ts — operator kill switch
 *                             / coordinator abort record
 *   engagement_halted         phases/run.ts — the run unwound to halted;
 *                             the reason text is classified below
 *
 * NOT recorded in events.jsonl, therefore never counted here (see notes):
 * autonomy-tier denials, variant-cap denials, and halted-host refusals —
 * dispatch returns those denial strings without appending an event.
 * Events also carry no tool name, so records omit it rather than guess.
 *
 * Response:
 * {
 *   generatedAt: string,
 *   available: true,
 *   window: { engagementsScanned: number },
 *   totals: { denials, scopeViolations, policyDenials, hookDenials,
 *             authorizationDenied, targetAutoHalts, engagementHalts,
 *             aborts, halts },
 *   haltReasons: [{ reason, count }],           // engagement_halted only
 *   perEngagement: [{ id, target, startedAt, denials, halts, total }],
 *   latest: [{ ts, engagementId, kind, target, reason }],   // newest 50
 *   notes: string[],
 * }
 * An engagements root with no engagement dirs yet answers the same
 * aggregate with every count zero and engagementsScanned 0 — an empty
 * history is a valid state, not an error.
 * `denials` counts refused calls: each was refused inside dispatch,
 * before any handler ran — zero packets left the machine for them.
 * `halts` = targetAutoHalts + engagementHalts (aborts are counted
 * separately; an abort normally also produces an engagement_halted).
 */
import { join } from 'node:path';
import { consolePaths, existsSafe, listSubdirs, readJsonSafe, readTextSafe } from '../console/shared.js';
import { json } from './http.js';
const MAX_ENGAGEMENTS = 25;
const MAX_LATEST = 50;
const EVENTS_READ_CAP = 8_388_608; // matches the shared readers' ceiling
function isRec(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v) {
    return typeof v === 'string' && v !== '' ? v : null;
}
function emptyCounts() {
    return { scopeViolations: 0, policyDenials: 0, hookDenials: 0, authorizationDenied: 0, targetAutoHalts: 0, engagementHalts: 0, aborts: 0 };
}
function denialsOf(c) {
    return c.scopeViolations + c.policyDenials + c.hookDenials + c.authorizationDenied;
}
function haltsOf(c) {
    return c.targetAutoHalts + c.engagementHalts;
}
/** Classify an engagement_halted reason text (phases/run.ts + agents.ts). */
function classifyHaltReason(result) {
    if (/action cap reached/i.test(result))
        return 'action_cap';
    if (/duration cap reached/i.test(result))
        return 'duration_cap';
    if (/three consecutive 5xx/i.test(result))
        return 'target_distress_5xx';
    if (/kill switch|aborted by operator/i.test(result))
        return 'operator_abort';
    if (/aborted by coordinator/i.test(result))
        return 'coordinator_abort';
    if (/sign-off/i.test(result))
        return 'signoff_withheld';
    return 'other';
}
/** Hook evaluation result format: "<phase>:<name> <decision> <ms>ms …". */
function hookDecision(result) {
    const m = /^[^:]+:\S+\s+(allow|deny|modify)\b/.exec(result);
    return m ? m[1] : null;
}
/** Map one parsed events.jsonl line to a safety record, or null. */
function toRecord(ev, fallbackId) {
    const action = str(ev.action);
    if (!action)
        return null;
    const result = str(ev.result) ?? '';
    const base = {
        ts: str(ev.ts) ?? '',
        engagementId: str(ev.engagementId) ?? fallbackId,
        target: str(ev.target),
        reason: result.slice(0, 400),
    };
    switch (action) {
        case 'scope_violation':
            return { record: { ...base, kind: 'scope_violation' } };
        case 'policy_denied':
            return { record: { ...base, kind: 'policy_denied' } };
        case 'scope_authorization_denied':
            return { record: { ...base, kind: 'scope_authorization_denied' } };
        case 'target_auto_halt':
            return { record: { ...base, kind: 'target_auto_halt' } };
        case 'abort_engagement':
            return { record: { ...base, kind: 'abort_engagement' } };
        case 'engagement_halted':
            return { record: { ...base, kind: 'engagement_halted' }, haltReason: classifyHaltReason(result) };
        case 'hook_evaluated':
            return hookDecision(result) === 'deny' ? { record: { ...base, kind: 'hook_denied' } } : null;
        default:
            return null;
    }
}
function countKind(c, kind) {
    if (kind === 'scope_violation')
        c.scopeViolations++;
    else if (kind === 'policy_denied')
        c.policyDenials++;
    else if (kind === 'hook_denied')
        c.hookDenials++;
    else if (kind === 'scope_authorization_denied')
        c.authorizationDenied++;
    else if (kind === 'target_auto_halt')
        c.targetAutoHalts++;
    else if (kind === 'engagement_halted')
        c.engagementHalts++;
    else if (kind === 'abort_engagement')
        c.aborts++;
}
/** Engagement dirs under the console engagements dir (plus its live/ level). */
function discoverEngagements(engagementsDir) {
    const roots = [engagementsDir];
    const live = join(engagementsDir, 'live');
    if (existsSafe(live))
        roots.push(live);
    const seen = new Set();
    const out = [];
    for (const root of roots) {
        for (const name of listSubdirs(root)) {
            const dir = join(root, name);
            if (seen.has(dir))
                continue;
            seen.add(dir);
            if (!existsSafe(join(dir, 'events.jsonl')) && !existsSafe(join(dir, 'state.json')))
                continue;
            const state = readJsonSafe(join(dir, 'state.json'));
            const s = isRec(state) ? state : null;
            out.push({ id: name, dir, startedAt: s ? str(s.startedAt) ?? '' : '', target: s ? str(s.target) : null });
        }
    }
    out.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    return out.slice(0, MAX_ENGAGEMENTS);
}
/** Parse one engagement's events.jsonl (first 8 MiB, as the shared readers cap). */
function readEvents(dir) {
    const text = readTextSafe(join(dir, 'events.jsonl'), EVENTS_READ_CAP);
    if (text === null)
        return [];
    const out = [];
    for (const line of text.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const v = JSON.parse(line);
            if (isRec(v))
                out.push(v);
        }
        catch {
            /* skip a torn line rather than failing the whole engagement */
        }
    }
    return out;
}
export function handleConsoleScope(store, res) {
    const paths = consolePaths(store);
    const engagements = discoverEngagements(paths.engagementsDir);
    const totals = emptyCounts();
    const haltReasonCounts = new Map();
    const latest = [];
    const perEngagement = [];
    for (const eng of engagements) {
        const c = emptyCounts();
        for (const ev of readEvents(eng.dir)) {
            const hit = toRecord(ev, eng.id);
            if (!hit)
                continue;
            countKind(c, hit.record.kind);
            countKind(totals, hit.record.kind);
            if (hit.haltReason)
                haltReasonCounts.set(hit.haltReason, (haltReasonCounts.get(hit.haltReason) ?? 0) + 1);
            latest.push(hit.record);
        }
        perEngagement.push({
            id: eng.id,
            target: eng.target,
            startedAt: eng.startedAt || null,
            denials: denialsOf(c),
            halts: haltsOf(c),
            total: denialsOf(c) + haltsOf(c) + c.aborts,
        });
    }
    latest.sort((a, b) => b.ts.localeCompare(a.ts));
    perEngagement.sort((a, b) => Number(b.total) - Number(a.total) || String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
    json(res, 200, {
        generatedAt: new Date().toISOString(),
        available: true,
        window: { engagementsScanned: engagements.length },
        totals: { ...totals, denials: denialsOf(totals), halts: haltsOf(totals) },
        haltReasons: [...haltReasonCounts.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
        perEngagement,
        latest: latest.slice(0, MAX_LATEST),
        notes: [
            ...(engagements.length === 0
                ? ['No engagements recorded yet under the console engagements dir — every count here is a true zero, not a read failure.']
                : []),
            'Autonomy-tier denials, variant-cap denials, and halted-host refusals are returned by dispatch without an events.jsonl record, so they are not counted here.',
            'Events do not record a tool name; records show the target host and the recorded reason only.',
            "Counts cover each engagement's current events.jsonl (first 8 MiB); rotated archives are not read.",
        ],
    });
}
//# sourceMappingURL=console-scope.js.map