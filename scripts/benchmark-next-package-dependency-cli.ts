/** Command-line entry point for the next-package dependency benchmark. */

import { resolve } from 'node:path'
import { buildRegistryIndex } from './benchmark-npm-resolution.ts'
import {
  readPackageDependencyFacts,
  readPackageDependencyState,
  readWorkspacePackageManifests,
} from './verify-package-dependencies.ts'
import { discoverBenchmarkCandidates, TARGET_PACKAGE } from './benchmark-next-package-dependency-candidates.ts'
import { mapConcurrent, measure, median, type Measurement } from './benchmark-next-package-dependency-measure.ts'
import { parseNextPackageBenchmarkOptions } from './benchmark-next-package-dependency-options.ts'
import { applyFactsToRegistry, cloneIndex, currentVersion } from './benchmark-next-package-dependency-registry.ts'

/**
 * Rank the reachable Host candidates by how much each shortens resolution.
 * @returns Completion after the baseline, coarse round, and finalist round print.
 */
export async function main(): Promise<void> {
  const options = parseNextPackageBenchmarkOptions(process.argv.slice(2))
  const root = resolve(import.meta.dirname, '..')
  const packages = readWorkspacePackageManifests(root)
  const workspaceVersions = new Map(packages.all.map(pkg => [pkg.name, currentVersion(pkg)]))
  const releaseByName = new Map(packages.release.map(pkg => [pkg.name, pkg]))
  const state = readPackageDependencyState(root)
  if (state.policyViolations.length > 0) throw new Error(state.policyViolations.join('\n'))
  const base = cloneIndex(buildRegistryIndex(root))
  for (const facts of state.facts) applyFactsToRegistry(base, facts, workspaceVersions)
  const targetVersion = workspaceVersions.get(TARGET_PACKAGE)
  if (targetVersion === undefined) throw new Error(`workspace has no ${TARGET_PACKAGE}`)
  const policyNames = new Set(state.facts.map(facts => facts.manifest.name).filter(name => name !== undefined))
  const discovered = discoverBenchmarkCandidates(base, workspaceVersions, releaseByName, policyNames)
  const candidates = options.candidates ?? discovered
  for (const name of candidates) {
    if (!discovered.includes(name)) throw new Error(`${name} is not a reachable unconfigured Host candidate`)
  }
  const candidateFacts = new Map(candidates.map((name) => {
    const pkg = releaseByName.get(name)
    if (pkg === undefined) throw new Error(`release set has no ${name}`)
    return [name, readPackageDependencyFacts(root, pkg, 'configured-host', state.workspaceNames)]
  }))

  const baselineSeconds = await measure(base, targetVersion, options.finalistRuns, options.timeoutMs)
  const baseline = median(baselineSeconds)
  console.log(JSON.stringify({ type: 'baseline', seconds: baselineSeconds, medianSeconds: baseline }))

  const coarse = await mapConcurrent(candidates, options.jobs, async (name): Promise<Measurement> => {
    const index = cloneIndex(base)
    const facts = candidateFacts.get(name)
    if (facts === undefined) throw new Error(`missing source facts for ${name}`)
    applyFactsToRegistry(index, facts, workspaceVersions)
    const seconds = await measure(index, targetVersion, options.coarseRuns, options.timeoutMs)
    const result = { package: name, seconds, medianSeconds: median(seconds) }
    console.log(JSON.stringify({ type: 'coarse', ...result }))
    return result
  })
  const finalists = coarse.sort((left, right) => left.medianSeconds - right.medianSeconds)
    .slice(0, options.finalists)
  const measured: Measurement[] = []
  for (const finalist of finalists) {
    const index = cloneIndex(base)
    const facts = candidateFacts.get(finalist.package)
    if (facts === undefined) throw new Error(`missing source facts for ${finalist.package}`)
    applyFactsToRegistry(index, facts, workspaceVersions)
    const seconds = await measure(index, targetVersion, options.finalistRuns, options.timeoutMs)
    measured.push({ package: finalist.package, seconds, medianSeconds: median(seconds) })
  }
  const ranking = measured.sort((left, right) => left.medianSeconds - right.medianSeconds)
    .map(result => ({
      ...result,
      gainSeconds: Number((baseline - result.medianSeconds).toFixed(2)),
    }))
  console.log(JSON.stringify({
    type: 'result',
    baselineSeconds,
    baselineMedianSeconds: baseline,
    candidateCount: candidates.length,
    ranking,
  }, null, 2))
}
