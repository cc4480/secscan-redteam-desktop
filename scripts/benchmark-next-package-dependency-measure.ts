/** Repeated resolution timings for one registry layout. */

import { benchmarkNpmResolution, type RegistryIndex } from './benchmark-npm-resolution.ts'

/** One candidate's repeated resolution timings. */
export interface Measurement {
  readonly package: string
  readonly seconds: readonly number[]
  readonly medianSeconds: number
}

/**
 * Take the median of a timing sample.
 * @param values - Timing sample in seconds.
 * @returns The middle value, averaged for an even-length sample.
 */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0
}

/**
 * Time the target package's resolution against one registry layout.
 * @param index - Registry layout to resolve against.
 * @param targetVersion - Version of the target package to resolve.
 * @param runs - Number of timed runs.
 * @param timeoutMs - Per-run timeout.
 * @returns Each run's duration in seconds, rounded to two decimals.
 */
export async function measure(
  index: RegistryIndex,
  targetVersion: string,
  runs: number,
  timeoutMs: number,
): Promise<number[]> {
  const seconds: number[] = []
  for (let run = 0; run < runs; run += 1) {
    const result = await benchmarkNpmResolution(index, targetVersion, timeoutMs)
    if (result.archiveRequests > 0) throw new Error('metadata-only benchmark requested package archives')
    seconds.push(Number((result.durationMs / 1000).toFixed(2)))
  }
  return seconds
}

/**
 * Map values through an async operation with bounded concurrency.
 * @param values - Values to process.
 * @param jobs - Maximum number of concurrent operations.
 * @param operation - Operation applied to each value.
 * @returns Results in input order.
 */
export async function mapConcurrent<T, R>(
  values: readonly T[],
  jobs: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(jobs, values.length) }, async () => {
    while (next < values.length) {
      const index = next
      next += 1
      const value = values[index]
      if (value === undefined) return
      results[index] = await operation(value)
    }
  }))
  return results
}
