/**
 * Arsenal refresh — the operator surface's one code path (spec §9).
 *
 * Two triggers share this module and nothing else: the CLI subcommand
 * (`redteam-runner arsenal refresh`, see `src/cli/arsenal.ts`) and the
 * console timer (`startArsenalRefreshTimer`, hooked in `src/ui/server.ts`).
 * No MCP tool can reach anything here — refresh is an operator action,
 * permanently (spec §3).
 *
 * The pipeline is deliberately boring:
 *
 *   1. git: clone the one pinned source repo into the cache, or verify the
 *      existing clone's remote still equals the configured URL and
 *      `pull --ff-only` (spec §6.4 — a cache whose remote drifted is
 *      refused, never pulled).
 *   2. build: the ingest pipeline produces the build data (Level 1 census
 *      from the cache clone, Level 2 through the guarded retrieval path,
 *      tagging), refresh stamps the canonical priority validation set from
 *      `collections-map.ts` (ARS-1's forward contract), and the store
 *      validates + atomically swaps the new generation in (spec §5). This
 *      module adds no second build path.
 *   3. report: print the summary; on any failure the old generation keeps
 *      serving and the output says so.
 *
 * Every external step sits behind an injected seam (the git runner, the
 * build entry) so the orchestration is testable offline.
 *
 * Timer discipline (spec §9.2, tightened by the crew-8 PRD): the timer
 * NEVER attempts a refresh at server start — app start performs zero
 * arsenal network activity. It only schedules one attempt per configured
 * interval, only when the arsenal is enabled and the interval is positive,
 * and a failed attempt is logged, never retried in a tight loop.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PRIORITY_COLLECTION_SLUGS } from './collections-map.js';
import { ArsenalValidationError, buildAndSwapArsenalIndex, readArsenalIndexMeta, } from './index-store.js';
function defaultGitRunner(args, cwd) {
    return new Promise((resolve) => {
        execFile('git', [...args], { cwd, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            const raw = err?.code;
            resolve({
                code: err ? (typeof raw === 'number' ? raw : 1) : 0,
                stdout: String(stdout),
                stderr: String(stderr),
            });
        });
    });
}
/** Shape the summary out of one build's data (success or validation failure). */
function outcomeFromData(data, generation, entryCount, ok) {
    const collectionsFailed = data.collections.filter(c => c.fetchError !== null).length;
    const prioritySlugs = new Set(data.prioritySlugs);
    return {
        ok,
        generation,
        entryCount,
        collectionCount: data.collections.length,
        collectionsOk: data.collections.length - collectionsFailed,
        collectionsFailed,
        unparsedCount: data.unparsedCount,
        dupeCount: data.dupeCount,
        priority: data.collections
            .filter(c => prioritySlugs.has(c.slug))
            .map(c => ({ slug: c.slug, entryCount: c.entryCount })),
        failureReasons: [],
    };
}
/**
 * The default build: the ingest pipeline produces the build data, refresh
 * stamps the canonical priority validation set, and the store validates +
 * swaps (spec §5). A validation failure is data, not an exception, at this
 * seam: the store has already left the serving DB untouched, so the
 * outcome reports the still-serving generation.
 *
 * The pipeline entry is loaded lazily and checked by name: ingest's Step 6
 * completion lands it as `buildArsenalData` (contract published in the
 * crew build log). Until it exists, a refresh attempt fails loud with that
 * named — it never falls back to a partial or improvised pipeline.
 */
async function defaultBuildIndex(input) {
    const ingest = (await import('./ingest.js'));
    if (typeof ingest.buildArsenalData !== 'function') {
        throw new Error('the arsenal ingest pipeline entry (buildArsenalData in src/arsenal/ingest.ts) is not present in this build — the index cannot be refreshed');
    }
    const produced = await ingest.buildArsenalData(input);
    const data = { ...produced, prioritySlugs: PRIORITY_COLLECTION_SLUGS };
    try {
        const swapped = buildAndSwapArsenalIndex(input.config.dbPath, data);
        return outcomeFromData(data, swapped.generation, swapped.entryCount, true);
    }
    catch (err) {
        if (err instanceof ArsenalValidationError) {
            const serving = readArsenalIndexMeta(input.config.dbPath);
            return {
                ...outcomeFromData(data, serving?.generation ?? 0, serving?.entryCount ?? 0, false),
                failureReasons: [err.message],
            };
        }
        throw err;
    }
}
const defaultDeps = {
    git: defaultGitRunner,
    buildIndex: defaultBuildIndex,
};
function tail(text, max = 400) {
    const trimmed = text.trim();
    return trimmed.length <= max ? trimmed : `…${trimmed.slice(trimmed.length - max)}`;
}
/**
 * Run one refresh end to end. Never throws for an operational failure —
 * every expected failure mode (clone refused, pull failed, validation
 * failed, build threw) returns `{ ok: false, exitCode: 1 }` with the old
 * generation still serving and the output saying so.
 */
