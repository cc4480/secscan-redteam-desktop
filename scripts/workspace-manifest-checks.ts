/** Per-manifest experimental, release-membership, and version checks. */

import {
  isPublicExperimentalPackageDirectory,
  PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES,
} from './experimental-package-policy.ts'
import {
  experimentalPackageDirectory,
  experimentalPackageNamePrefix,
  standardReleaseMemberDirectory,
} from './package-publication-policy.ts'
import type { PackageManifest, WorkspaceManifest } from './workspace-manifest-types.ts'

/** Experimental manifest requirements, including explicit private exceptions. */
export function checkExperimentalManifest(
  { dir, manifest }: WorkspaceManifest,
  privateDirectories: readonly string[] = PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES,
): string[] {
  if (!experimentalPackageDirectory.test(dir)) return []
  const label = manifest.name ?? dir
  const errors: string[] = []
  if (manifest.name?.startsWith(experimentalPackageNamePrefix) !== true) {
    errors.push(`${label}: experimental package name must start with ${JSON.stringify(experimentalPackageNamePrefix)}`)
  }
  if (isPublicExperimentalPackageDirectory(dir, privateDirectories)) {
    if (manifest.private === true) errors.push(`${label}: public experimental package must not set "private": true`)
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: public experimental package must set publishConfig.access to "public"`)
    }
  } else {
    if (manifest.private !== true) errors.push(`${label}: experimental package must set "private": true`)
    if (manifest.publishConfig !== undefined) errors.push(`${label}: experimental package must omit publishConfig`)
  }
  return errors
}

/** Whether a directory holds a package this repository publishes as a release member. */
export function isReleaseMemberDirectory(dir: string): boolean {
  return standardReleaseMemberDirectory.test(dir) || isPublicExperimentalPackageDirectory(dir)
}

/**
 * Whether a package belongs to a private product family carried in-tree but
 * published by neither the dsh nor the vendor release sequence. The SecScan
 * red-team packages (@secscan/*) are assembled into the desktop installer, not
 * published to npm, so they are exempt from the release-member metadata rules.
 * @param manifest - the workspace manifest under inspection.
 */
export function isPrivateProductPackage(manifest: PackageManifest): boolean {
  return manifest.name?.startsWith('@secscan/') === true
}

/**
 * Require a dsh-family manifest to carry the workspace version.
 *
 * The dsh release sequence publishes packages/ and apps/ members and every
 * private dsh package on one shared version, written by `release:dsh` and
 * shared with the workspace root. This name test is that boundary: it covers
 * the family wherever the manifest lives, so apps/ members cannot drift with
 * only the release lane noticing.
 * @param manifest - the workspace package manifest.
 * @param expected - the version every dsh-family manifest must carry (the root's).
 * @returns one violation naming the manifest and the expected version, or
 * undefined when the manifest is compliant or not in the family.
 */
export function checkDshFamilyVersion(manifest: PackageManifest, expected: string | undefined): string | undefined {
  const name = manifest.name
  if (name !== '@deepseek-ai/dsh' && name?.startsWith('@deepseek-ai/dsh-') !== true) return undefined
  if (manifest.version !== expected) {
    return `${name}: package.json version must match root version ${expected ?? '(missing)'}`
  }
  return undefined
}
