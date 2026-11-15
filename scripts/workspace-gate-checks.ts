/** Repository-wide gate checks: versions, dependency ranges, hierarchy, isolation. */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { OPTIONAL_BUNDLES } from '../packages/boot/app-boot/src/profile.ts'
import {
  experimentalPackageDirectory,
  standardReleaseMemberDirectory,
} from './package-publication-policy.ts'
import { localArtifactDirs, repositoryVersion, root } from './workspace-manifest-discovery.ts'
import type { WorkspaceManifest } from './workspace-manifest-types.ts'

/** The root manifest version must be a semver release with an optional prerelease segment. */
export function checkRepositoryVersion(): string[] {
  // The root carries the dsh release family's version, so a prerelease such as
  // 0.0.1-rc.1 is a valid state between `release:dsh` and its publication.
  if (repositoryVersion && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(repositoryVersion)) return []
  return ['package.json: version must be X.Y.Z with an optional prerelease segment']
}

/** Dependency sections whose ranges reach a published tarball or a local install. */
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
/** Dependency sections present in an installed runtime. */
const runtimeDependencySections = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const

/**
 * Prevent an official runtime from requiring an experimental package. The dsh installation's `dependencies`
 * may hold the bundles the launcher's `OPTIONAL_BUNDLES` names: shipped switched off, they are not a requirement
 * ([rationale](../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md)).
 * @param manifests - release, private experimental, and deployment-root manifests.
 * @param optionalBundles - the bundles the installation ships switched off; the launcher's list by default.
 * @returns One error for each forbidden runtime dependency.
 */
export function checkExperimentalDependencyIsolation(
  manifests: readonly WorkspaceManifest[], optionalBundles: readonly string[] = OPTIONAL_BUNDLES,
): string[] {
  const experimentalNames = new Set(manifests
    .filter(entry => experimentalPackageDirectory.test(entry.dir))
    .map(entry => entry.manifest.name)
    .filter(name => name !== undefined))
  const errors: string[] = []
  for (const { dir, manifest } of manifests) {
    if (!standardReleaseMemberDirectory.test(dir) && dir !== 'python/sdk-runtime') continue
    const offered = manifest.name === '@deepseek-ai/dsh' ? new Set(optionalBundles) : new Set<string>()
    for (const section of runtimeDependencySections) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (!experimentalNames.has(name)) continue
        if (section === 'dependencies' && offered.has(name)) continue
        errors.push(`${manifest.name ?? dir}: ${section}.${name} must not reference an experimental package`)
      }
    }
  }
  return errors
}

/**
 * Require exact DSH ranges, tilde vendor/native ranges, and the workspace protocol elsewhere.
 *
 * A hand-written range says nothing about the version the workspace actually
 * carries, and `pnpm pack` leaves it alone: `^0.0.1` published from version
 * `0.0.2` names a version that does not exist. The protocol makes pack
 * substitute the member's real version. Dependency targets determine the range,
 * regardless of the consuming manifest's name or directory.
 * @param manifests - every workspace manifest.
 * @returns One error per workspace reference with a disallowed range.
 */
export function checkWorkspaceProtocol(manifests: readonly WorkspaceManifest[]): string[] {
  const members = new Set(manifests.map(entry => entry.manifest.name).filter(name => name !== undefined))
  const vendors = new Set(manifests.filter(entry => entry.dir.startsWith('vendor/')
    || entry.dir === 'native/system' || entry.dir.startsWith('native/system/packages/')).map(entry => entry.manifest.name))
  const errors: string[] = []
  for (const { dir, manifest } of manifests) {
    for (const section of dependencySections) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (!members.has(name)) continue
        const expected = name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
          ? 'workspace:*'
          : vendors.has(name) ? 'workspace:~' : undefined
        if (expected !== undefined ? range === expected : range.startsWith('workspace:')) continue
        errors.push(`${manifest.name ?? dir}: ${section}.${name} must use ${expected ?? 'the workspace: protocol'}, got ${range}`)
      }
    }
  }
  return errors
}

/**
 * Enforce `packages/<group>/<pkg>`: groups are open-named containers without a
 * package.json, and packages may be neither flat nor more deeply nested.
 */
export function checkHierarchyShape(): string[] {
  const errors: string[] = []
  const packagesRoot = join(root, 'packages')
  for (const group of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupRel = join('packages', group.name)
    if (existsSync(join(packagesRoot, group.name, 'package.json'))) {
      errors.push(`${groupRel}: a group dir must not contain a package.json — packages live at packages/<group>/<pkg>, not directly under packages/`)
      continue
    }
    for (const pkg of readdirSync(join(packagesRoot, group.name), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      if (localArtifactDirs.has(pkg.name)) continue
      const pkgRel = join(groupRel, pkg.name)
      if (!existsSync(join(packagesRoot, group.name, pkg.name, 'package.json'))) {
        errors.push(`${pkgRel}: expected a package here (no package.json found) — the hierarchy is exactly packages/<group>/<pkg>, no deeper nesting`)
      }
    }
  }
  return errors
}
