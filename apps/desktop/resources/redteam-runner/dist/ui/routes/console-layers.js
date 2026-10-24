/**
 * Operator console API — Layers & Gates view (Phase 5, view 2).
 *
 * GET /api/console/layers — read-only. Every section is independently
 * { available, reason?, ... }: a missing source degrades one panel, never
 * the page, and nothing is fabricated. Sources (all plain files):
 *   TS layers    <layersDir>/<id>/meta.json + <layersDir>/active.json
 *   Python       pyRegistryPath (layer_registry.json) + EXPERIENCE.md beside it
 *   Gate queue   <harness2Root>/runs/<id>/{proposal,probe}.json,
 *                <harness2Root>/runs/<stamp>-<class>/package.json,
 *                <harness2Root>/verdicts.jsonl
 *   Alerts       <harness2Root>/monitor/evaluations.jsonl (auto-rollback
 *                monitor) + <harness2Root>/lifecycle/incidents.jsonl
 *
 * Response:
 * {
 *   generatedAt: string,
 *   alerts:      Section<{ items: Alert[] }>,
 *   composition: Section<{ updatedAt: string | null, activeIds: string[] }>,
 *   layers:      Section<{ items: LayerRow[] }>,
 *   experience:  Section<{ lines: string[] }>,
 *   gateQueue:   Section<{ items: GateItem[] }>,
 * }
 * Alert    = { severity: "red" | "amber", kind, ts, layerId, targetClass, detail }
 * LayerRow = { id, source: "ts" | "python", targetClass, status, adoptedAt,
 *              installedAt, evidence, baseline, shaShort, active, activeIndex }
 * GateItem = { id, kind: "proposal" | "package", targetClass, component,
 *              status, verdict, adopted, reason, recordedAt,
 *              baseRuns, candidateRuns }
 * (nullable fields above are `string | null` / `number | null` unless noted.)
 */
