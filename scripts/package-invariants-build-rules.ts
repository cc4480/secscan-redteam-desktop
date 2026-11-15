/** TypeScript project-reference and build-override rules for package invariant companions. */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { addViolation } from './package-invariants-model.ts'
import type { PackageInvariantOwner, PackageInvariantViolation } from './package-invariants-model.ts'

/**
 * Check that the package's tsconfig references and build override match its companion.
 * @param owner - Package being checked.
 * @param root - Repository root.
 * @param hasCompanion - Whether the package owns src/invariant.ts.
 * @param violations - Violations collected so far.
 */
export function checkBuild(
  owner: PackageInvariantOwner,
  root: string,
  hasCompanion: boolean,
  violations: PackageInvariantViolation[],
): void {
  const tsconfigPath = `${owner.dir}/tsconfig.json`
  if (hasCompanion
    && owner.packageName !== '@deepseek-ai/dsh-invariants'
    && !projectReferencesInvariants(root, owner.dir, tsconfigPath)) {
    addViolation(
      violations,
      tsconfigPath,
      'TypeScript project references must include ../../runtime-diagnostics/invariants',
    )
  } else if (!hasCompanion && projectReferencesInvariants(root, owner.dir, tsconfigPath)) {
    addViolation(
      violations,
      tsconfigPath,
      'TypeScript project references must omit ../../runtime-diagnostics/invariants when src/invariant.ts is absent',
    )
  }

  const configPath = `${owner.dir}/tsdown.config.ts`
  if (!existsSync(resolve(root, configPath))) return
  const source = readFileSync(resolve(root, configPath), 'utf8')
  const bundlesCompanion = source.includes('lib/types/invariant.js')
  if (hasCompanion && !bundlesCompanion) {
    addViolation(violations, configPath, 'package build override must bundle lib/types/invariant.js')
  } else if (!hasCompanion && bundlesCompanion) {
    addViolation(
      violations,
      configPath,
      'package build override must omit lib/types/invariant.js when src/invariant.ts is absent',
    )
  }
}

/**
 * Walk a package's tsconfig reference graph looking for the invariants project.
 * @param root - Repository root.
 * @param ownerDir - Repo-relative package directory.
 * @param entryPath - Repo-relative tsconfig to start from.
 * @returns whether the graph reaches the invariants project.
 */
export function projectReferencesInvariants(root: string, ownerDir: string, entryPath: string): boolean {
  const ownerRoot = resolve(root, ownerDir)
  const target = resolve(root, 'packages/runtime-diagnostics/invariants')
  const pending = [resolve(root, entryPath)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const configPath = pending.pop()
    if (configPath === undefined) break
    if (visited.has(configPath)) continue
    visited.add(configPath)
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      references?: Array<{ path?: string }>
    }
    for (const reference of config.references ?? []) {
      if (reference.path === undefined) continue
      const referenced = resolve(dirname(configPath), reference.path)
      if (referenced === target) return true
      if (!referenced.startsWith(`${ownerRoot}${sep}`)) continue
      const childConfig = referenced.endsWith('.json') ? referenced : resolve(referenced, 'tsconfig.json')
      if (existsSync(childConfig)) pending.push(childConfig)
    }
  }
  return false
}
