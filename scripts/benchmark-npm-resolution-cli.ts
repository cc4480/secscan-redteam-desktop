/** Command-line entry point for the npm resolution benchmark. */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { npmExecutable } from './benchmark-npm-resolution-install.ts'
import { benchmarkNpmResolution, TARGET_PACKAGE } from './benchmark-npm-resolution-lock.ts'
import { parseBenchmarkOptions } from './benchmark-npm-resolution-options.ts'
import { buildRegistryIndex, latestVersion } from './benchmark-npm-resolution-registry.ts'

/**
 * Benchmark npm resolution against the repository's local registry.
 * @returns Completion after every requested run.
 */
export async function main(): Promise<void> {
  const options = parseBenchmarkOptions(process.argv.slice(2))
  const root = resolve(import.meta.dirname, '..')
  const started = performance.now()
  const index = buildRegistryIndex(root, options.ref)
  const targetVersions = index.get(TARGET_PACKAGE)
  if (targetVersions === undefined) throw new Error(`local registry contains no ${TARGET_PACKAGE}`)
  const targetVersion = latestVersion(targetVersions)
  const npmVersion = execFileSync(npmExecutable(), ['--version'], { encoding: 'utf8' }).trim()
  console.log(
    `benchmark-npm-resolution: npm ${npmVersion}, ${options.ref === undefined ? 'working tree' : options.ref}, `
    + `${String(index.size)} package name(s), setup ${(performance.now() - started).toFixed(0)} ms.`,
  )
  const durations: number[] = []
  for (let run = 1; run <= options.runs; run++) {
    const result = await benchmarkNpmResolution(index, targetVersion, options.timeoutMs)
    durations.push(result.durationMs)
    console.log(
      `benchmark-npm-resolution: run ${String(run)}/${String(options.runs)} resolved ${TARGET_PACKAGE}@${targetVersion}`
      + ` in ${(result.durationMs / 1000).toFixed(2)} s with ${String(result.registryRequests)} metadata request(s)`
      + ` and ${String(result.unknownPackages.length)} local 404 package name(s).`,
    )
    if (result.archiveRequests > 0) throw new Error('npm requested package archives during the metadata-only benchmark')
  }
  const minimum = Math.min(...durations)
  const maximum = Math.max(...durations)
  console.log(
    `benchmark-npm-resolution: ${String(options.runs)} run(s), min ${(minimum / 1000).toFixed(2)} s, max ${(maximum / 1000).toFixed(2)} s.`,
  )
  if (options.maxMs !== undefined && maximum > options.maxMs) {
    throw new Error(`npm resolution exceeded --max-ms=${String(options.maxMs)} (max ${maximum.toFixed(0)} ms)`)
  }
}
