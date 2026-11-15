/** Reachability scan for Host packages that still carry non-Cordis peers. */

import type { RegistryIndex } from './benchmark-npm-resolution.ts'
import type { WorkspacePackageManifest } from './verify-package-dependencies.ts'

/** The Host package whose published dependency tree the benchmark measures. */
export const TARGET_PACKAGE = '@deepseek-ai/dsh'

const CORDIS = '@deepseek-ai/cordis'

/** Find reachable Host candidates whose published manifests still carry non-Cordis peers. */
export function discoverBenchmarkCandidates(
  index: RegistryIndex,
  workspaceVersions: ReadonlyMap<string, string>,
  releasePackages: ReadonlyMap<string, WorkspacePackageManifest>,
  policyPackages: ReadonlySet<string>,
): string[] {
  const reached = new Set<string>()
  const queue = [TARGET_PACKAGE]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const name = queue[cursor]
    if (name === undefined || reached.has(name)) continue
    const version = workspaceVersions.get(name)
    const manifest = version === undefined ? undefined : index.get(name)?.get(version)
    if (manifest === undefined) continue
    reached.add(name)
    const installed = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...Object.fromEntries(Object.entries(manifest.peerDependencies ?? {})
        .filter(([peer]) => (manifest.peerDependenciesMeta?.[peer] as { optional?: boolean } | undefined)?.optional !== true)),
    }
    for (const dependency of Object.keys(installed).sort()) {
      if (!reached.has(dependency)) queue.push(dependency)
    }
  }
  return [...reached].filter((name) => {
    if (policyPackages.has(name) || !releasePackages.has(name)) return false
    const version = workspaceVersions.get(name)
    const manifest = version === undefined ? undefined : index.get(name)?.get(version)
    return Object.keys(manifest?.peerDependencies ?? {}).some(peer => peer !== CORDIS)
  }).sort()
}
