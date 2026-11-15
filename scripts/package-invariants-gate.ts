/** Package-invariant gate: rule orchestration and CLI formatting. */

import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { checkBuild } from './package-invariants-build-rules.ts'
import { packageInvariantPackages } from './package-invariants-discovery.ts'
import { checkManifest, checkOmissionReason } from './package-invariants-manifest-rules.ts'
import { readManifest } from './package-invariants-model.ts'
import type { PackageInvariantViolation } from './package-invariants-model.ts'
import { checkSource } from './package-invariants-source-rules.ts'

/** Return all violations of the package-invariant companion rules. */
export function collectPackageInvariantViolations(root: string): PackageInvariantViolation[] {
  const violations: PackageInvariantViolation[] = []
  for (const owner of packageInvariantPackages(root)) {
    const manifest = readManifest(resolve(root, owner.manifestPath))
    const hasCompanion = existsSync(resolve(root, owner.sourcePath))
    checkManifest(owner, manifest, hasCompanion, violations)
    checkBuild(owner, root, hasCompanion, violations)
    if (hasCompanion) {
      checkSource(owner, root, violations)
    } else {
      checkOmissionReason(owner, root, violations)
    }
  }
  return violations
}

/** Format violations for the command-line gate. */
export function formatPackageInvariantViolation(
  root: string,
  violation: PackageInvariantViolation,
): string {
  const path = resolve(root, violation.path)
  return `${relative(root, path)}: ${violation.message}`
}
