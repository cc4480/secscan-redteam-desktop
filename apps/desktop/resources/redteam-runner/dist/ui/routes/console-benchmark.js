/**
 * Console API route — Benchmark view (Phase 5 console, view 3). READ-ONLY.
 *
 * Serves GET /api/console/benchmark from the standing benchmark suite's own
 * output files (HISTORY.md ledger + score.py results JSONs). Nothing here
 * writes, scores, or re-adjudicates: the manifest-governed numbers produced
 * by benchmark/score.py are rendered as recorded. A missing benchmark dir is
 * reported as unavailable, never papered over — honest absence is a feature
 * of this console.
 *
 * Response fields:
 * {
 *   available: boolean,
 *   reason?: string,            // set when available=false
 *   benchmarkDir?: string,
 *   history?: {                  // HISTORY.md from the benchmark dir
 *     markdown: string | null,   // raw file text, exactly as recorded
 *     rows: Array<{ date, condition, versions, sr, vf, fpr, steps, tok, cr,
 *       chain, refusal, provenShare, notes, cells: string[] }>  // as written
 *   },
 *   latestRun?: {                // newest results-<condition>-<date>.json
 *     file: string,              // file name the run was read from
 *     condition: string | null,
 *     scoredOn: string | null,
 *     baseCondition: string | null,
 *     metrics: { nEngagements, sr, vf, fpr, steps, tok, cr, s, claimsTotal,
 *                fpTotal, provenClaims, provenShare, chainProven,
 *                refusalProven, scopeViolations },  // numbers|null, as recorded
 *     targets: Array<{
 *       id: string,              // manifest target name, e.g. "clean-03"
 *       class: string,           // manifest class (chain/refusal/clean/…)
 *       findings: number,        // distinct PROVEN findings (manifest-governed)
 *       expected: number,        // findings the manifest expects
 *       claims: number,
 *       falsePositives: number,
 *       provenFindings: string[],
 *       expectedFindings: string[],
 *       fpReasons: string[],
 *       verdict: "FP_REGRESSION" | "CLEAN" | "ALL_PROVEN"
 *              | "PARTIAL" | "NONE_PROVEN"
 *     }>
 *   } | null,
 *   runs?: Array<{ file, condition, scoredOn, mtimeMs }>,  // all results files
 *   callouts: Array<
 *     | { kind: "fp-regression", target: string, condition: string | null,
 *         falsePositives: number, text: string }
 *     | { kind: "delta", metric: string, from: string, to: string,
 *         delta: number, text: string } >
 * }
 *
 * Results files are score.py's per-condition outputs, looked for in the
 * benchmark dir itself and in its benchmark-results/ subdir (score.py's
 * default --out). "Newest" is by file mtime, name as tiebreak.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { consolePaths, existsSafe, readJsonSafe, readTextSafe } from '../console/shared.js';
import { json } from './http.js';
function isRec(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v) {
    return typeof v === 'string' ? v : null;
}
function strList(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}
/** Parse the HISTORY.md ledger table into rows (best-effort, header-mapped). */
function parseHistoryRows(markdown) {
    if (!markdown)
        return [];
    const tableLines = markdown
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('|') && l.endsWith('|'));
    if (tableLines.length < 2)
        return [];
    const cells = (line) => line.slice(1, -1).split('|').map(c => c.trim());
    const header = cells(tableLines[0]).map(h => h.toLowerCase());
    const keyFor = (h) => {
        if (h.startsWith('date'))
            return 'date';
        if (h.startsWith('condition'))
            return 'condition';
        if (h.startsWith('code'))
            return 'versions';
        if (h === 'sr')
            return 'sr';
        if (h === 'vf')
            return 'vf';
        if (h === 'fpr')
            return 'fpr';
        if (h === 'steps')
            return 'steps';
        if (h === 'tok')
            return 'tok';
        if (h === 'cr')
            return 'cr';
        if (h.startsWith('chain'))
            return 'chain';
        if (h.startsWith('refusal'))
            return 'refusal';
        if (h.startsWith('proven'))
            return 'provenShare';
        if (h.startsWith('notes'))
            return 'notes';
        return h;
    };
    const rows = [];
    for (const line of tableLines.slice(1)) {
        const cs = cells(line);
        if (cs.every(c => /^-+$/.test(c.replace(/[: ]/g, ''))))
            continue; // separator
        if (cs.every(c => c === ''))
            continue;
        const row = { cells: cs };
        header.forEach((h, i) => {
            row[keyFor(h)] = cs[i] ?? '';
        });
        rows.push(row);
    }
    return rows;
}
/** Headline deltas between the last two HISTORY rows, where numbers parse. */
function historyDeltas(rows) {
    if (rows.length < 2)
        return [];
    const prev = rows[rows.length - 2];
    const last = rows[rows.length - 1];
    const out = [];
    const metrics = [
        ['sr', 'SR'], ['vf', 'VF'], ['fpr', 'FPR'], ['cr', 'CR'], ['provenShare', 'PROVEN share'],
    ];
    for (const [key, label] of metrics) {
        const a = Number.parseFloat(String(prev[key] ?? ''));
        const b = Number.parseFloat(String(last[key] ?? ''));
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === b)
            continue;
        const delta = Math.round((b - a) * 10000) / 10000;
        out.push({
            kind: 'delta', metric: label,
            from: String(prev[key]), to: String(last[key]), delta,
            text: `${label} ${prev[key]} → ${last[key]} (Δ ${delta > 0 ? '+' : ''}${delta}) ` +
                `between ${prev.date ?? '?'} (${prev.condition ?? '?'}) and ` +
                `${last.date ?? '?'} (${last.condition ?? '?'})`,
        });
    }
    return out;
}
/** Locate results-*.json files in the benchmark dir (+ benchmark-results/). */
function findResultsFiles(dir) {
    const found = [];
    for (const base of [dir, join(dir, 'benchmark-results')]) {
        let names = [];
        try {
            names = readdirSync(base);
        }
        catch {
            continue; // subdir simply absent — the root scan already ran
        }
        for (const name of names) {
            if (!/^results-.+\.json$/.test(name))
                continue;
            const path = join(base, name);
            let mtimeMs = 0;
            try {
                mtimeMs = statSync(path).mtimeMs;
            }
            catch {
                mtimeMs = 0; // unreadable stat — keep the file, sorted last
            }
            found.push({ path, file: name, mtimeMs });
        }
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));
    return found;
}
/** Target classes from manifest_v2.json when present; id prefix otherwise. */
function manifestClasses(dir) {
    const out = new Map();
    const manifest = readJsonSafe(join(dir, 'manifest_v2.json'));
    if (isRec(manifest) && Array.isArray(manifest.targets)) {
        for (const t of manifest.targets) {
            if (isRec(t) && typeof t.name === 'string' && typeof t.class === 'string') {
                out.set(t.name, t.class);
            }
        }
    }
    return out;
}
function targetVerdict(id, findings, expected, fp) {
    if (id.startsWith('clean-')) {
        return fp > 0 || findings > 0 ? 'FP_REGRESSION' : 'CLEAN';
    }
    if (expected > 0 && findings >= expected)
        return 'ALL_PROVEN';
    if (findings > 0)
        return 'PARTIAL';
    return 'NONE_PROVEN';
}
/** Map one score.py results file to the latestRun response value. */
function toLatestRun(entry, classes) {
    const raw = readJsonSafe(entry.path);
    if (!isRec(raw))
        return null;
    const perTarget = isRec(raw.per_target) ? raw.per_target : {};
    const targets = [];
    for (const id of Object.keys(perTarget).sort()) {
        const pt = isRec(perTarget[id]) ? perTarget[id] : {};
        const provenFindings = strList(pt.proven_findings);
        const expectedFindings = strList(pt.expected_findings);
        const fp = num(pt.fp) ?? 0;
        targets.push({
            id,
            class: classes.get(id) ?? id.replace(/-\d+$/, ''),
            findings: provenFindings.length,
            expected: expectedFindings.length,
            claims: num(pt.claims) ?? 0,
            falsePositives: fp,
            provenFindings,
            expectedFindings,
            fpReasons: strList(pt.fp_reasons),
            verdict: targetVerdict(id, provenFindings.length, expectedFindings.length, fp),
        });
    }
    return {
        file: entry.file,
        condition: str(raw.condition),
        scoredOn: str(raw.scored_on),
        baseCondition: str(raw.base_condition),
        metrics: {
            nEngagements: num(raw.n_engagements),
            sr: num(raw.SR), vf: num(raw.VF), fpr: num(raw.FPR),
            steps: num(raw.STEPS), tok: num(raw.TOK), cr: num(raw.CR), s: num(raw.S),
            claimsTotal: num(raw.claims_total), fpTotal: num(raw.fp_total),
            provenClaims: num(raw.proven_claims), provenShare: num(raw.proven_share),
            chainProven: num(raw.chain_proven), refusalProven: num(raw.refusal_proven),
            scopeViolations: num(raw.scope_violations),
        },
        targets,
    };
}
/**
 * Handle GET /api/console/benchmark.
 * @param store - the UI store (paths resolve through consolePaths)
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export function handleConsoleBenchmark(store, res) {
    const { benchmarkDir } = consolePaths(store);
    if (!benchmarkDir || !existsSafe(benchmarkDir)) {
        json(res, 200, {
            available: false,
            reason: 'REDTEAM_BENCHMARK_DIR not set (or path missing)',
            callouts: [],
        });
        return;
    }
    const markdown = readTextSafe(join(benchmarkDir, 'HISTORY.md'), 1_048_576);
    const rows = parseHistoryRows(markdown);
    const classes = manifestClasses(benchmarkDir);
    const files = findResultsFiles(benchmarkDir);
    const latestRun = files.length > 0 ? toLatestRun(files[0], classes) : null;
    const callouts = [];
    if (latestRun && Array.isArray(latestRun.targets)) {
        for (const t of latestRun.targets) {
            // The suite's own rule: any finding recorded against a clean-* target
            // is a false positive, and an FP there is a headline regression.
            if (t.verdict === 'FP_REGRESSION') {
                callouts.push({
                    kind: 'fp-regression',
                    target: t.id,
                    condition: latestRun.condition,
                    falsePositives: t.falsePositives,
                    text: `FALSE-POSITIVE REGRESSION: ${t.id} recorded ` +
                        `${t.falsePositives} false positive(s) under ` +
                        `${latestRun.condition ?? 'unknown condition'} — clean targets ` +
                        'must stay silent; any FP there is a headline regression ' +
                        'regardless of the rest of the run.',
                });
            }
        }
    }
    callouts.push(...historyDeltas(rows));
    json(res, 200, {
        available: true,
        benchmarkDir,
        history: { markdown, rows },
        latestRun,
        runs: files.map((f) => {
            const raw = readJsonSafe(f.path);
            return {
                file: f.file,
                condition: isRec(raw) ? str(raw.condition) : null,
                scoredOn: isRec(raw) ? str(raw.scored_on) : null,
                mtimeMs: f.mtimeMs,
            };
        }),
        callouts,
    });
}
//# sourceMappingURL=console-benchmark.js.map