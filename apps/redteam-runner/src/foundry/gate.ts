/**
 * Gate CLI execution and output parsing.
 *
 * The gate runs as a child node process with an argument array only: no
 * shell, and no caller-supplied input — snapshot paths come from
 * discovery (locate.ts) and slugs from the manifest. Output is collected
 * as it streams in; the process is killed at the timeout.
 */

import { spawn } from 'node:child_process'

/** The raw outcome of a gate CLI invocation. */
export interface GateCliResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError: string | null
}

/**
 * Run the gate CLI with an argument array (never a shell). Output is
 * collected as it streams in; the process is killed at the timeout.
 *
 * @param cliPath - the located gate CLI entry (lib/types/cli.js)
 * @param args - subcommand and flags, all derived from discovery/manifest
 * @param timeoutMs - hard timeout; the child is killed past it
 * @param env - optional environment overrides for the child
 * @returns the collected result; never rejects
 */
export function runGateCli(
  cliPath: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<GateCliResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const done = (partial: Partial<GateCliResult>): void => {
      if (settled) return
      settled = true
      resolve({ exitCode: null, stdout, stderr, timedOut, spawnError: null, ...partial })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(process.execPath, [cliPath, ...args], {
        env: env ?? process.env,
        windowsHide: true,
      })
    } catch (err) {
      done({ spawnError: (err as Error).message })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf8')
      if (stdout.length > 1_048_576) stdout = stdout.slice(-1_048_576)
    })
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8')
      if (stderr.length > 262_144) stderr = stderr.slice(-262_144)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      done({ spawnError: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ exitCode: code })
    })
  })
}

/** One bundle's parsed verify line. */
export interface VerifyRow {
  slug: string
  ok: boolean
}

/** Parsed `foundry-gate verify` output. */
export interface VerifyResult {
  rows: VerifyRow[]
  okCount: number | null
  totalCount: number | null
}

/**
 * Parse verify stdout: "<slug> OK <hash>" / "<slug> MISMATCH ..." lines and
 * the closing "verified N/M bundles OK" summary.
 *
 * @param stdout - the CLI's stdout
 * @returns the parsed rows and summary counts (null when absent)
 */
export function parseVerifyOutput(stdout: string): VerifyResult {
  const rows: VerifyRow[] = []
  let okCount: number | null = null
  let totalCount: number | null = null
  for (const line of stdout.split('\n')) {
    const row = /^(\S+)\s+(OK|MISMATCH)\b/.exec(line.trim())
    if (row) {
      rows.push({ slug: row[1] ?? '', ok: row[2] === 'OK' })
      continue
    }
    const summary = /^verified (\d+)\/(\d+) bundles OK/.exec(line.trim())
    if (summary) {
      okCount = Number(summary[1])
      totalCount = Number(summary[2])
    }
  }
  return { rows, okCount, totalCount }
}

/** One bundle's parsed gate-run row. */
export interface RunRow {
  slug: string
  passRate: number | null
  observedTier: number | null
  assignedTier: number | null
  fitness: number | null
  gatePass: boolean | null
  error: string | null
}

/**
 * Parse `foundry-gate run` stdout rows: the panel row format printed per
 * bundle, or the ERROR form for a bundle that failed to run.
 *
 * @param stdout - the CLI's stdout
 * @returns the parsed rows in print order
 */
export function parseRunOutput(stdout: string): RunRow[] {
  const rows: RunRow[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    const panel = /^(\S+)\s+\[[0-9,]+\]\s+pass\s+([0-9.]+)\s+tier\s+(\S+)\s+vs\s+T(\d+)\s+F\s+([0-9.]+)\s+gate\s+(PASS|FAIL)/.exec(t)
    if (panel) {
      rows.push({
        slug: panel[1] ?? '',
        passRate: Number(panel[2]),
        observedTier: panel[3] === '-' ? null : Number(panel[3]),
        assignedTier: Number(panel[4]),
        fitness: Number(panel[5]),
        gatePass: panel[6] === 'PASS',
        error: null,
      })
      continue
    }
    const error = /^(\S+)\s+ERROR\s+(.+)$/.exec(t)
    if (error) {
      rows.push({
        slug: error[1] ?? '',
        passRate: null,
        observedTier: null,
        assignedTier: null,
        fitness: null,
        gatePass: null,
        error: error[2] ?? '',
      })
    }
  }
  return rows
}
