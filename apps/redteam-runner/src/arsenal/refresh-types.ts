/**
 * Arsenal refresh contracts — extracted from refresh.ts to keep the refresh
 * module under the 300-line budget. Pure declarations.
 */
import type { ArsenalConfig } from './config.js'

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
