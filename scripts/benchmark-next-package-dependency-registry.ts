/** Registry manifests the benchmark rewrites, and the dependency policy applied to them. */

import { publishWorkspaceRange, type RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  repairPackageDependencyManifest,
  type PackageDependencyFacts,
  type WorkspacePackageManifest,
} from './verify-package-dependencies.ts'

/** A registry manifest whose dependency sections the benchmark rewrites in memory. */
export interface MutableRegistryManifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/**
 * Copy a registry index so one candidate's manifests can be rewritten without
 * disturbing the baseline.
 * @param index - Registry index to copy.
 * @returns An independent copy keyed by package name and version.
 */
export function cloneIndex(index: RegistryIndex): Map<string, Map<string, MutableRegistryManifest>> {
  return new Map([...index].map(([name, versions]) => [
    name,
    new Map([...versions].map(([version, manifest]) => [
      version,
      structuredClone(manifest) as MutableRegistryManifest,
    ])),
  ]))
}

function publishedSection(
  values: Readonly<Record<string, string>> | undefined,
  workspaceVersions: ReadonlyMap<string, string>,
): Record<string, string> | undefined {
  if (values === undefined) return undefined
  return Object.fromEntries(Object.entries(values).map(([name, range]) => {
    const version = workspaceVersions.get(name)
    return [name, version === undefined ? range : publishWorkspaceRange(range, version)]
  }))
}

/** Apply one source-derived policy result to an in-memory registry manifest. */
export function applyFactsToRegistry(
  index: Map<string, Map<string, MutableRegistryManifest>>,
  facts: PackageDependencyFacts,
  workspaceVersions: ReadonlyMap<string, string>,
): void {
  const source = structuredClone(facts.manifest)
  repairPackageDependencyManifest({ ...facts, manifest: source })
  const version = workspaceVersions.get(source.name ?? '')
  const target = version === undefined ? undefined : index.get(source.name ?? '')?.get(version)
  if (target === undefined) throw new Error(`local registry has no ${source.name ?? 'unnamed package'}@${version ?? 'unknown'}`)
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const values = publishedSection(source[field], workspaceVersions)
    if (values !== undefined) target[field] = values
    else if (field === 'dependencies') delete target.dependencies
    else if (field === 'optionalDependencies') delete target.optionalDependencies
    else delete target.peerDependencies
  }
  if (source.peerDependenciesMeta === undefined) delete target.peerDependenciesMeta
  else target.peerDependenciesMeta = structuredClone(source.peerDependenciesMeta) as Record<string, { optional?: boolean }>
}

/**
 * Read one workspace package's declared version.
 * @param pkg - Workspace package manifest record.
 * @returns The version string declared in the package manifest.
 */
export function currentVersion(pkg: WorkspacePackageManifest): string {
  const version = pkg.manifest.version
  if (typeof version !== 'string') throw new Error(`${pkg.manifestPath}: missing package version`)
  return version
}
