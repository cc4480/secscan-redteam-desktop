/**
 * Scheduler environment for the gate runner: worker-count defaults, CI worker
 * settings, and validated numeric environment overrides.
 */
import { availableParallelism } from 'node:os'
import { COVERAGE_PARTITIONS_ENV } from './coverage-partitions.ts'
import type { ConcurrencyDefault, Mode } from './run-gates-types.ts'

/**
 * Resolve the default worker count for one aggregate.
 * @param selectedMode - aggregate whose resource posture applies.
 * @param total - number of gates in the aggregate.
 * @param available - host CPU availability for ordinary modes.
 * @returns the default worker count and its diagnostic source.
 */
export function defaultConcurrency(
  selectedMode: Mode,
  total: number,
  available = availableParallelism(),
): ConcurrencyDefault {
  // Local modes cap workers: several doc gates each build a full ts.Program,
  // so an uncapped default on a large host trades wall clock for memory blowups.
  const localCap = selectedMode === 'check-all'
    || selectedMode === 'hygiene'
    || selectedMode === 'doc-sync'
    || selectedMode === 'doc-quick'
  const modeLimit = localCap ? Math.min(4, available) : available
  return {
    workers: Math.min(total, modeLimit),
    source: localCap
      ? `${available} available CPU(s), ${selectedMode} cap 4`
      : `${available} available CPU(s)`,
  }
}

/**
 * Fill CI worker defaults from the CPU allocation without replacing explicit overrides.
 * Coverage shares one budget; artifact readers share CPUs with sibling commands.
 * @param mode - aggregate selected by the caller.
 * @param env - inherited worker overrides, including serial reference settings.
 * @param available - CPUs available to this runner process.
 * @returns environment additions for this aggregate and its children.
 */
export function ciWorkerEnvironment(
  mode: Mode,
  env: NodeJS.ProcessEnv,
  available = availableParallelism(),
): Record<string, string> {
  if (!mode.startsWith('ci-')) return {}
  const additions: Record<string, string> = {}
  const setDefault = (name: string, value: number): void => {
    if (env[name] === undefined || env[name] === '') additions[name] = String(value)
  }
  const shared = Math.max(1, Math.floor(available / 2))
  setDefault('DSH_OXLINT_THREADS', shared)
  setDefault('DSH_PUBLINT_CONCURRENCY', shared)
  setDefault('DSH_SNAPSHOT_MAX_WORKERS', 1)
  setDefault('DSH_SNAPSHOT_MAX_CONCURRENCY', shared)
  setDefault('DSH_WEB_SNAPSHOT_WORKERS', env.DSH_GATE_CONCURRENCY === '1' ? 1 : available)
  setDefault('DSH_COVERAGE_MAX_WORKERS', available)
  const coverageBudget = env.DSH_COVERAGE_MAX_WORKERS || String(available)
  const total = Number(coverageBudget)
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new Error(`run-gates: DSH_COVERAGE_MAX_WORKERS must be a positive integer, got ${JSON.stringify(coverageBudget)}.`)
  }
  const instrumented = Math.max(1, total - Math.max(1, Math.floor(total / 3)))
  if (instrumented > 1) setDefault(COVERAGE_PARTITIONS_ENV, instrumented)
  return additions
}

/**
 * Read one positive worker count from the environment.
 * @param name - environment variable holding the count.
 * @param fallback - value used when the variable is absent or empty.
 * @returns the parsed count, or the fallback.
 */
export function concurrencyFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`run-gates: ${name} must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  return parsed
}

/**
 * Read a boolean flag whose only accepted value is `1`.
 * @param envName - environment variable holding the flag.
 * @returns whether the flag is enabled.
 */
export function flagEnabled(envName: string): boolean {
  const raw = process.env[envName]
  if (raw === undefined || raw === '') return false
  if (raw !== '1') throw new Error(`run-gates: ${envName} must be 1 when set, got ${JSON.stringify(raw)}.`)
  return true
}

/**
 * Render one positive integer from the environment as a CLI flag.
 * @param envName - environment variable holding the value.
 * @param flag - CLI flag name to render.
 * @returns the rendered `flag=value` argument, or an empty list when unset.
 */
export function positiveIntArg(envName: string, flag: string): string[] {
  const raw = process.env[envName]
  if (raw === undefined || raw === '') return []
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`run-gates: ${envName} must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  return [`${flag}=${raw}`]
}

/**
 * Active Node major used to select version-specific compatibility checks.
 * @returns the running Node major version.
 */
export function runningNodeMajor(): number {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
  if (!Number.isSafeInteger(major)) {
    throw new Error(`run-gates: cannot parse Node version ${JSON.stringify(process.versions.node)}.`)
  }
  return major
}
