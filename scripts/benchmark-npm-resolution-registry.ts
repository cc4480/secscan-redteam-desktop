/** Registry metadata assembled from installed packages and workspace manifests. */

import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WORKSPACE_MANIFEST_GLOBS = [
  'apps/*/package.json',
  'packages/*/*/package.json',
  'vendor/*/package.json',
  'native/system/package.json',
  'native/system/packages/*/package.json',
]
const INSTALLED_MANIFEST_GLOBS = [
  'node_modules/.pnpm/*/node_modules/*/package.json',
  'node_modules/.pnpm/*/node_modules/@*/*/package.json',
]
const PUBLISHED_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'engines',
  'os',
  'cpu',
  'bin',
] as const

interface PackageManifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly dependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly peerDependenciesMeta?: Record<string, unknown>
  readonly engines?: unknown
  readonly os?: unknown
  readonly cpu?: unknown
  readonly bin?: unknown
}

interface RegistryVersion extends PackageManifest {
  readonly name: string
  readonly version: string
}

/** Package versions served by the local benchmark registry. */
export type RegistryIndex = ReadonlyMap<string, ReadonlyMap<string, RegistryVersion>>

function workspaceManifestPath(path: string): boolean {
  return /^(?:apps\/[^/]+|packages\/[^/]+\/[^/]+|vendor\/[^/]+|native\/system(?:\/packages\/[^/]+)?)\/package\.json$/.test(path)
}

function workspaceManifestPaths(root: string, ref: string | undefined): string[] {
  if (ref === undefined) return globSync(WORKSPACE_MANIFEST_GLOBS, { cwd: root }).sort()
  return execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'apps', 'packages', 'vendor', 'native'], {
    cwd: root,
    encoding: 'utf8',
  }).split('\n').filter(workspaceManifestPath).sort()
}

function readGitFiles(root: string, ref: string, paths: readonly string[]): ReadonlyMap<string, string> {
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: paths.map(path => `${ref}:${path}\n`).join(''),
    maxBuffer: 64 * 1024 * 1024,
  })
  const contents = new Map<string, string>()
  let offset = 0
  for (const path of paths) {
    const headerEnd = output.indexOf(0x0a, offset)
    if (headerEnd < 0) throw new Error(`git cat-file returned no header for ${ref}:${path}`)
    const header = output.subarray(offset, headerEnd).toString('utf8')
    if (header.endsWith(' missing')) throw new Error(`git ref ${ref} has no ${path}`)
    const size = Number.parseInt(header.split(' ')[2] ?? '', 10)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`git cat-file returned an invalid size for ${ref}:${path}`)
    }
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    if (output[contentEnd] !== 0x0a) throw new Error(`git cat-file truncated ${ref}:${path}`)
    contents.set(path, output.subarray(contentStart, contentEnd).toString('utf8'))
    offset = contentEnd + 1
  }
  return contents
}

/**
 * Convert a workspace protocol range to the range published by pnpm pack.
 * @param range - Dependency range from a workspace manifest.
 * @param targetVersion - Current version of the referenced workspace package.
 * @returns The registry-facing semver range.
 */
export function publishWorkspaceRange(range: string, targetVersion: string): string {
  if (range === 'workspace:*') return targetVersion
  if (range === 'workspace:^') return `^${targetVersion}`
  if (range === 'workspace:~') return `~${targetVersion}`
  if (range.startsWith('workspace:')) return range.slice('workspace:'.length)
  return range
}

function copyPublishedManifest(
  source: PackageManifest,
  workspaceVersions: ReadonlyMap<string, string>,
): RegistryVersion | undefined {
  if (typeof source.name !== 'string' || typeof source.version !== 'string') return undefined
  const output: Record<string, unknown> = { name: source.name, version: source.version }
  for (const field of PUBLISHED_FIELDS) {
    const value = source[field]
    if (value === undefined) continue
    if (field === 'dependencies' || field === 'optionalDependencies' || field === 'peerDependencies') {
      output[field] = Object.fromEntries(Object.entries(value as Record<string, string>).map(([name, range]) => {
        const targetVersion = workspaceVersions.get(name)
        return [name, targetVersion === undefined ? range : publishWorkspaceRange(range, targetVersion)]
      }))
    } else {
      output[field] = structuredClone(value)
    }
  }
  return output as unknown as RegistryVersion
}

function addManifest(index: Map<string, Map<string, RegistryVersion>>, manifest: RegistryVersion): void {
  const versions = index.get(manifest.name) ?? new Map<string, RegistryVersion>()
  versions.set(manifest.version, manifest)
  index.set(manifest.name, versions)
}

/**
 * Build registry metadata from installed external packages and workspace manifests.
 * @param root - Repository root containing the pnpm virtual store.
 * @param ref - Optional Git ref used instead of working-tree workspace manifests.
 * @returns Package metadata served by the benchmark registry.
 */
export function buildRegistryIndex(root: string, ref?: string): RegistryIndex {
  const index = new Map<string, Map<string, RegistryVersion>>()
  for (const path of globSync(INSTALLED_MANIFEST_GLOBS, { cwd: root }).sort()) {
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as PackageManifest
    const copied = copyPublishedManifest(manifest, new Map())
    if (copied !== undefined) addManifest(index, copied)
  }

  const paths = workspaceManifestPaths(root, ref)
  const refContents = ref === undefined ? undefined : readGitFiles(root, ref, paths)
  const workspace = paths.map(path =>
    JSON.parse(refContents?.get(path) ?? readFileSync(resolve(root, path), 'utf8')) as PackageManifest)
  const workspaceVersions = new Map(workspace.flatMap(manifest =>
    typeof manifest.name === 'string' && typeof manifest.version === 'string'
      ? [[manifest.name, manifest.version] as const]
      : []))
  for (const manifest of workspace) {
    const copied = copyPublishedManifest(manifest, workspaceVersions)
    if (copied !== undefined) addManifest(index, copied)
  }
  return index
}

/**
 * Select the highest semver-shaped version label a local registry package offers.
 * @param versions - Versions registered for one package name.
 * @returns The latest registered version.
 */
export function latestVersion(versions: ReadonlyMap<string, RegistryVersion>): string {
  const sorted = [...versions.keys()].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
  const latest = sorted.at(-1)
  if (latest === undefined) throw new Error('local registry package has no versions')
  return latest
}