import { dirname, join } from 'node:path';
import { consolePaths, existsSafe, listSubdirs, readJsonSafe, readJsonlTail, readTextSafe, } from '../console/shared.js';
import { json } from './http.js';
function isRec(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v) {
    return typeof v === 'string' && v !== '' ? v : null;
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function unavailable(reason) {
    return { available: false, reason };
}
/* ---------------- alerts: monitor evaluations + lifecycle incidents ------- */
function buildAlerts(root) {
    if (!root)
        return unavailable('harness2 root not resolved');
    const evalPath = join(root, 'monitor', 'evaluations.jsonl');
    const incPath = join(root, 'lifecycle', 'incidents.jsonl');
    if (!existsSafe(evalPath) && !existsSafe(incPath)) {
        return unavailable('no monitor evaluations or incident log under the harness2 root');
    }
    const items = [];
    for (const raw of readJsonlTail(incPath, 50)) {
        if (!isRec(raw))
            continue;
        items.push({
            severity: 'red',
            kind: str(raw.kind) ?? 'incident',
            ts: str(raw.ts),
            layerId: str(raw.layerId),
            targetClass: str(raw.targetClass),
            detail: str(raw.detail) ?? str(raw.action) ?? 'incident recorded',
        });
    }
    for (const raw of readJsonlTail(evalPath, 100)) {
        if (!isRec(raw))
            continue;
        const rules = isRec(raw.rules) ? raw.rules : {};
        const action = str(raw.action) ?? 'none';
        const fired = rules.sDrop === true || rules.crRise === true || rules.guardrailTouch === true;
        if (action === 'none' && !fired)
            continue;
        items.push({
            severity: action === 'none' ? 'amber' : 'red',
            kind: action === 'rolled-back' ? 'auto-rollback' : action === 'deactivated-incident' ? 'guardrail deactivation' : 'regression rule fired',
            ts: str(raw.ts),
            layerId: str(raw.layerId),
            targetClass: str(raw.targetClass),
            detail: str(raw.note) ?? action,
        });
    }
    items.sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
    return { available: true, items: items.slice(0, 20) };
}
/* ---------------- composition + TS layers --------------------------------- */
function readActive(layersDir) {
    const raw = readJsonSafe(join(layersDir, 'active.json'));
    if (!isRec(raw) || !Array.isArray(raw.layerIds))
        return { ids: [], updatedAt: null };
    return { ids: raw.layerIds.filter((x) => typeof x === 'string'), updatedAt: str(raw.updatedAt) };
}
function buildTsLayers(layersDir, activeIds) {
    return listSubdirs(layersDir)
        .filter(name => !name.startsWith('.'))
        .map((name) => {
        const meta = readJsonSafe(join(layersDir, name, 'meta.json'));
        const m = isRec(meta) ? meta : null;
        const sha = m ? str(m.sha256) : null;
        const idx = activeIds.indexOf(name);
        return {
            id: m ? str(m.id) ?? name : name,
            source: 'ts',
            targetClass: m ? str(m.targetClass) : null,
            status: m ? null : 'unreadable meta.json',
            adoptedAt: m ? str(m.adoptedAt) : null,
            installedAt: m ? str(m.installedAt) : null,
            evidence: m ? str(m.evidenceRunId) : null,
            baseline: null,
            shaShort: sha ? sha.slice(0, 12) : null,
            active: idx >= 0,
            activeIndex: idx >= 0 ? idx + 1 : null,
        };
    });
}
/* ---------------- Python harness registry ------------------------------- */
function registryEntries(raw) {
    if (Array.isArray(raw))
        return raw.filter(isRec);
    if (isRec(raw) && Array.isArray(raw.layers))
        return raw.layers.filter(isRec);
    if (isRec(raw)) {
        return Object.entries(raw)
            .filter(([, v]) => isRec(v))
            .map(([k, v]) => ({ ...v, layer_id: str(v.layer_id) ?? k }));
    }
    return [];
}
function buildPyLayers(registryPath) {
    return registryEntries(readJsonSafe(registryPath)).map((e) => {
        const acc = num(e.baseline_accuracy);
        const n = num(e.baseline_n);
        const status = str(e.status);
        return {
            id: str(e.layer_id) ?? str(e.id) ?? str(e.name) ?? '(unnamed)',
            source: 'python',
            targetClass: str(e.target_class) ?? str(e.targetClass),
            status,
            adoptedAt: str(e.adopted_on) ?? str(e.adoptedAt),
            installedAt: null,
            evidence: str(e.parent_layer) ? `parent ${str(e.parent_layer)}` : null,
            baseline: acc !== null ? `accuracy ${acc}${n !== null ? ` (n=${n})` : ''}` : null,
            shaShort: null,
            active: status === 'adopted',
            activeIndex: null,
        };
    });
}
function buildExperience(registryPath) {
    if (!registryPath)
        return unavailable('Python registry not configured (REDTEAM_PY_REGISTRY)');
    const path = join(dirname(registryPath), 'EXPERIENCE.md');
    const text = readTextSafe(path, 1_048_576);
    if (text === null)
        return unavailable('no EXPERIENCE.md beside the Python registry');
    const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim().length > 0);
    return { available: true, lines: lines.slice(-10) };
}
/* ---------------- gate queue ---------------------------------------------- */
function buildGateQueue(root) {
    if (!root)
        return unavailable('harness2 root not resolved');
    const runsDir = join(root, 'runs');
    if (!existsSafe(runsDir) && !existsSafe(join(root, 'verdicts.jsonl'))) {
        return unavailable('no runs directory or verdict log under the harness2 root');
    }
    const verdicts = new Map();
    for (const raw of readJsonlTail(join(root, 'verdicts.jsonl'), 300)) {
        if (!isRec(raw))
            continue;
        const pid = str(raw.proposalId);
        if (pid)
            verdicts.set(pid, raw);
    }
    const items = [];
    const seen = new Set();
    for (const name of listSubdirs(runsDir)) {
        if (name === 'probe-engagements')
            continue;
        const dir = join(runsDir, name);
        const proposal = readJsonSafe(join(dir, 'proposal.json'));
        const pkg = proposal === null ? readJsonSafe(join(dir, 'package.json')) : null;
        if (isRec(proposal)) {
            const id = str(proposal.id) ?? name;
            seen.add(id);
            const v = verdicts.get(id) ?? null;
            const probed = existsSafe(join(dir, 'probe.json'));
            items.push({
                id, kind: 'proposal',
                targetClass: str(proposal.targetClass),
                component: str(proposal.component),
                status: v ? str(v.verdict) ?? 'verdict recorded' : probed ? 'probed — awaiting verdict record' : 'awaiting probe',
                verdict: v ? str(v.verdict) : null,
                adopted: v ? (typeof v.adopted === 'boolean' ? v.adopted : null) : null,
                reason: v ? str(v.reason) : null,
                recordedAt: v ? str(v.recordedAt) : null,
                baseRuns: v ? num(v.baseRuns) : null,
                candidateRuns: v ? num(v.candidateRuns) : null,
            });
        }
        else if (isRec(pkg)) {
            const header = isRec(pkg.header) ? pkg.header : {};
            items.push({
                id: name, kind: 'package',
                targetClass: str(header.target_class) ?? str(header.targetClass),
                component: null,
                status: 'package generated',
                verdict: null, adopted: null, reason: null, recordedAt: str(header.date),
                baseRuns: null, candidateRuns: null,
            });
        }
    }
    for (const [id, v] of verdicts) {
        if (seen.has(id))
            continue;
        items.push({
            id, kind: 'proposal', targetClass: str(v.targetClass), component: null,
            status: str(v.verdict) ?? 'verdict recorded', verdict: str(v.verdict),
            adopted: typeof v.adopted === 'boolean' ? v.adopted : null,
            reason: str(v.reason), recordedAt: str(v.recordedAt),
            baseRuns: num(v.baseRuns), candidateRuns: num(v.candidateRuns),
        });
    }
    const rank = (s) => (s === 'awaiting probe' || s === 'package generated' ? 0 : String(s).startsWith('probed') ? 1 : 2);
    items.sort((a, b) => rank(a.status) - rank(b.status) || String(b.recordedAt ?? '').localeCompare(String(a.recordedAt ?? '')) || String(a.id).localeCompare(String(b.id)));
    return { available: true, items: items.slice(0, 50) };
}
/* ---------------- handler -------------------------------------------------- */
export function handleConsoleLayers(store, res) {
    const paths = consolePaths(store);
    const active = paths.layersDir ? readActive(paths.layersDir) : { ids: [], updatedAt: null };
    const composition = paths.layersDir
        ? { available: true, updatedAt: active.updatedAt, activeIds: active.ids }
        : unavailable('layers directory not resolved');
    const activeIds = active.ids;
    const layerItems = [
        ...(paths.layersDir ? buildTsLayers(paths.layersDir, activeIds) : []),
        ...(paths.pyRegistryPath ? buildPyLayers(paths.pyRegistryPath) : []),
    ];
    const layers = paths.layersDir || paths.pyRegistryPath
        ? { available: true, items: layerItems }
        : unavailable('neither a TS layers directory nor a Python registry is configured');
    json(res, 200, {
        generatedAt: new Date().toISOString(),
        alerts: buildAlerts(paths.harness2Root),
        composition,
        layers,
        experience: buildExperience(paths.pyRegistryPath),
        gateQueue: buildGateQueue(paths.harness2Root),
    });
}
//# sourceMappingURL=console-layers.js.map