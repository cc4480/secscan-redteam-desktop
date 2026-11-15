/** Manifest and policy violation reporting for the dependency gate. */

import {
  declaredSections,
  describeSections,
  section,
} from './verify-package-dependencies.sections.ts'
import { workspaceRange } from './verify-package-dependencies.shared.ts'
import { expectedPackageDependencies } from './verify-package-dependencies.expected.ts'
import type { PackageDependencyState } from './verify-package-dependencies.types.ts'

/** Return all manifest and policy violations in stable order. */
export function collectPackageDependencyViolations(state: PackageDependencyState): string[] {
  const violations = [...state.policyViolations]
  if (violations.length > 0) return [...new Set(violations)].sort()
  for (const facts of state.facts) {
    for (const [name, rule] of expectedPackageDependencies(facts)) {
      const actual = declaredSections(facts.manifest, name)
      const expectedRange = workspaceRange(name)
      if (rule.section === 'peer-dev') {
        if (actual.length === 2
          && actual.includes('peerDependencies')
          && actual.includes('devDependencies')
          && section(facts.manifest, 'peerDependencies')[name] === expectedRange
          && section(facts.manifest, 'devDependencies')[name] === expectedRange
          && facts.manifest.peerDependenciesMeta?.[name] === undefined) continue
        violations.push(
          `${facts.manifestPath}: ${name} must be matching peerDependencies + devDependencies at ${expectedRange}; found ${describeSections(actual)}`,
        )
        continue
      }
      const expectedSection = rule.section
      const range = section(facts.manifest, expectedSection)[name]
      if (actual.length === 1
        && actual[0] === expectedSection
        && (!facts.workspaceNames.has(name) || range === expectedRange)) continue
      violations.push(
        `${facts.manifestPath}: ${name} (${rule.origins.join(', ')}) must be ${expectedSection}-only`
        + (facts.workspaceNames.has(name) ? ` at ${expectedRange}` : '')
        + `; found ${describeSections(actual)}`,
      )
    }
    for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      for (const [name, range] of Object.entries(section(facts.manifest, sectionName))) {
        const expectedRange = workspaceRange(name)
        if (!facts.workspaceNames.has(name) || range === expectedRange) continue
        violations.push(`${facts.manifestPath}: ${sectionName}.${name} must use ${expectedRange}, found ${range}`)
      }
    }
    for (const name of Object.keys(facts.manifest.peerDependenciesMeta ?? {})) {
      if (facts.manifest.peerDependencies?.[name] === undefined) {
        violations.push(`${facts.manifestPath}: peerDependenciesMeta.${name} has no matching peerDependencies entry`)
      }
    }
  }
  return [...new Set(violations)].sort()
}
