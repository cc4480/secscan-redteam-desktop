/** Workspace member discovery: the root manifest and every declared member. */

import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { PackageManifest, WorkspaceManifest } from './workspace-manifest-types.ts'

/** Repository root shared by every workspace constraint module. */
export const root = resolve(import.meta.dirname, '..')
// Publication rules cover these package trees; dependency rules read all pnpm members.
const workspaceGlobs = [
  { dir: 'vendor', depth: 1 },
  { dir: 'packages', depth: 2 },
  { dir: 'native', depth: 1 },
  { dir: 'native/system/packages', depth: 1 },
  { dir: 'apps', depth: 1 },
] as const
/** Install-time artifact directories that never hold a workspace member. */
export const localArtifactDirs = new Set(['node_modules'])

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

const rootManifest = readJson(join(root, 'package.json'))
/** The dsh release family's version, carried by the root manifest. */
export const repositoryVersion = rootManifest.version
/** The native workspace version every Landlock package must carry. */
export const nativeVersion = readJson(join(root, 'native/system/package.json')).version

/** Repo-relative dirs holding a package.json, walked to the configured depth. */
function packageDirs(base: string, depth: number): string[] {
  if (depth === 1) {
    return readdirSync(join(root, base), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => !localArtifactDirs.has(entry.name))
      .filter(entry => existsSync(join(root, base, entry.name, 'package.json')))
      .map(entry => `${base}/${entry.name}`)
  }
  return readdirSync(join(root, base), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => !localArtifactDirs.has(entry.name))
    .flatMap(group => packageDirs(`${base}/${group.name}`, depth - 1))
}

/**
 * Read the root manifest and every package.json the publication globs cover.
 * @returns the root manifest first, then each covered member.
 */
export function workspaceManifests(): WorkspaceManifest[] {
  const manifests: WorkspaceManifest[] = [
    { dir: '.', manifest: rootManifest },
  ]

  for (const { dir: base, depth } of workspaceGlobs) {
    for (const dir of packageDirs(base, depth)) {
      manifests.push({ dir, manifest: readJson(join(root, dir, 'package.json')) })
    }
  }

  return manifests
}

/**
 * Read the root manifest and every member declared by pnpm-workspace.yaml.
 * @param repositoryRoot - repository or fixture root containing the workspace declaration.
 * @returns Manifests with normalized repository-relative directories.
 * @throws When the workspace declaration is invalid or matches no member manifests.
 */
export function readWorkspaceManifests(repositoryRoot: string): WorkspaceManifest[] {
  const config = loadYaml(readFileSync(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'))
  if (typeof config !== 'object' || config === null || !('packages' in config)
    || !Array.isArray(config.packages) || config.packages.length === 0
    || !config.packages.every((member: unknown): member is string => typeof member === 'string' && member.length > 0)) {
    throw new Error('pnpm-workspace.yaml: packages must be a non-empty list of workspace patterns')
  }
  const patterns = config.packages.filter(member => !member.startsWith('!')).map(member => `${member}/package.json`)
  const exclude = config.packages.filter(member => member.startsWith('!')).map(member => `${member.slice(1)}/package.json`)
  const paths = globSync(patterns, {
    cwd: repositoryRoot,
    exclude: ['**/node_modules/**', '**/.git/**', ...exclude],
  }).map(path => path.replaceAll('\\', '/'))
  if (paths.length === 0) throw new Error('pnpm-workspace.yaml: packages matched no workspace manifests')
  return [...new Set(['package.json', ...paths])].sort().map(path => ({
    dir: dirname(path).replaceAll('\\', '/'),
    manifest: readJson(join(repositoryRoot, path)),
  }))
}
