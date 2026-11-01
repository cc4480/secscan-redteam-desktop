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
import type { ArsenalConfig } from './config.js';
/** Result of one git invocation (the refresh git runner's contract). */
export interface GitResult {
    code: number;
    stdout: string;
    stderr: string;
}
/** Runs `git` with an argv array (never a shell string). Injected in tests. */
export type GitRunner = (args: readonly string[], cwd?: string) => Promise<GitResult>;
/** What refresh needs back from one ingest build attempt. */
export interface ArsenalBuildOutcome {
    /** True when the new generation validated and was swapped in. */
    ok: boolean;
    /** The generation serving after the attempt (the new one when `ok`). */
    generation: number;
    entryCount: number;
    collectionCount: number;
    collectionsOk: number;
    collectionsFailed: number;
    unparsedCount: number;
    dupeCount: number;
    /** Per-priority-collection stored entry counts, in map order. */
    priority: {
        slug: string;
        entryCount: number;
    }[];
    /** Validation failure reasons when `ok` is false. */
    failureReasons: string[];
}
/** The two seams refresh orchestrates. Everything else is this file. */
export interface RefreshDeps {
    git: GitRunner;
    buildIndex: (input: {
        config: ArsenalConfig;
        cacheDir: string;
        sourceCommit: string;
    }) => Promise<ArsenalBuildOutcome>;
}
export interface ArsenalRefreshRequest {
    config: ArsenalConfig;
    /** Discard the cache clone and re-clone (a corrupt cache is the use case). */
    forceClone?: boolean;
    deps?: Partial<RefreshDeps>;
    /** Sink for summary lines (defaults to silence; the CLI passes console). */
    log?: (line: string) => void;
}
export interface ArsenalRefreshReport {
    ok: boolean;
    /** Process exit code the CLI should adopt: 0 on success, 1 on failure. */
    exitCode: 0 | 1;
    /** Every line the refresh printed, in order (the summary lives here). */
    lines: string[];
    /** Where the refresh stopped when it failed. */
    stage: 'git' | 'build' | 'done';
    build?: ArsenalBuildOutcome;
    error?: string;
}
/**
 * Run one refresh end to end. Never throws for an operational failure —
 * every expected failure mode (clone refused, pull failed, validation
 * failed, build threw) returns `{ ok: false, exitCode: 1 }` with the old
 * generation still serving and the output saying so.
 */
export declare function runArsenalRefresh(req: ArsenalRefreshRequest): Promise<ArsenalRefreshReport>;
export interface ArsenalRefreshTimerOptions {
    config: ArsenalConfig;
    /** Injected in tests; defaults to a real refresh over `config`. */
    refresh?: () => Promise<ArsenalRefreshReport>;
    log?: (line: string) => void;
    /** Test seam: override the tick interval (production uses the config). */
    intervalMs?: number;
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
export declare function startArsenalRefreshTimer(opts: ArsenalRefreshTimerOptions): () => void;
