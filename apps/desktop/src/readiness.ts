/**
 * Tool readiness for the welcome window: run the bundled engagement runner's
 * `doctor --json` once and map its report into a view the sandboxed renderer can
 * show without ever receiving a secret.
 *
 * The doctor report itself carries no secrets, but its failure path must not
 * either: every reason string here is a fixed phrase plus at most a short tail of
 * the child's own stderr, never the command line, an environment value, or a token.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { REDTEAM_RUNNER_ENTRY } from './redteam-runner.ts'

import type { ReadinessItem, ReadinessResult } from './welcome-api.ts'
export type { ReadinessItem, ReadinessView, ReadinessResult } from './welcome-api.ts'

/** The child members the readiness check touches; a `ChildProcess` satisfies this shape. */
export interface SpawnedChildLike {
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  on(event: 'exit' | 'error', listener: (...args: unknown[]) => void): void
  /** Terminates the child; a simple test fake may omit it. */
  kill?(): void
}

/** How one readiness check resolves its runtime and its child. */
export interface RunReadinessOptions {
  /** Application executable used as the bundled Node runtime, run in Node mode. */
  node: string
  /** Absolute directory holding the runner's manifest, its `dist`, and its dependencies. */
  runnerDirectory: string
  /** Environment the doctor inherits; the default spawn passes it through, nothing reads it here. */
  env?: NodeJS.ProcessEnv
  /** Overrides the child factory; a test supplies an in-memory child instead of a process. */
  spawn?: (command: string, args: readonly string[]) => SpawnedChildLike
  /** Deadline for the child to exit; defaults to 30 seconds. */
  timeoutMs?: number
}

/** Ceiling on collected stdout before the run is declared failed. */
const MAX_STDOUT_BYTES = 256 * 1024

/** Default deadline for the child to exit. */
const DEFAULT_TIMEOUT_MS = 30_000

/** Child stderr retained for the failure reason. */
const MAX_STDERR_CHARS = 8 * 1024

/** Share of stderr quoted in a reason, so a dialog stays readable. */
const STDERR_IN_REASON_CHARS = 400

/** @returns whether the value is a JSON object, which the doctor report is. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @returns whether the value is one of the runner's readiness states. */
function isState(value: unknown): value is ReadinessItem['state'] {
  return value === 'ready' || value === 'missing' || value === 'unreachable' || value === 'not-configured'
}

/** @returns the child factory the run uses, the real spawn unless a test supplied one. */
function childFactory(options: RunReadinessOptions): (command: string, args: readonly string[]) => SpawnedChildLike {
  const environment = options.env
  const directory = options.runnerDirectory
  return (command, args) => spawn(command, [...args], {
    cwd: directory,
    ...(environment === undefined ? {} : { env: environment }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }) as unknown as SpawnedChildLike
}

/**
 * @param stderr - the retained tail of the child's standard error.
 * @returns a short, whitespace-collapsed suffix for a reason, or the empty string.
 */
function stderrSuffix(stderr: string): string {
  const tail = stderr.trim().replace(/\s+/gu, ' ').slice(-STDERR_IN_REASON_CHARS)
  return tail === '' ? '' : `: ${tail}`
}

/** @returns one item passed through, or `undefined` when the entry is not a valid item. */
function mapItem(value: unknown): ReadinessItem | undefined {
  if (!record(value)) return undefined
  if (typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.required !== 'boolean') return undefined
  if (!isState(value.state)) return undefined
  const item: ReadinessItem = { id: value.id, label: value.label, state: value.state, required: value.required }
  if (typeof value.detail === 'string') item.detail = value.detail
  if (typeof value.fix === 'string') item.fix = value.fix
  return item
}

/**
 * @param stdout - the collected standard output, capped by the caller.
 * @returns the parsed view, or a safe failure when the JSON is absent or misshapen.
 */
function parseReport(stdout: string): ReadinessResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { ok: false, reason: 'the readiness doctor returned unparseable output' }
  }
  if (!record(parsed)) return { ok: false, reason: 'the readiness doctor returned an unexpected report' }
  if (!Array.isArray(parsed.items)) {
    return { ok: false, reason: 'the readiness doctor returned a report without readiness items' }
  }
  if (typeof parsed.ok !== 'boolean' || typeof parsed.summary !== 'string') {
    return { ok: false, reason: 'the readiness doctor returned an unexpected report' }
  }
  const items: ReadinessItem[] = []
  for (const entry of parsed.items) {
    const item = mapItem(entry)
    if (item === undefined) return { ok: false, reason: 'the readiness doctor returned an unexpected report' }
    items.push(item)
  }
  return { ok: true, readiness: { ok: parsed.ok, summary: parsed.summary, items } }
}

/** Collect output from one child, then settle on its exit, its error, its timeout, or its output size. */
function collectAndSettle(child: SpawnedChildLike, timeoutMs: number): Promise<ReadinessResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stdoutExceeded = false
    let stderr = ''
    let finished = false

    const finish = (result: ReadinessResult): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill?.()
      finish({ ok: false, reason: 'the readiness doctor did not finish in time' })
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (stdoutExceeded) return
      stdout += chunk.toString()
      if (stdout.length > MAX_STDOUT_BYTES) {
        stdoutExceeded = true
        finish({ ok: false, reason: 'the readiness doctor output exceeded the supported size' })
      }
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_STDERR_CHARS)
    })

    child.on('error', () => {
      finish({ ok: false, reason: `the readiness doctor could not be started${stderrSuffix(stderr)}` })
    })

    child.on('exit', (code) => {
      if (stdoutExceeded) return
      if (code === 0) {
        finish(parseReport(stdout))
        return
      }
      const detail = code === null ? 'it exited on a signal' : `it exited with code ${String(code)}`
      finish({ ok: false, reason: `the readiness doctor failed: ${detail}${stderrSuffix(stderr)}` })
    })
  })
}

/**
 * Run the bundled runner's `doctor --json` once and reduce its report to a view
 * the welcome window can show.
 *
 * The child is spawned as `node <runnerDirectory>/dist/cli.js doctor --json` with
 * the runner directory as its working directory, so the doctor resolves its own
 * payload the same way the console does. The spawn is injectable so tests never
 * launch the real runner.
 *
 * @param options - runtime, runner directory, environment, and test seams.
 * @returns the mapped view, or a failure reason that never carries a secret.
 */
export async function runRunnerReadiness(options: RunReadinessOptions): Promise<ReadinessResult> {
  const entry = join(options.runnerDirectory, REDTEAM_RUNNER_ENTRY)
  const argv = [entry, 'doctor', '--json']
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const spawnChild = options.spawn ?? childFactory(options)

  let child: SpawnedChildLike
  try {
    child = spawnChild(options.node, argv)
  } catch {
    return { ok: false, reason: 'the readiness doctor could not be started' }
  }
  return await collectAndSettle(child, timeoutMs)
}
