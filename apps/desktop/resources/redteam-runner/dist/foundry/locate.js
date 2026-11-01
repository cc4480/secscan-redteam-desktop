/**
 * Foundry location: snapshot discovery, gate CLI location, gate execution.
 *
 * Discovery order (first valid hit wins; every candidate is reported so the
 * console can show exactly where it looked):
 *   1. REDTEAM_FOUNDRY_SNAPSHOT — a snapshot directory named by the operator.
 *   2. A "foundry-snapshot" directory next to the runner payload root.
 *   3. The snapshot bundled inside a locatable @secscan/redteam-foundry-gate
 *      package (payload node_modules, the desktop dsh payload next to the
 *      runner resources, or the monorepo packages tree in a dev checkout).
 *
 * A directory counts as a snapshot only when it holds manifest.json and a
 * bundles/ directory — presence alone is never trusted. The gate CLI is
 * located under the same package roots (lib/types/cli.js). Gate runs spawn
 * node with an argument array only: no shell, and no caller-supplied input —
 * snapshot paths come from discovery and slugs from the manifest.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
function isRec(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v) {
    return typeof v === 'string' ? v : null;
}
/**
 * The runner payload root: the package directory that holds dist/ (compiled
 * modules live under dist/foundry, two levels below the root).
 *
 * @returns the absolute payload root path
 */
export function runnerPayloadRoot() {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}
/**
 * Candidate roots of the @secscan/redteam-foundry-gate package, in search
 * order: the payload's own node_modules, the desktop dsh payload beside the
 * runner resources dir, then the monorepo packages tree (dev checkouts).
 *
 * @param payloadRoot - the runner payload root
 * @returns the candidate package root paths
 */
export function gatePackageRoots(payloadRoot) {
    return [
        join(payloadRoot, 'node_modules', '@secscan', 'redteam-foundry-gate'),
        join(dirname(payloadRoot), 'dsh', 'node_modules', '@secscan', 'redteam-foundry-gate'),
        join(payloadRoot, '..', '..', 'packages', 'redteam', 'foundry-gate'),
    ];
}
/** A directory is a snapshot only with a manifest and a bundles/ directory. */
export function isSnapshotDir(dir) {
    try {
        return existsSync(join(dir, 'manifest.json')) && existsSync(join(dir, 'bundles'));
    }
    catch {
        return false;
    }
}
/**
 * Locate the Foundry snapshot and gate CLI.
 *
 * @param opts - optional environment and payload-root overrides (tests)
 * @returns the chosen snapshot (or null), every candidate tried, and the
 *   gate CLI path (or null)
 */
export function locateFoundry(opts = {}) {
    const env = opts.env ?? process.env;
    const payloadRoot = opts.payloadRoot ?? runnerPayloadRoot();
    const roots = gatePackageRoots(payloadRoot);
    const candidates = [];
    const consider = (via, dir) => {
        candidates.push({ via, dir, valid: isSnapshotDir(dir) });
    };
    const fromEnv = (env['REDTEAM_FOUNDRY_SNAPSHOT'] ?? '').trim();
    if (fromEnv)
        consider('env:REDTEAM_FOUNDRY_SNAPSHOT', fromEnv);
    consider('sibling:foundry-snapshot', join(dirname(payloadRoot), 'foundry-snapshot'));
    for (const root of roots)
        consider(`gate-package:${root}`, join(root, 'snapshot'));
    const chosen = candidates.find(c => c.valid) ?? null;
    let gateCliPath = null;
    for (const root of roots) {
        const cli = join(root, 'lib', 'types', 'cli.js');
        if (existsSync(cli)) {
            gateCliPath = cli;
            break;
        }
    }
    return {
        snapshotDir: chosen ? chosen.dir : null,
        snapshotVia: chosen ? chosen.via : null,
        snapshotCandidates: candidates,
        gateCliPath,
        gatePackageRoots: roots,
    };
}
/**
 * Read and project a snapshot manifest for display.
 *
 * @param snapshotDir - a directory already validated as a snapshot
 * @returns the projected manifest, or null when it cannot be parsed
 */
export function readSnapshot(snapshotDir) {
    let raw;
    try {
        raw = JSON.parse(readFileSync(join(snapshotDir, 'manifest.json'), 'utf8'));
    }
    catch {
        return null;
    }
    if (!isRec(raw) || !Array.isArray(raw.bundles))
        return null;
    const bundles = [];
    for (const entry of raw.bundles) {
        if (!isRec(entry) || typeof entry.slug !== 'string')
            continue;
        const fitness = isRec(entry.fitness) ? num(entry.fitness.fitness) : null;
        const panel = isRec(entry.panel) ? num(entry.panel.pass_rate) : null;
        bundles.push({
            slug: entry.slug,
            family: str(entry.family_id) ?? entry.slug,
            loopTier: str(entry.loop_tier) ?? 'UNKNOWN',
            vulnClass: str(entry.vuln_class) ?? '',
            cwe: str(entry.cwe) ?? '',
            tier: num(entry.tier),
            status: str(entry.status) ?? '',
            fitness,
            panelPassRate: panel,
        });
    }
    const source = isRec(raw.source) ? raw.source : {};
    return {
        name: str(raw.snapshot),
        generatedAt: str(raw.generated_at),
        declaredCounts: {
            datasets: num(source.datasets),
            gold: num(source.gold),
            silver: num(source.silver),
            liveCases: num(source.live_cases),
        },
        bundles,
        counts: {
            total: bundles.length,
            gold: bundles.filter(b => b.loopTier === 'GOLD').length,
            silver: bundles.filter(b => b.loopTier === 'SILVER').length,
            other: bundles.filter(b => b.loopTier !== 'GOLD' && b.loopTier !== 'SILVER').length,
        },
    };
}
//# sourceMappingURL=locate.js.map