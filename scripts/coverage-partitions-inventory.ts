/**
 * Instrumented test-file inventory, its Vitest project ownership, and the
 * recorded per-file durations the coordinator weights partitions by.
 */
import { spawn } from 'node:child_process'
import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { coverageExemptHeavySuites } from './coverage-exempt.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/**
 * Coordinator-maintained duration history. CI removes `node_modules/.vite`
 * on every checkout, so Vitest's own cache never survives there; this
 * gitignored file at the repository root carries recorded durations across
 * runs on a persistent checkout (self-hosted runners).
 */
const FILE_TIMES_NAME = '.coverage-times.json'

/**
 * The instrumented inventory: every file plus the Vitest project it belongs
 * to (`thread-safe` or `process-bound`). Preserving the per-project split
 * matters because the projects are mutually exclusive: a file's own project
 * must run it exactly once, so a partition config cannot hand the whole
 * partition list to every project.
 */
export interface InstrumentedInventory {
  files: string[]
  /** Project name per file; the pool prefix of the `vitest list` line. */
  projectOf: Map<string, string>
}

/**
 * Parse `vitest list --filesOnly` output into the instrumented inventory:
 * one `[pool] path` line per file, deduplicated, minus the exempt heavy
 * suites that `vitest list` itself does not exclude.
 */
export function parseListOutput(output: string, root: string): InstrumentedInventory {
  const files = new Set<string>()
  const projectOf = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]\s+(\S+\.spec\.(?:ts|tsx))$/.exec(line)
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      files.add(match[2])
      projectOf.set(match[2], match[1])
    }
  }
  for (const suite of coverageExemptHeavySuites) {
    for (const file of globSync(suite.exclude, { cwd: root })) {
      // globSync returns platform separators on Windows; the parsed inventory
      // and Vitest include patterns both use forward slashes.
      const normalized = file.split('\\').join('/')
      files.delete(normalized)
      projectOf.delete(normalized)
    }
  }
  return { files: [...files].sort(), projectOf }
}

/**
 * Collect the instrumented coverage inventory from a `vitest list --filesOnly`
 * run: no test collection and no worker pool, just the file list. Caller
 * filters (positional args after `--`) narrow the list before the exempt
 * heavy suites are removed here because `vitest list` does not apply the
 * `COVERAGE_EXEMPT_ENV` exclusion.
 */
export async function collectInstrumentedFiles(
  root: string,
  pnpmEntrypoint: string,
  filters: readonly string[] = [],
): Promise<InstrumentedInventory> {
  const invocation = pnpmInvocation(['exec', 'vitest', 'list', '--filesOnly', ...filters], { npm_execpath: pnpmEntrypoint })
  const output = await runListCommand(invocation.command, invocation.args, root)
  return parseListOutput(output, root)
}

/** Run `vitest list` and return its stdout, or throw with exit code and stderr. */
function runListCommand(command: string, args: string[], root: string): Promise<string> {
  return new Promise((resolveList, rejectList) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let errorOutput = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output += chunk })
    child.stderr.on('data', (chunk: string) => { errorOutput += chunk })
    child.once('error', (error: Error) => { rejectList(error) })
    child.once('close', (code) => {
      if (code === 0) resolveList(output)
      else rejectList(new Error(`vitest list exited with ${String(code ?? 'signal')}${errorOutput === '' ? '' : `: ${errorOutput.trim().slice(0, 300)}`}`))
    })
  })
}

/**
 * Read recorded per-file durations: the coordinator's persisted file first
 * (survives CI checkouts), falling back to the Vitest results cache for local
 * development. Cache entries are `[projectName:relativePath, {duration}]`;
 * a file appearing several times keeps the average duration.
 */
export function readFileDurations(root: string): Map<string, number> {
  const persisted = readPersistedDurations(root)
  if (persisted.size > 0) return persisted
  const totals = new Map<string, { sum: number; count: number }>()
  for (const file of globSync('node_modules/.vite/vitest/*/results.json', { cwd: root })) {
    let cache: { results?: Array<[string, { duration?: number }]> }
    try {
      cache = JSON.parse(readFileSync(join(root, file), 'utf8')) as { results?: Array<[string, { duration?: number }]> }
    } catch {
      continue
    }
    for (const [key, entry] of cache.results ?? []) {
      const separator = key.indexOf(':')
      if (separator < 0) continue
      const path = key.slice(separator + 1)
      const duration = entry.duration
      if (typeof duration !== 'number') continue
      const total = totals.get(path)
      if (total === undefined) totals.set(path, { sum: duration, count: 1 })
      else {
        total.sum += duration
        total.count++
      }
    }
  }
  return new Map([...totals].map(([path, { sum, count }]) => [path, sum / count]))
}

/** Read the coordinator's persisted duration map; empty when absent or corrupt. */
function readPersistedDurations(root: string): Map<string, number> {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(join(root, FILE_TIMES_NAME), 'utf8')) as Record<string, unknown>
  } catch {
    return new Map()
  }
  const durations = new Map<string, number>()
  for (const [file, duration] of Object.entries(raw)) {
    if (typeof duration === 'number' && Number.isFinite(duration)) durations.set(file, duration)
  }
  return durations
}

/**
 * Merge new durations into the persisted file and rewrite it. A fresh run's
 * measurements overwrite earlier ones, so the history tracks the latest
 * checkout's behavior; entries whose file no longer exists in the current
 * inventory are dropped, so deleted or renamed specs never linger with stale
 * weights.
 */
export function writeFileDurations(
  root: string,
  durations: ReadonlyMap<string, number>,
  currentFiles?: readonly string[],
): void {
  if (durations.size === 0) return
  const merged = new Map(readPersistedDurations(root))
  for (const [file, duration] of durations) merged.set(file, duration)
  if (currentFiles !== undefined) {
    const present = new Set(currentFiles)
    for (const file of [...merged.keys()]) {
      if (!present.has(file)) merged.delete(file)
    }
  }
  writeFileSync(join(root, FILE_TIMES_NAME), `${JSON.stringify(Object.fromEntries(merged), null, 1)}\n`, 'utf8')
}

/**
 * Extract per-file durations from Vitest JSON reporter outputs (one per
 * partition). Each `testResults` entry names an absolute spec path and carries
 * `startTime`/`endTime`; the difference is the file's recorded duration.
 */
export function collectPartitionDurations(reportFiles: readonly string[], root: string): Map<string, number> {
  const durations = new Map<string, number>()
  for (const file of reportFiles) {
    let report: { testResults?: Array<{ name?: unknown; startTime?: number; endTime?: number }> }
    try {
      report = JSON.parse(readFileSync(file, 'utf8')) as { testResults?: Array<{ name?: unknown; startTime?: number; endTime?: number }> }
    } catch {
      continue
    }
    for (const result of report.testResults ?? []) {
      if (typeof result.name !== 'string' || typeof result.startTime !== 'number' || typeof result.endTime !== 'number') continue
      const relativePath = relative(root, result.name).split(sep).join('/')
      durations.set(relativePath, Math.max(0, result.endTime - result.startTime))
    }
  }
  return durations
}
