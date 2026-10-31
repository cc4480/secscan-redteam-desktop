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

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { ArsenalConfig } from './config.js'
import { PRIORITY_COLLECTION_SLUGS } from './collections-map.js'
import {
  ArsenalValidationError,
  buildAndSwapArsenalIndex,
  readArsenalIndexMeta,
  type ArsenalBuildData,
} from './index-store.js'

/** Result of one git invocation (the refresh git runner's contract). */
export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs `git` with an argv array (never a shell string). Injected in tests. */
export type GitRunner = (args: readonly string[], cwd?: string) => Promise<GitResult>

/** What refresh needs back from one ingest build attempt. */
export interface ArsenalBuildOutcome {
  /** True when the new generation validated and was swapped in. */
  ok: boolean
  /** The generation serving after the attempt (the new one when `ok`). */
  generation: number
  entryCount: number
  collectionCount: number
  collectionsOk: number
  collectionsFailed: number
  unparsedCount: number
  dupeCount: number
  /** Per-priority-collection stored entry counts, in map order. */
  priority: { slug: string; entryCount: number }[]
  /** Validation failure reasons when `ok` is false. */
  failureReasons: string[]
}

/** The two seams refresh orchestrates. Everything else is this file. */
export interface RefreshDeps {
  git: GitRunner
  buildIndex: (input: { config: ArsenalConfig; cacheDir: string; sourceCommit: string }) => Promise<ArsenalBuildOutcome>
}

export interface ArsenalRefreshRequest {
  config: ArsenalConfig
  /** Discard the cache clone and re-clone (a corrupt cache is the use case). */
  forceClone?: boolean
  deps?: Partial<RefreshDeps>
  /** Sink for summary lines (defaults to silence; the CLI passes console). */
  log?: (line: string) => void
}

export interface ArsenalRefreshReport {
  ok: boolean
  /** Process exit code the CLI should adopt: 0 on success, 1 on failure. */
  exitCode: 0 | 1
  /** Every line the refresh printed, in order (the summary lives here). */
  lines: string[]
  /** Where the refresh stopped when it failed. */
  stage: 'git' | 'build' | 'done'
  build?: ArsenalBuildOutcome
  error?: string
}

function defaultGitRunner(args: readonly string[], cwd?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const raw = (err as { code?: unknown } | null)?.code
        resolve({
          code: err ? (typeof raw === 'number' ? raw : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        })
      },
    )
  })
}

/** Shape the summary out of one build's data (success or validation failure). */
function outcomeFromData(data: ArsenalBuildData, generation: number, entryCount: number, ok: boolean): ArsenalBuildOutcome {
  const collectionsFailed = data.collections.filter(c => c.fetchError !== null).length
  const prioritySlugs = new Set(data.prioritySlugs)
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
  }
}

