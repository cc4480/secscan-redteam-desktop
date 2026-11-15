/** Manifest repair applying the dependency policy to in-memory manifests. */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expectedPackageDependencies } from './verify-package-dependencies.expected.ts'
import {
  deleteDependency,
  deletePeerMeta,
  mutableSection,
  section,
} from './verify-package-dependencies.sections.ts'
import {
  CORDIS,
  workspaceRange,
  type DependencySection,
} from './verify-package-dependencies.shared.ts'
import type {
  ExpectedPackageDependency,
  PackageDependencyFacts,
  PackageDependencyState,
} from './verify-package-dependencies.types.ts'

function preferredRange(
  facts: PackageDependencyFacts,
  name: string,
  target: ExpectedPackageDependency['section'],
): string {
  if (name === CORDIS || facts.workspaceNames.has(name)) return workspaceRange(name)
  const order: readonly DependencySection[] = target === 'dependencies'
    ? ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    : ['devDependencies', 'peerDependencies', 'dependencies', 'optionalDependencies']
  const range = order.map(sectionName => section(facts.manifest, sectionName)[name]).find(value => value !== undefined)
  if (range === undefined) {
    throw new Error(`${facts.manifestPath}: cannot repair undeclared third-party dependency ${name}; declare its version range first`)
  }
  return range
}

/**
 * Apply the dependency policy to one in-memory manifest.
 * @param facts - Source uses and manifest to repair.
 * @throws When a third-party dependency has no declared range; the manifest remains unchanged.
 */
export function repairPackageDependencyManifest(facts: PackageDependencyFacts): void {
  const repairs = [...expectedPackageDependencies(facts)].map(([name, rule]) => ({
    name, rule, range: preferredRange(facts, name, rule.section),
  }))
  for (const { name, rule, range } of repairs) {
    if (rule.section === 'peer-dev') {
      for (const sectionName of ['dependencies', 'optionalDependencies'] as const) {
        deleteDependency(facts.manifest, sectionName, name)
      }
      mutableSection(facts.manifest, 'peerDependencies')[name] = range
      mutableSection(facts.manifest, 'devDependencies')[name] = range
      deletePeerMeta(facts.manifest, name)
      continue
    }
    for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      if (sectionName !== rule.section) deleteDependency(facts.manifest, sectionName, name)
    }
    mutableSection(facts.manifest, rule.section)[name] = range
    deletePeerMeta(facts.manifest, name)
  }
  for (const name of Object.keys(facts.manifest.peerDependenciesMeta ?? {})) {
    if (facts.manifest.peerDependencies?.[name] === undefined) deletePeerMeta(facts.manifest, name)
  }
  for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    for (const name of Object.keys(section(facts.manifest, sectionName))) {
      if (facts.workspaceNames.has(name)) mutableSection(facts.manifest, sectionName)[name] = workspaceRange(name)
    }
  }
}

/**
 * Repair every covered manifest after validating all dependency ranges.
 * @param root - Repository containing the manifests.
 * @param state - Classified packages and policy violations that block repair.
 * @returns Repository-relative changed paths, or no paths when policy violations block repair.
 * @throws When any third-party dependency is undeclared, before modifying any manifest.
 */
export function fixPackageDependencies(root: string, state: PackageDependencyState): string[] {
  if (state.policyViolations.length > 0) return []
  for (const facts of state.facts) {
    for (const [name, rule] of expectedPackageDependencies(facts)) preferredRange(facts, name, rule.section)
  }
  const changed: string[] = []
  for (const facts of state.facts) {
    const before = `${JSON.stringify(facts.manifest, null, 2)}\n`
    repairPackageDependencyManifest(facts)
    const after = `${JSON.stringify(facts.manifest, null, 2)}\n`
    if (after === before) continue
    writeFileSync(resolve(root, facts.manifestPath), after)
    changed.push(facts.manifestPath)
  }
  return changed.sort()
}
