/** Required dependency sections and the Host runtime edges they produce. */

import type {
  ExpectedPackageDependency,
  PackageDependencyFacts,
  PackageDependencyState,
} from './verify-package-dependencies.types.ts'
import { CORDIS, GATE } from './verify-package-dependencies.shared.ts'

/** Derive the required npm section for each relationship owned by the policy. */
export function expectedPackageDependencies(
  facts: PackageDependencyFacts,
): ReadonlyMap<string, ExpectedPackageDependency> {
  const expected = new Map<string, { section: ExpectedPackageDependency['section']; origins: Set<string> }>()
  const add = (name: string, sectionName: ExpectedPackageDependency['section'], origin: string): void => {
    if (name === facts.manifest.name || name === CORDIS) return
    const current = expected.get(name)
    const section = current?.section === 'peer-dev' || sectionName === 'peer-dev'
      ? 'peer-dev'
      : current?.section === 'dependencies' || sectionName === 'dependencies'
        ? 'dependencies'
        : 'devDependencies'
    expected.set(name, { section, origins: new Set([...(current?.origins ?? []), origin]) })
  }

  expected.set(CORDIS, { section: 'peer-dev', origins: new Set(['shared Cordis runtime']) })
  for (const [name, paths] of facts.allSourceUses) {
    for (const path of paths) add(name, 'devDependencies', path)
  }
  if (facts.role !== 'configured-host') {
    for (const sectionName of ['dependencies', 'optionalDependencies'] as const) {
      for (const name of Object.keys(facts.manifest[sectionName] ?? {})) {
        if (!facts.workspaceNames.has(name)) add(name, 'devDependencies', 'declared browser build input')
      }
    }
  }
  for (const name of facts.clientInject) {
    if (facts.workspaceNames.has(name)) add(name, 'devDependencies', 'dsh.client.inject')
  }
  for (const name of facts.configurationOnlyDevDependencies) {
    if (facts.workspaceNames.has(name)) add(name, 'devDependencies', 'configured development-only relationship')
  }
  for (const name of Object.keys(facts.manifest.peerDependencies ?? {})) {
    if (name !== CORDIS) add(name, 'devDependencies', 'existing non-Cordis peer')
  }
  for (const [name, paths] of facts.hostRuntimeSourceUses) {
    const expectedSection = facts.workspaceNames.has(name) && facts.peerRequiredHostDependencies.has(name)
      ? 'peer-dev'
      : 'dependencies'
    for (const path of paths) add(name, expectedSection, path)
  }
  return new Map([...expected].map(([name, rule]) => [name, {
    section: rule.section,
    origins: [...rule.origins].sort(),
  }]))
}

interface ManagedRuntimeEdge {
  readonly consumer: string
  readonly dependency: string
  readonly exports: readonly string[]
}

function managedRuntimeEdges(
  state: PackageDependencyState,
  expectedSection: 'dependencies' | 'peer-dev',
): ManagedRuntimeEdge[] {
  return state.facts.flatMap(facts => [...expectedPackageDependencies(facts)]
    .filter(([name, rule]) => name !== CORDIS && rule.section === expectedSection)
    .map(([dependency]) => ({
      consumer: facts.manifest.name ?? facts.manifestPath,
      dependency,
      exports: [...new Set(facts.hostRuntimeExportUses
        .filter(use => use.packageName === dependency)
        .map(use => `${use.specifier}#${use.exportName}`))].sort(),
    })))
    .sort((left, right) =>
      left.consumer.localeCompare(right.consumer) || left.dependency.localeCompare(right.dependency))
}

/** Format Host runtime edges whose reviewed exports permit ordinary dependencies. */
export function formatManagedRuntimeDependencies(state: PackageDependencyState): string[] {
  const rows = managedRuntimeEdges(state, 'dependencies')
  const packages = new Set(rows.map(row => row.consumer)).size
  return [
    `${GATE}: ${String(rows.length)} managed Host runtime edge(s) remain in dependencies across ${String(packages)} package(s):`,
    ...rows.map(row => `  ${row.consumer} -> ${row.dependency}: ${row.exports.join(', ')}`),
  ]
}

/** Format Host runtime edges retained as peers by their imported export classification. */
export function formatPeerRequiredRuntimeDependencies(state: PackageDependencyState): string[] {
  const rows = managedRuntimeEdges(state, 'peer-dev')
  const packages = new Set(rows.map(row => row.consumer)).size
  return [
    `${GATE}: ${String(rows.length)} Host runtime edge(s) remain in peerDependencies because their exports require shared identity across ${String(packages)} package(s):`,
    ...rows.map(row => `  ${row.consumer} -> ${row.dependency}: ${row.exports.join(', ')}`),
  ]
}
