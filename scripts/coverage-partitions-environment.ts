/** Environment variables and argument parsing for partitioned coverage. */

/** Environment variable selecting the number of instrumented coverage processes. */
export const COVERAGE_PARTITIONS_ENV = 'DSH_COVERAGE_PARTITIONS'

/** Internal marker that suppresses reports and thresholds inside a partition process. */
export const COVERAGE_PARTITION_MODE_ENV = 'DSH_COVERAGE_PARTITION_MODE'

/** Environment variable overriding instrumented test, polling, and hook timeouts. */
export const COVERAGE_TEST_TIMEOUT_ENV = 'DSH_COVERAGE_TEST_TIMEOUT_MS'

/** Parse an optional coverage partition count. */
export function parseCoveragePartitionCount(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 2 || String(parsed) !== raw) {
    throw new Error(`${COVERAGE_PARTITIONS_ENV} must be an integer greater than 1, got ${JSON.stringify(raw)}.`)
  }
  return parsed
}

/**
 * Resolve the paired Vitest timeout arguments used by coverage partitions.
 * `--hookTimeout` travels with the test budget because setup and teardown pay
 * the same host contention the raised test budget accounts for: fixtures that
 * await child exit or retry Windows handle release spend that cost in
 * `afterEach`, where Vitest's separate 10 s default would otherwise fail a
 * suite whose cases all passed.
 * @param raw - the configured millisecond budget, or undefined to keep Vitest's defaults.
 * @returns the Vitest arguments applying that budget, empty when unset.
 */
export function coverageTestTimeoutArgs(raw: string | undefined): string[] {
  if (raw === undefined || raw === '') return []
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`${COVERAGE_TEST_TIMEOUT_ENV} must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  return [`--testTimeout=${raw}`, `--expect.poll.timeout=${raw}`, `--hookTimeout=${raw}`]
}

/** Remove pnpm's package-script separator before forwarding Vitest arguments. */
export function forwardedCoverageArgs(args: readonly string[]): string[] {
  return [...args.slice(args[0] === '--' ? 1 : 0)]
}