/** The ingest pipeline entry refresh drives, per the crew-log contract. */
interface IngestPipelineModule {
  buildArsenalData?: (input: { config: ArsenalConfig; cacheDir: string; sourceCommit: string }) => Promise<ArsenalBuildData>
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
async function defaultBuildIndex(input: { config: ArsenalConfig; cacheDir: string; sourceCommit: string }): Promise<ArsenalBuildOutcome> {
  const ingest = (await import('./ingest.js')) as unknown as IngestPipelineModule
  if (typeof ingest.buildArsenalData !== 'function') {
    throw new Error(
      'the arsenal ingest pipeline entry (buildArsenalData in src/arsenal/ingest.ts) is not present in this build — the index cannot be refreshed',
    )
  }
  const produced = await ingest.buildArsenalData(input)
  const data: ArsenalBuildData = { ...produced, prioritySlugs: PRIORITY_COLLECTION_SLUGS }
  try {
    const swapped = buildAndSwapArsenalIndex(input.config.dbPath, data)
    return outcomeFromData(data, swapped.generation, swapped.entryCount, true)
  } catch (err) {
    if (err instanceof ArsenalValidationError) {
      const serving = readArsenalIndexMeta(input.config.dbPath)
      return {
        ...outcomeFromData(data, serving?.generation ?? 0, serving?.entryCount ?? 0, false),
        failureReasons: [err.message],
      }
    }
    throw err
  }
}

const defaultDeps: RefreshDeps = {
  git: defaultGitRunner,
  buildIndex: defaultBuildIndex,
}

function tail(text: string, max = 400): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(trimmed.length - max)}`
}

/**
 * Run one refresh end to end. Never throws for an operational failure —
 * every expected failure mode (clone refused, pull failed, validation
 * failed, build threw) returns `{ ok: false, exitCode: 1 }` with the old
 * generation still serving and the output saying so.
 */
export async function runArsenalRefresh(req: ArsenalRefreshRequest): Promise<ArsenalRefreshReport> {
  const { config } = req
  const git = req.deps?.git ?? defaultDeps.git
  const buildIndex = req.deps?.buildIndex ?? defaultDeps.buildIndex
  const lines: string[] = []
  const emit = (line: string): void => {
    lines.push(line)
    req.log?.(line)
  }
  const fail = (stage: 'git' | 'build', error: string, build?: ArsenalBuildOutcome): ArsenalRefreshReport => {
    emit(`arsenal refresh FAILED (${stage}): ${error}`)
    emit('old generation still serving — the index the fleet reads is unchanged')
    return { ok: false, exitCode: 1, lines, stage, build, error }
  }

  const cacheDir = config.cacheDir

  // --- git: clone or verify + pull --ff-only (spec §6.4) -------------------
  let cachePresent = existsSync(join(cacheDir, '.git'))
  if (req.forceClone && existsSync(cacheDir)) {
    await rm(cacheDir, { recursive: true, force: true })
    cachePresent = false
    emit(`arsenal refresh: --force-clone discarded the cache at ${cacheDir}`)
  }
  if (!cachePresent) {
    const clone = await git(['clone', config.sourceRepo, cacheDir])
    if (clone.code !== 0) {
      return fail('git', `git clone of ${config.sourceRepo} failed: ${tail(clone.stderr) || `exit ${clone.code}`}`)
    }
    emit(`arsenal refresh: cloned ${config.sourceRepo} into ${cacheDir}`)
  }
  // The remote is verified on EVERY refresh, cloned or not: a cache whose
  // origin drifted from the configured pin is refused before any pull.
  const remote = await git(['-C', cacheDir, 'remote', 'get-url', 'origin'])
  if (remote.code !== 0) {
    return fail('git', `git remote get-url origin failed in ${cacheDir}: ${tail(remote.stderr) || `exit ${remote.code}`}`)
  }
  const actualRemote = remote.stdout.trim()
  if (actualRemote !== config.sourceRepo) {
    return fail(
      'git',
      `refusing to pull: cache remote is ${actualRemote} but config pins ${config.sourceRepo} (spec 6.4); ` +
        'fix the cache remote or re-run with --force-clone',
    )
  }
  if (cachePresent) {
    const pull = await git(['-C', cacheDir, 'pull', '--ff-only'])
    if (pull.code !== 0) {
      return fail('git', `git pull --ff-only failed: ${tail(pull.stderr) || `exit ${pull.code}`}`)
    }
  }
  const head = await git(['-C', cacheDir, 'rev-parse', 'HEAD'])
  if (head.code !== 0) {
    return fail('git', `git rev-parse HEAD failed in ${cacheDir}: ${tail(head.stderr) || `exit ${head.code}`}`)
  }
  const sourceCommit = head.stdout.trim()

  // --- build: ingest builds the data, the store validates + swaps ----------
  let build: ArsenalBuildOutcome
  try {
    build = await buildIndex({ config, cacheDir, sourceCommit })
  } catch (err) {
    return fail('build', `build threw: ${(err as Error).message}`)
  }
  if (!build.ok) {
    for (const reason of build.failureReasons) emit(`arsenal refresh: validation: ${reason}`)
    return fail('build', 'the new generation failed validation and was not swapped in', build)
  }

  // --- summary (spec §9.1) ---------------------------------------------------
  emit(`arsenal refresh: generation ${build.generation} built from ${config.sourceRepo} @ ${sourceCommit.slice(0, 12)}`)
  emit(`  collections: ${build.collectionsOk} ok, ${build.collectionsFailed} failed (of ${build.collectionCount})`)
  emit(`  entries: ${build.entryCount} (unparsed ${build.unparsedCount}, duplicates dropped ${build.dupeCount})`)
  if (build.priority.length > 0) {
    emit(`  priority: ${build.priority.map(p => `${p.slug}=${p.entryCount}`).join(', ')}`)
  }
  return { ok: true, exitCode: 0, lines, stage: 'done', build }
}

export interface ArsenalRefreshTimerOptions {
  config: ArsenalConfig
  /** Injected in tests; defaults to a real refresh over `config`. */
  refresh?: () => Promise<ArsenalRefreshReport>
  log?: (line: string) => void
  /** Test seam: override the tick interval (production uses the config). */
  intervalMs?: number
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
export function startArsenalRefreshTimer(opts: ArsenalRefreshTimerOptions): () => void {
  const log = opts.log ?? ((line: string): void => console.log(line))
  if (!opts.config.enabled || opts.config.refreshIntervalHours <= 0) {
    return (): void => {}
  }
  const intervalMs = opts.intervalMs ?? opts.config.refreshIntervalHours * 3_600_000
  if (!(intervalMs > 0)) {
    return (): void => {}
  }
  const run = opts.refresh ?? ((): Promise<ArsenalRefreshReport> => runArsenalRefresh({ config: opts.config, log }))
  let inFlight = false
  const tick = (): void => {
    if (inFlight) return
    inFlight = true
    run()
      .then((report) => {
        if (!report.ok) {
          log(`[arsenal] scheduled refresh failed (${report.stage}): ${report.error ?? 'see refresh output'} — old generation still serving`)
        }
      })
      .catch((err: unknown) => {
        log(`[arsenal] scheduled refresh error: ${(err as Error).message} — old generation still serving`)
      })
      .finally(() => {
        inFlight = false
      })
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  let stopped = false
  return (): void => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}
