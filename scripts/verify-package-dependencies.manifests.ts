/** Workspace manifest discovery and dependency-policy scope selection. */

import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  hasClientDeclaration,
  type PackageDependencyPolicy,
} from './package-dependency-policy.ts'
import {
  duplicates,
  normalizePath,
  RELEASE_MANIFEST_GLOB,
  WORKSPACE_MANIFEST_GLOBS,
} from './verify-package-dependencies.shared.ts'
import type {
  PackageDependencyManifest,
  PackageDependencyRole,
  WorkspacePackageManifest,
} from './verify-package-dependencies.types.ts'

/** Read package manifests used for scope discovery and workspace-name checks. */
export function readWorkspacePackageManifests(root: string): {
  all: WorkspacePackageManifest[]
  release: WorkspacePackageManifest[]
} {
  const read = (manifestPath: string): WorkspacePackageManifest => {
    const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) as PackageDependencyManifest
    if (typeof manifest.name !== 'string') throw new Error(`${manifestPath}: missing package name`)
    return {
      dir: dirname(manifestPath),
      manifestPath,
      manifest,
      name: manifest.name,
    }
  }
  const all = globSync(WORKSPACE_MANIFEST_GLOBS, { cwd: root }).map(normalizePath).sort().map(read)
  const releasePaths = new Set(globSync(RELEASE_MANIFEST_GLOB, { cwd: root }).map(normalizePath))
  return { all, release: all.filter(pkg => releasePaths.has(pkg.manifestPath)) }
}

/** Discover Client faces and configured Host packages, validating explicit overrides. */
export function discoverPackageDependencyScope(
  packages: readonly WorkspacePackageManifest[],
  policy: PackageDependencyPolicy,
): { selected: Array<WorkspacePackageManifest & { role: PackageDependencyRole }>; violations: string[] } {
  const violations: string[] = []
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]))
  const include = new Set(policy.clientFaceInclude)
  const exclude = new Set(policy.clientFaceExclude)
  const host = new Set(policy.hostPackages)

  for (const [field, values] of [
    ['clientFaceInclude', policy.clientFaceInclude],
    ['clientFaceExclude', policy.clientFaceExclude],
    ['hostPackages', policy.hostPackages],
  ] as const) {
    for (const name of duplicates(values)) violations.push(`${field} lists ${name} more than once`)
    for (const name of values) {
      if (!byName.has(name)) violations.push(`${field} names unknown release package ${name}`)
    }
  }
  for (const name of include) {
    if (exclude.has(name)) violations.push(`${name} appears in both clientFaceInclude and clientFaceExclude`)
    const pkg = byName.get(name)
    if (pkg !== undefined
      && (pkg.manifestPath.startsWith('packages/client/') || hasClientDeclaration(pkg.manifest.dsh))) {
      violations.push(`clientFaceInclude redundantly names automatically discovered package ${name}`)
    }
  }
  for (const name of exclude) {
    const pkg = byName.get(name)
    if (pkg !== undefined && pkg.manifestPath.startsWith('packages/client/')) {
      violations.push(`clientFaceExclude cannot exempt packages/client package ${name}`)
    } else if (pkg !== undefined && !hasClientDeclaration(pkg.manifest.dsh)) {
      violations.push(`clientFaceExclude names ${name}, which declares no dsh.client entry`)
    }
  }

  const selected: Array<WorkspacePackageManifest & { role: PackageDependencyRole }> = []
  for (const pkg of packages) {
    const clientDirectory = pkg.manifestPath.startsWith('packages/client/')
    const clientHost = (hasClientDeclaration(pkg.manifest.dsh) || include.has(pkg.name)) && !exclude.has(pkg.name)
    const clientOnly = clientDirectory && !clientHost
    const configuredHost = host.has(pkg.name)
    if (configuredHost && (clientHost || clientOnly)) {
      violations.push(`hostPackages redundantly names Client-faced package ${pkg.name}`)
    }
    const role = clientHost ? 'client-host' : clientOnly ? 'client-only' : configuredHost ? 'configured-host' : undefined
    if (role !== undefined) selected.push({ ...pkg, role })
  }
  return {
    selected: selected.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath)),
    violations: [...new Set(violations)].sort(),
  }
}
