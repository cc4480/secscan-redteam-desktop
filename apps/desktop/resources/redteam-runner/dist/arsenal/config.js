/**
 * Arsenal configuration (build brief §1.6, spec §11).
 *
 * The runner's `resolveConfig` (phases/config.ts) is engagement-scoped — the
 * console boots without it — so Arsenal resolves its own config from the
 * environment with the same discipline: every field is a validated config
 * field (never a hardcoded constant), empty env values count as unset, and
 * an invalid value throws at resolution naming the exact variable — never
 * default-and-continue.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
export const DEFAULT_ARSENAL_SOURCE_REPO = 'https://github.com/hack-with-github/awesome-hacking.git';
export const DEFAULT_ARSENAL_REFRESH_INTERVAL_HOURS = 168;
export const DEFAULT_ARSENAL_MAX_ENTRIES_PER_COLLECTION = 20000;
/** Env value with the codebase convention: unset and blank are the same thing. */
function envValue(env, name) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '')
        return undefined;
    return raw.trim();
}
function parseEnabled(raw) {
    if (raw === undefined || raw === '1')
        return true;
    if (raw === '0')
        return false;
    throw new Error(`[arsenal] bad REDTEAM_ARSENAL_ENABLED=${JSON.stringify(raw)}; want 0 or 1`);
}
function parseNonNegativeInt(raw, name, fallback) {
    if (raw === undefined)
        return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        throw new Error(`[arsenal] bad ${name}=${JSON.stringify(raw)}; want an integer >= 0`);
    }
    return n;
}
function parsePositiveInt(raw, name, fallback) {
    if (raw === undefined)
        return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
        throw new Error(`[arsenal] bad ${name}=${JSON.stringify(raw)}; want an integer >= 1`);
    }
    return n;
}
function parseSourceRepo(raw) {
    if (raw === undefined)
        return DEFAULT_ARSENAL_SOURCE_REPO;
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error(`[arsenal] bad REDTEAM_ARSENAL_SOURCE_REPO=${JSON.stringify(raw)}; want an https URL`);
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw new Error(`[arsenal] bad REDTEAM_ARSENAL_SOURCE_REPO=${JSON.stringify(raw)}; want an https URL without credentials`);
    }
    return raw;
}
/**
 * Resolve Arsenal configuration.
 *
 * Database path (brief §1.4): `REDTEAM_ARSENAL_DB_PATH` wins; otherwise the
 * path derives from the console's engagements dir
 * (`<engagementsDir>/../../arsenal/arsenal.db`, so the desktop lands at
 * `<userData>/arsenal/arsenal.db`); without an engagements dir it falls
 * back to the console's data-home convention (`REDTEAM_HOME` or cwd).
 * The database never lives under `live/`, a payload dir, or an XDG path.
 */
export function resolveArsenalConfig(env, opts = {}) {
    const override = envValue(env, 'REDTEAM_ARSENAL_DB_PATH');
    let dbPath;
    if (override !== undefined) {
        dbPath = resolve(override);
    }
    else if (opts.engagementsDir !== undefined) {
        dbPath = resolve(join(opts.engagementsDir, '..', '..', 'arsenal', 'arsenal.db'));
    }
    else {
        const home = env['REDTEAM_HOME'];
        dbPath = resolve(join(home ? home : process.cwd(), 'arsenal', 'arsenal.db'));
    }
    const arsenalDir = dirname(dbPath);
    return {
        enabled: parseEnabled(envValue(env, 'REDTEAM_ARSENAL_ENABLED')),
        dbPath,
        arsenalDir,
        cacheDir: join(arsenalDir, 'cache', 'awesome-hacking'),
        sourceRepo: parseSourceRepo(envValue(env, 'REDTEAM_ARSENAL_SOURCE_REPO')),
        refreshIntervalHours: parseNonNegativeInt(envValue(env, 'REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS'), 'REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS', DEFAULT_ARSENAL_REFRESH_INTERVAL_HOURS),
        maxEntriesPerCollection: parsePositiveInt(envValue(env, 'REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION'), 'REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION', DEFAULT_ARSENAL_MAX_ENTRIES_PER_COLLECTION),
    };
}
/**
 * Resolve the config the SERVING surface (the console's Arsenal tools)
 * reads through.
 *
 * The primary resolution ({@link resolveArsenalConfig}) names the
 * canonical index path — the one a refresh creates and writes. When no
 * index exists there yet, an index that DOES exist at the runner's other
 * data-home conventions is the real one to serve: `$REDTEAM_HOME/arsenal/
 * arsenal.db` (where the production census is built and where a
 * standalone console with no engagements dir resolves its index), then
 * `<cwd>/arsenal/arsenal.db` (the remaining data-home fallback in
 * resolveEngagementsDir/resolveConfig). Serving the primary path in that
 * situation renders an empty census while a real index sits one
 * convention away. When no index exists anywhere, the primary config
 * stands unchanged, so the tools keep answering the typed
 * ARSENAL_INDEX_EMPTY result and a later refresh still lands at the
 * canonical path. Refresh and the CLI always use the primary resolution —
 * this fallback never redirects a write.
 *
 * @param env - The process environment to resolve from.
 * @param opts - The console's engagements dir, when the caller holds one.
 * @returns The primary config, or that config re-pointed at the first
 * existing index found at a fallback convention.
 */
export function resolveArsenalServingConfig(env, opts = {}) {
    const primary = resolveArsenalConfig(env, opts);
    if (existsSync(primary.dbPath))
        return primary;
    const candidates = [];
    const home = env['REDTEAM_HOME'];
    if (home)
        candidates.push(join(home, 'arsenal', 'arsenal.db'));
    candidates.push(join(process.cwd(), 'arsenal', 'arsenal.db'));
    for (const dbPath of candidates) {
        if (dbPath === primary.dbPath)
            continue;
        if (existsSync(dbPath)) {
            const arsenalDir = dirname(dbPath);
            return { ...primary, dbPath, arsenalDir, cacheDir: join(arsenalDir, 'cache', 'awesome-hacking') };
        }
    }
    return primary;
}
//# sourceMappingURL=config.js.map