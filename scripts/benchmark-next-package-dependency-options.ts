/** Command-line option parsing for the next-package dependency benchmark. */

import { availableParallelism } from 'node:os'
import { parseArgs } from 'node:util'
import { parsePositiveIntegerOption } from './benchmark-npm-resolution.ts'

/** Parsed command-line options for one next-package benchmark invocation. */
export interface Options {
  readonly candidates?: readonly string[]
  readonly coarseRuns: number
  readonly finalistRuns: number
  readonly finalists: number
  readonly jobs: number
  readonly timeoutMs: number
}

/** Parse benchmark selection and repetition options. */
export function parseNextPackageBenchmarkOptions(args: readonly string[]): Options {
  const normalized = args[0] === '--' ? args.slice(1) : args
  const { values } = parseArgs({
    args: [...normalized],
    options: {
      candidates: { type: 'string' },
      runs: { type: 'string' },
      'finalist-runs': { type: 'string' },
      finalists: { type: 'string' },
      jobs: { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
    allowPositionals: false,
  })
  return {
    ...(values.candidates === undefined
      ? {}
      : { candidates: values.candidates.split(',').filter(Boolean) }),
    coarseRuns: parsePositiveIntegerOption(values.runs, 1, '--runs'),
    finalistRuns: parsePositiveIntegerOption(values['finalist-runs'], 3, '--finalist-runs'),
    finalists: parsePositiveIntegerOption(values.finalists, 5, '--finalists'),
    jobs: parsePositiveIntegerOption(values.jobs, Math.min(8, availableParallelism()), '--jobs'),
    timeoutMs: parsePositiveIntegerOption(values['timeout-ms'], 120_000, '--timeout-ms'),
  }
}
