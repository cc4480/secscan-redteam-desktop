/** Manifest section access and mutation helpers shared by the violation and repair modules. */

import type { DependencySection } from './verify-package-dependencies.shared.ts'
import type { PackageDependencyManifest } from './verify-package-dependencies.types.ts'

/**
 * Read one manifest dependency section.
 * @param manifest - Manifest to read.
 * @param name - Section name.
 * @returns the declared section, or an empty record when absent.
 */
export function section(manifest: PackageDependencyManifest, name: DependencySection): Record<string, string> {
  return manifest[name] ?? {}
}

/**
 * Read one manifest dependency section, creating it when absent.
 * @param manifest - Manifest to mutate.
 * @param name - Section name.
 * @returns the writable section record.
 */
export function mutableSection(manifest: PackageDependencyManifest, name: DependencySection): Record<string, string> {
  manifest[name] ??= {}
  return manifest[name]
}

/**
 * List the manifest sections declaring one dependency.
 * @param manifest - Manifest to inspect.
 * @param name - Dependency package name.
 * @returns the declaring section names.
 */
export function declaredSections(manifest: PackageDependencyManifest, name: string): DependencySection[] {
  return (['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const)
    .filter(sectionName => section(manifest, sectionName)[name] !== undefined)
}

/**
 * Describe a set of declaring sections for a diagnostic.
 * @param sections - Declaring section names.
 * @returns the diagnostic phrase.
 */
export function describeSections(sections: readonly DependencySection[]): string {
  return sections.length === 0 ? 'no dependency section' : sections.join(' + ')
}

/**
 * Remove one dependency from a manifest section, dropping the empty section.
 * @param manifest - Manifest to mutate.
 * @param sectionName - Section holding the dependency.
 * @param name - Dependency package name.
 */
export function deleteDependency(
  manifest: PackageDependencyManifest,
  sectionName: DependencySection,
  name: string,
): void {
  const dependencies = manifest[sectionName]
  if (dependencies?.[name] === undefined) return
  const retained = Object.fromEntries(Object.entries(dependencies).filter(([key]) => key !== name))
  if (Object.keys(retained).length > 0) {
    manifest[sectionName] = retained
    return
  }
  switch (sectionName) {
    case 'dependencies': delete manifest.dependencies; break
    case 'devDependencies': delete manifest.devDependencies; break
    case 'optionalDependencies': delete manifest.optionalDependencies; break
    case 'peerDependencies': delete manifest.peerDependencies; break
  }
}

/**
 * Remove one peer dependency classification, dropping the empty record.
 * @param manifest - Manifest to mutate.
 * @param name - Dependency package name.
 */
export function deletePeerMeta(manifest: PackageDependencyManifest, name: string): void {
  if (manifest.peerDependenciesMeta?.[name] === undefined) return
  const retained = Object.fromEntries(Object.entries(manifest.peerDependenciesMeta)
    .filter(([key]) => key !== name))
  if (Object.keys(retained).length > 0) manifest.peerDependenciesMeta = retained
  else delete manifest.peerDependenciesMeta
}
