/** The per-manifest publication and dsh-package policy check. */

import { join, relative } from 'node:path'
import { isForbiddenPublicationFile } from './publication-payload.ts'
import { expectedDshPackageFiles } from './dsh-package-payload.ts'
import {
  checkDshFamilyVersion,
  checkExperimentalManifest,
  isPrivateProductPackage,
  isReleaseMemberDirectory,
} from './workspace-manifest-checks.ts'
import {
  appPackageFiles,
  desktopApplicationDirectory,
  experimentalPackageDirectory,
  publicNativePackages,
  publicationSourceAllowlist,
  publishedRepositoryUrl,
  vendoredPackages,
} from './package-publication-policy.ts'
import { nativeVersion, repositoryVersion, root } from './workspace-manifest-discovery.ts'
import type { WorkspaceManifest } from './workspace-manifest-types.ts'

function sameStringList(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

/**
 * Check one workspace manifest against publication and dsh-package policy.
 * @param workspace - package directory and parsed manifest.
 * @returns path-qualified policy violations.
 */
export function checkWorkspaceManifest({ dir, manifest }: WorkspaceManifest): string[] {
  const errors = checkExperimentalManifest({ dir, manifest })
  const label = manifest.name ?? dir
  const familyVersionError = checkDshFamilyVersion(manifest, repositoryVersion)
  if (familyVersionError !== undefined) errors.push(familyVersionError)
  const isNativePackageDir = dir.startsWith('native/system/packages/')
  const isPublicNativePackage = isNativePackageDir
    && manifest.name !== undefined
    && publicNativePackages.has(manifest.name)

  if (isPublicNativePackage) {
    if (manifest.private === true) {
      errors.push(`${label}: published Landlock package must not set "private": true`)
    }
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: published Landlock package must set publishConfig.access to "public"`)
    }
    const expectedDirectory = dir
    if (manifest.repository?.type !== 'git'
      || manifest.repository.url !== publishedRepositoryUrl
      || manifest.repository.directory !== expectedDirectory) {
      errors.push(`${label}: published Landlock package repository must use ${publishedRepositoryUrl} with directory ${expectedDirectory}`)
    }
  } else if (isReleaseMemberDirectory(dir) && !isPrivateProductPackage(manifest)) {
    // Release members state that they are publishable: npm refuses a private
    // package, and the repository field is how a consumer finds the source of
    // the package it installed.
    //
    // Access is per release sequence, not per scope: the vendored framework and
    // the Landlock packages publish publicly because outside consumers install
    // them, and the dsh family published publicly with its own sequence on
    // 2026-08-13. No publish path passes `--access`; each packed manifest declares
    // it, and this gate requires every release member to be public.
    if (manifest.private === true) {
      errors.push(`${label}: release member must not set "private": true`)
    }
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: release member must set publishConfig.access to "public"`)
    }
    if (manifest.repository?.type !== 'git'
      || manifest.repository.url !== publishedRepositoryUrl
      || manifest.repository.directory !== dir) {
      errors.push(`${label}: release member repository must use ${publishedRepositoryUrl} with directory ${dir}`)
    }
  } else if (!experimentalPackageDirectory.test(dir) && manifest.private !== true) {
    errors.push(`${label}: package.json must set "private": true`)
  }

  if (manifest.name && vendoredPackages.has(manifest.name)) {
    return errors
  }

  if (manifest.name?.startsWith('@deepseek-ai/')) {
    const allowedSources = publicationSourceAllowlist[manifest.name] ?? []
    for (const file of manifest.files ?? []) {
      if (isForbiddenPublicationFile(file) && !allowedSources.includes(file)) {
        errors.push(`${label}: package.json files must not publish ${JSON.stringify(file)}`)
      }
    }
  }

  if (dir.startsWith('apps/') && dir !== desktopApplicationDirectory && manifest.name?.startsWith('@deepseek-ai/')) {
    const expectedFiles = appPackageFiles[manifest.name]
    if (expectedFiles === undefined) {
      errors.push(`${label}: app package has no publication files policy`)
    } else if (!sameStringList(manifest.files, expectedFiles)) {
      errors.push(`${label}: package.json files must be ${JSON.stringify(expectedFiles)}`)
    }
  }

  if (isNativePackageDir) {
    if (!isPublicNativePackage) {
      errors.push(`${label}: unexpected package in the public Landlock package family`)
    }
    if (manifest.version !== nativeVersion) {
      errors.push(`${label}: package.json version must match native workspace version ${nativeVersion ?? '(missing)'}`)
    }
  }

  if (dir.startsWith('packages/') && manifest.name?.startsWith('@deepseek-ai/dsh-')) {
    const peer = manifest.peerDependencies?.['@deepseek-ai/cordis']
    const dev = manifest.devDependencies?.['@deepseek-ai/cordis']

    if (!peer) errors.push(`${label}: @deepseek-ai/cordis must be a peerDependency`)
    if (!dev) errors.push(`${label}: @deepseek-ai/cordis must also be a devDependency`)
    if (peer && dev && peer !== dev) {
      errors.push(`${label}: @deepseek-ai/cordis peer (${peer}) and dev (${dev}) ranges must match`)
    }
    if (manifest.type !== 'module') {
      errors.push(`${label}: package.json must set "type": "module"`)
    }
    if (manifest.main !== 'lib/index.js') {
      errors.push(`${label}: package.json must set "main": "lib/index.js"`)
    }
    if (manifest.types !== 'lib/types/index.d.ts') {
      errors.push(`${label}: package.json must set "types": "lib/types/index.d.ts"`)
    }
    const rootExport = manifest.exports?.['.']
    const rootEntry = typeof rootExport === 'object' && rootExport !== null ? rootExport : undefined
    if (rootEntry?.types !== './lib/types/index.d.ts') {
      errors.push(`${label}: package.json exports["."].types must be "./lib/types/index.d.ts"`)
    }
    if (rootEntry?.default !== './lib/index.js') {
      errors.push(`${label}: package.json exports["."].default must be "./lib/index.js"`)
    }
    const invariantRaw = manifest.exports?.['./invariant']
    const invariantExport = typeof invariantRaw === 'object' && invariantRaw !== null ? invariantRaw : undefined
    if (invariantExport?.types !== undefined && invariantExport.types !== './lib/types/invariant.d.ts') {
      errors.push(`${label}: package.json exports["./invariant"].types must be "./lib/types/invariant.d.ts"`)
    }
    if (invariantExport?.default !== undefined && invariantExport.default !== './lib/invariant.js') {
      errors.push(`${label}: package.json exports["./invariant"].default must be "./lib/invariant.js"`)
    }
    if (invariantExport && (invariantExport.types === undefined || invariantExport.default === undefined)) {
      errors.push(`${label}: package.json exports["./invariant"] must declare both types and default targets`)
    }
    const expectedFiles = expectedDshPackageFiles(manifest)
    if (!sameStringList(manifest.files, expectedFiles)) {
      errors.push(`${label}: package.json files must be ${JSON.stringify(expectedFiles)}`)
    }
  }

  return errors.map(error => `${relative(root, join(root, dir, 'package.json'))}: ${error}`)
}