export async function runArsenalRefresh(req) {
    const { config } = req;
    const git = req.deps?.git ?? defaultDeps.git;
    const buildIndex = req.deps?.buildIndex ?? defaultDeps.buildIndex;
    const lines = [];
    const emit = (line) => {
        lines.push(line);
        req.log?.(line);
    };
    const fail = (stage, error, build) => {
        emit(`arsenal refresh FAILED (${stage}): ${error}`);
        emit('old generation still serving — the index the fleet reads is unchanged');
        return { ok: false, exitCode: 1, lines, stage, build, error };
    };
    const cacheDir = config.cacheDir;
    // --- git: clone or verify + pull --ff-only (spec §6.4) -------------------
    let cachePresent = existsSync(join(cacheDir, '.git'));
    if (req.forceClone && existsSync(cacheDir)) {
        await rm(cacheDir, { recursive: true, force: true });
        cachePresent = false;
        emit(`arsenal refresh: --force-clone discarded the cache at ${cacheDir}`);
    }
    if (!cachePresent) {
        const clone = await git(['clone', config.sourceRepo, cacheDir]);
        if (clone.code !== 0) {
            return fail('git', `git clone of ${config.sourceRepo} failed: ${tail(clone.stderr) || `exit ${clone.code}`}`);
        }
        emit(`arsenal refresh: cloned ${config.sourceRepo} into ${cacheDir}`);
    }
    // The remote is verified on EVERY refresh, cloned or not: a cache whose
    // origin drifted from the configured pin is refused before any pull.
    const remote = await git(['-C', cacheDir, 'remote', 'get-url', 'origin']);
    if (remote.code !== 0) {
        return fail('git', `git remote get-url origin failed in ${cacheDir}: ${tail(remote.stderr) || `exit ${remote.code}`}`);
    }
    const actualRemote = remote.stdout.trim();
    if (actualRemote !== config.sourceRepo) {
        return fail('git', `refusing to pull: cache remote is ${actualRemote} but config pins ${config.sourceRepo} (spec 6.4); ` +
            'fix the cache remote or re-run with --force-clone');
    }
    if (cachePresent) {
        const pull = await git(['-C', cacheDir, 'pull', '--ff-only']);
        if (pull.code !== 0) {
            return fail('git', `git pull --ff-only failed: ${tail(pull.stderr) || `exit ${pull.code}`}`);
        }
    }
    const head = await git(['-C', cacheDir, 'rev-parse', 'HEAD']);
    if (head.code !== 0) {
        return fail('git', `git rev-parse HEAD failed in ${cacheDir}: ${tail(head.stderr) || `exit ${head.code}`}`);
    }
    const sourceCommit = head.stdout.trim();
    // --- build: ingest builds the data, the store validates + swaps ----------
    let build;
    try {
        build = await buildIndex({ config, cacheDir, sourceCommit });
    }
    catch (err) {
        return fail('build', `build threw: ${err.message}`);
    }
    if (!build.ok) {
        for (const reason of build.failureReasons)
            emit(`arsenal refresh: validation: ${reason}`);
        return fail('build', 'the new generation failed validation and was not swapped in', build);
    }
    // --- summary (spec §9.1) ---------------------------------------------------
    emit(`arsenal refresh: generation ${build.generation} built from ${config.sourceRepo} @ ${sourceCommit.slice(0, 12)}`);
    emit(`  collections: ${build.collectionsOk} ok, ${build.collectionsFailed} failed (of ${build.collectionCount})`);
    emit(`  entries: ${build.entryCount} (unparsed ${build.unparsedCount}, duplicates dropped ${build.dupeCount})`);
    if (build.priority.length > 0) {
        emit(`  priority: ${build.priority.map(p => `${p.slug}=${p.entryCount}`).join(', ')}`);
    }
    return { ok: true, exitCode: 0, lines, stage: 'done', build };
}
/**
 * Start the console refresh timer. Returns a disposer; calling it more
 * than once is a no-op.
 *
 * Inert by construction: nothing is attempted at start (this function only
 * schedules), nothing is scheduled at all when the arsenal is disabled or
 * the configured interval is 0 (manual only), one attempt runs per
 * interval, an attempt still in flight skips its tick rather than piling
 * up, and a failed attempt is logged — never retried until the next
 * interval. The timer is unref'd: it never keeps a process alive alone.
 */
export function startArsenalRefreshTimer(opts) {
    const log = opts.log ?? ((line) => console.log(line));
    if (!opts.config.enabled || opts.config.refreshIntervalHours <= 0) {
        return () => { };
    }
    const intervalMs = opts.intervalMs ?? opts.config.refreshIntervalHours * 3_600_000;
    if (!(intervalMs > 0)) {
        return () => { };
    }
    const run = opts.refresh ?? (() => runArsenalRefresh({ config: opts.config, log }));
    let inFlight = false;
    const tick = () => {
        if (inFlight)
            return;
        inFlight = true;
        run()
            .then((report) => {
            if (!report.ok) {
                log(`[arsenal] scheduled refresh failed (${report.stage}): ${report.error ?? 'see refresh output'} — old generation still serving`);
            }
        })
            .catch((err) => {
            log(`[arsenal] scheduled refresh error: ${err.message} — old generation still serving`);
        })
            .finally(() => {
            inFlight = false;
        });
    };
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    let stopped = false;
    return () => {
        if (stopped)
            return;
        stopped = true;
        clearInterval(timer);
    };
}
//# sourceMappingURL=refresh.js.map