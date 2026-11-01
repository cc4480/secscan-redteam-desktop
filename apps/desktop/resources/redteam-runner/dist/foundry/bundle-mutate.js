/**
 * Evolution — operators-v1, bundle surface (reference: evolution.py).
 *
 * Deterministic, label-preserving transforms over a snapshot bundle's
 * files. Every operator verifies its anchors and FAILS LOUD on a miss.
 * The naive-filter operator inserts a per-class naive blacklist
 * IDENTICALLY into both twins (twin integrity preserved) and upgrades
 * the probe to the bypassing payload.
 */
import { createHash } from 'node:crypto';
import { PARAM_NAMES, ROUTE_SYNONYMS, pick } from './mutate.js';
const BUNDLE_FILES = ['spec.json', 'vuln/app.py', 'patched/app.py', 'probe.py'];
/** Short operator codes used in mutant slugs. */
export const OPERATOR_CODES = {
    'marker-rotate': 'mr',
    'rename-param': 'rp',
    'rename-route': 'rr',
    'reskin': 'rs',
    'naive-filter': 'nf',
};
function parseSpec(files) {
    const raw = files.get('spec.json');
    if (!raw)
        return { ok: false, error: 'spec.json missing' };
    try {
        const spec = JSON.parse(raw);
        if (typeof spec.marker !== 'string' || !Array.isArray(spec.endpoints)) {
            return { ok: false, error: 'spec.json lacks marker/endpoints anchors' };
        }
        return { ok: true, value: spec };
    }
    catch {
        return { ok: false, error: 'spec.json does not parse' };
    }
}
function replaceAll(files, from, to) {
    let count = 0;
    for (const [path, content] of files) {
        if (!content.includes(from))
            continue;
        const next = content.split(from).join(to);
        count += content.split(from).length - 1;
        files.set(path, next);
    }
    return count;
}
const NAIVE_FILTERS = {
    'sql-injection': { blacklist: ["'1'='1'", '"1"="1"', "' or '1'"], mode: 'block' },
    'cross-site-scripting': { blacklist: ['<script'], mode: 'block' },
    ssrf: { blacklist: ['127.0.0.1'], mode: 'block' },
    'path-traversal': { blacklist: ['../'], mode: 'strip-once' },
};
function upgradeProbePayload(files, vulnClass) {
    const probe = files.get('probe.py');
    if (!probe)
        return { ok: false, error: 'probe.py missing' };
    const payloadMatch = /PAYLOAD = "([^"]*)"/.exec(probe);
    if (!payloadMatch)
        return { ok: false, error: 'probe PAYLOAD anchor missing' };
    const payload = payloadMatch[1] ?? '';
    let upgraded = null;
    if (vulnClass === 'sql-injection' && /'1'\s*=\s*'1'/.test(payload)) {
        upgraded = payload.replace(/'1'\s*=\s*'1'/, '1=1');
    }
    else if (vulnClass === 'cross-site-scripting') {
        const scripted = /^<script>(.*)<\/script>$/.exec(payload);
        if (scripted)
            upgraded = `<svg onload=${scripted[1]}>`;
    }
    else if (vulnClass === 'ssrf' && payload.includes('127.0.0.1')) {
        upgraded = payload.split('127.0.0.1').join('localhost');
    }
    else if (vulnClass === 'path-traversal') {
        if (payload.includes('....//') || (payload.match(/\.\.\//g) ?? []).length >= 2)
            upgraded = payload;
    }
    if (upgraded === null)
        return { ok: false, error: `no bypass transform for the ${vulnClass} probe payload` };
    if (upgraded !== payload)
        files.set('probe.py', probe.replace(`PAYLOAD = "${payload}"`, `PAYLOAD = "${upgraded}"`));
    return { ok: true, value: null };
}
function insertNaiveFilter(files, vulnClass) {
    const config = NAIVE_FILTERS[vulnClass];
    if (!config)
        return { ok: false, error: `no naive-filter config for class ${vulnClass}` };
    for (const path of ['vuln/app.py', 'patched/app.py']) {
        const app = files.get(path);
        if (!app)
            return { ok: false, error: `${path} missing` };
        if (!app.includes('class Handler') || !app.includes('def do_GET(self):') || !app.includes('urlparse')) {
            return { ok: false, error: `${path} lacks the handler anchors the filter inserts at` };
        }
        let next = app;
        if (config.mode === 'block') {
            if (!app.includes('parse_qs'))
                return { ok: false, error: `${path} lacks parse_qs` };
            const helper = `\nNAIVE_BLACKLIST = (${config.blacklist.map(b => JSON.stringify(b)).join(', ')},)\n\n\n` +
                'def _naive_blocked(value):\n' +
                '    lowered = value.lower()\n' +
                '    return any(bad in lowered for bad in NAIVE_BLACKLIST)\n\n\n';
            next = next.replace('class Handler', `${helper}class Handler`);
            const insertion = '        _qs = parse_qs(urlparse(self.path).query)\n' +
                '        if any(_naive_blocked(v) for _vals in _qs.values() for v in _vals):\n' +
                '            self.path = urlparse(self.path).path\n';
            next = next.replace('    def do_GET(self):\n', `    def do_GET(self):\n${insertion}`);
        }
        else {
            const insertion = '        self.path = self.path.replace("../", "", 1)\n';
            next = next.replace('    def do_GET(self):\n', `    def do_GET(self):\n${insertion}`);
        }
        if (next === app)
            return { ok: false, error: `${path}: filter insertion did not land` };
        files.set(path, next);
    }
    return { ok: true, value: null };
}
/**
 * Apply one operator to a snapshot bundle's files (in memory).
 *
 * @param files - the seed bundle's files (not mutated; a copy is returned)
 * @param operator - the operator to apply
 * @param seedSlug - the seed bundle slug
 * @param cycle - the loop cycle number
 * @returns the mutant files + chosen anchors, or the loud failure
 */
export function applyBundleOperator(files, operator, seedSlug, cycle) {
    const out = new Map(files);
    const specOutcome = parseSpec(out);
    if (!specOutcome.ok)
        return specOutcome;
    const spec = specOutcome.value;
    const key = `${seedSlug}:${operator}:${cycle}`;
    switch (operator) {
        case 'marker-rotate': {
            const digest = createHash('sha256').update(key, 'utf8').digest('hex').toUpperCase();
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let suffix = '';
            for (let i = 0; i < 5 && i * 2 + 1 < digest.length; i++) {
                suffix += alphabet[parseInt(digest.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
            }
            const parts = spec.marker.split('-');
            const next = `${parts[0] ?? 'FNDRY'}-${parts[1] ?? 'CASE'}-${suffix}`;
            if (next === spec.marker)
                return { ok: false, error: 'marker rotation produced the seed marker' };
            for (const path of BUNDLE_FILES) {
                if (!out.get(path)?.includes(spec.marker))
                    return { ok: false, error: `marker anchor missing in ${path}` };
            }
            replaceAll(out, spec.marker, next);
            return { ok: true, value: { files: out, detail: `marker ${spec.marker} -> ${next}` } };
        }
        case 'rename-param': {
            const endpoint = spec.endpoints[0] ?? '';
            const paramMatch = /[?&]([A-Za-z0-9_-]+)=/.exec(endpoint);
            if (!paramMatch)
                return { ok: false, error: 'no parameter anchor in the spec endpoint' };
            const oldParam = paramMatch[1] ?? '';
            const newParam = pick(PARAM_NAMES, key, oldParam);
            let count = 0;
            count += replaceAll(out, `.get("${oldParam}"`, `.get("${newParam}"`);
            count += replaceAll(out, `name="${oldParam}"`, `name="${newParam}"`);
            count += replaceAll(out, `{"${oldParam}":`, `{"${newParam}":`);
            count += replaceAll(out, `?${oldParam}=`, `?${newParam}=`);
            count += replaceAll(out, `&${oldParam}=`, `&${newParam}=`);
            if (count < 2)
                return { ok: false, error: `param anchor too weak (${count} replacements)` };
            return { ok: true, value: { files: out, detail: `param ${oldParam} -> ${newParam} (${count} sites)` } };
        }
        case 'rename-route': {
            const endpoint = spec.endpoints[0] ?? '';
            const routeMatch = /\s(\/[A-Za-z0-9/_-]+)/.exec(endpoint);
            if (!routeMatch)
                return { ok: false, error: 'no route anchor in the spec endpoint' };
            const oldRoute = routeMatch[1] ?? '';
            const segment = oldRoute.split('/').filter(Boolean)[0] ?? '';
            const synonym = ROUTE_SYNONYMS[segment];
            if (!synonym)
                return { ok: false, error: `no route synonym for segment ${segment}` };
            const newRoute = oldRoute.replace(`/${segment}`, `/${synonym}`);
            let count = 0;
            count += replaceAll(out, `"${oldRoute}"`, `"${newRoute}"`);
            count += replaceAll(out, `'${oldRoute}'`, `'${newRoute}'`);
            count += replaceAll(out, ` ${oldRoute}?`, ` ${newRoute}?`);
            count += replaceAll(out, `action="${oldRoute}"`, `action="${newRoute}"`);
            if (count < 2)
                return { ok: false, error: `route anchor too weak (${count} replacements)` };
            return { ok: true, value: { files: out, detail: `route ${oldRoute} -> ${newRoute} (${count} sites)` } };
        }
        case 'reskin': {
            return { ok: false, error: 'reskin is a case-level operator in the in-app port (bundle brand text is seed-specific)' };
        }
        case 'naive-filter': {
            const upgraded = upgradeProbePayload(out, spec.vuln_class);
            if (!upgraded.ok)
                return upgraded;
            const inserted = insertNaiveFilter(out, spec.vuln_class);
            if (!inserted.ok)
                return inserted;
            return { ok: true, value: { files: out, detail: 'naive filter inserted in both twins; probe upgraded to the bypass payload' } };
        }
    }
}
/**
 * Recompute a bundle directory's hash, byte-for-byte compatible with the
 * Foundry validator (sorted relative paths; path bytes then file bytes) —
 * the same algorithm as @secscan/redteam-foundry-gate's bundleHash.
 *
 * @param files - the bundle's files by relative path (contents as strings)
 * @returns the lowercase hex SHA-256 digest
 */
export function bundleHashOfFiles(files) {
    const hash = createHash('sha256');
    for (const rel of [...files.keys()].sort()) {
        hash.update(rel, 'utf8');
        hash.update(files.get(rel) ?? '', 'utf8');
    }
    return hash.digest('hex');
}
//# sourceMappingURL=bundle-mutate.js.map