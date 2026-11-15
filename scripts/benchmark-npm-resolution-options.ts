/** Command-line option parsing for the npm resolution benchmark. */

import { parseArgs } from 'node:util'

const DEFAULT_TIMEOUT_MS = 300_000

/** Parsed command-line options for one benchmark invocation. */
export interface BenchmarkOptions {
  readonly ref?: string
  readonly runs: number
  readonly timeoutMs: number
  readonly maxMs?: number
}

/** Parse one positive-integer command-line option or use its default. */
export function parsePositiveIntegerOption(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value < 1 || String(value) !== raw) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

/**
 * Parse supported benchmark arguments.
 * @param args - Command-line arguments after the script path.
 * @returns Validated benchmark options.
 */
export function parseBenchmarkOptions(args: readonly string[]): BenchmarkOptions {
  const normalized = args[0] === '--' ? args.slice(1) : args
  const { values } = parseArgs({
    args: [...normalized],
    options: {
      ref: { type: 'string' },
      runs: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'max-ms': { type: 'string' },
    },
    allowPositionals: false,
  })
  const maxMs = values['max-ms'] === undefined
    ? undefined
    : parsePositiveIntegerOption(values['max-ms'], 0, '--max-ms')
  return {
    runs: parsePositiveIntegerOption(values.runs, 1, '--runs'),
    timeoutMs: parsePositiveIntegerOption(values['timeout-ms'], DEFAULT_TIMEOUT_MS, '--timeout-ms'),
    ...(values.ref === undefined ? {} : { ref: values.ref }),
    ...(maxMs === undefined ? {} : { maxMs }),
  }
}
