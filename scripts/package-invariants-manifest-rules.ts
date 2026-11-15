/** Manifest, dependency, and omission-reason rules for package invariant companions. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { usesFlattenedPackageDependencies } from './package-dependency-policy.ts'
import { addViolation } from './package-invariants-model.ts'
import type { PackageInvariantOwner, PackageInvariantViolation, PackageManifest } from './package-invariants-model.ts'

/** Package README sentence that records why an invariant companion is omitted. */
const OMITTED_COMPANION_REASON = /No (?:(?:runtime )?invariant )?companion is published(?: because|[.:;—])\s+\S/i

/**
 * Check the manifest export, file list, and dependency wiring for one package.
 * @param owner - Package being checked.
 * @param manifest - Parsed manifest of that package.
 * @param hasCompanion - Whether the package owns src/invariant.ts.
 * @param violations - Violations collected so far.
 */
export function checkManifest(
  owner: PackageInvariantOwner,
  manifest: PackageManifest,
  hasCompanion: boolean,
  violations: PackageInvariantViolation[],
): void {
  const invariantExport = manifest.exports?.['./invariant']
  if (!hasCompanion) {
    if (invariantExport !== undefined) {
      addViolation(
        violations,
        owner.manifestPath,
        'exports["./invariant"] must be omitted when src/invariant.ts is absent',
      )
    }
    if (manifest.files?.includes('lib/invariant.js')) {
      addViolation(
        violations,
        owner.manifestPath,
        'files must omit lib/invariant.js when src/invariant.ts is absent',
      )
    }
    return
  }
  if (typeof invariantExport !== 'object'
    || invariantExport === null
    || invariantExport.types !== './lib/types/invariant.d.ts'
    || invariantExport.default !== './lib/invariant.js') {
    addViolation(
      violations,
      owner.manifestPath,
      'exports["./invariant"] must target ./lib/types/invariant.d.ts and ./lib/invariant.js',
    )
  }
  if (!manifest.files?.includes('lib/invariant.js')) {
    addViolation(violations, owner.manifestPath, 'files must publish lib/invariant.js')
  }
  if (owner.packageName === '@deepseek-ai/dsh-invariants') return
  const developmentOnlyInvariant = usesFlattenedPackageDependencies(
    owner.manifestPath,
    owner.packageName,
    manifest.dsh,
  )
  const expectedRange = 'workspace:*'
  const peerRange = manifest.peerDependencies?.['@deepseek-ai/dsh-invariants']
  if (developmentOnlyInvariant ? peerRange !== undefined : peerRange !== expectedRange) {
    addViolation(violations, owner.manifestPath, developmentOnlyInvariant
      ? '@deepseek-ai/dsh-invariants must not be a peerDependency under this package dependency policy'
      : '@deepseek-ai/dsh-invariants must be a workspace:* peerDependency')
  }
  if (manifest.devDependencies?.['@deepseek-ai/dsh-invariants'] !== expectedRange) {
    addViolation(
      violations,
      owner.manifestPath,
      `@deepseek-ai/dsh-invariants must be a ${expectedRange} devDependency`,
    )
  }
}

/**
 * Require a README sentence that explains an intentionally omitted companion.
 * @param owner - Package being checked.
 * @param root - Repository root.
 * @param violations - Violations collected so far.
 */
export function checkOmissionReason(
  owner: PackageInvariantOwner,
  root: string,
  violations: PackageInvariantViolation[],
): void {
  const readmePath = `${owner.dir}/README.md`
  const absolutePath = resolve(root, readmePath)
  if (!existsSync(absolutePath) || !OMITTED_COMPANION_REASON.test(readFileSync(absolutePath, 'utf8'))) {
    addViolation(
      violations,
      readmePath,
      'omitted companion requires a README "No ... companion is published" reason sentence',
    )
  }
}
