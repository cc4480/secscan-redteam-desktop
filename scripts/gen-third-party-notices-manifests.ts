/**
 * Reads the workspace `package.json` set and tiers every external dependency it
 * declares into runtime or development.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { ALL_KINDS, RUNTIME_KINDS, root, type Manifest } from './gen-third-party-notices-shared.ts'
import { installedMetadata } from './gen-third-party-notices-store.ts'

/**
 * Workspace areas that never reach a user: repository tooling and gates (the
 * root manifest), test infrastructure, the documentation site, and the native
 * launcher's build workspace. A runtime
 * declaration by anything outside these areas is a disclosure-relevant
 * runtime dependency because any plugin package can be mounted from a user's
 * `cordis.yml`.
 */
const DEV_ONLY_AREAS = [
  'package.json',
  'packages/test-support/',
  'packages/test-support/client-runtime/',
  'website/',
  'native/',
] as const

/** First-party public native packages: reachable at runtime but not third-party. */
const FIRST_PARTY = new Set([
  '@deepseek-ai/node-addon-system',
  '@deepseek-ai/node-addon-system-darwin-arm64',
  '@deepseek-ai/node-addon-system-darwin-x64',
  '@deepseek-ai/node-addon-system-linux-arm64',
  '@deepseek-ai/node-addon-system-linux-x64',
])

/** One disclosed external npm dependency. */
export interface ExternalDep {
  name: string
  license: string
  repo: string
  /** True when some shipped workspace consumer reaches it through runtime dependency edges. */
  runtime: boolean
}

/** Read and parse a workspace-relative `package.json`. */
export function readManifest(rel: string): Manifest {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as Manifest
}

/**
 * Manifest globs, derived from the workspace declarations rather than listed
 * here, so a new member area (`tools/*`) is read the day it is declared.
 * @returns one glob per manifest-bearing location, repository-relative.
 */
export function manifestPatterns(rootMembers: readonly string[]): string[] {
  return [
    'package.json',
    ...rootMembers.map(member => `${member}/package.json`),
  ]
}

/** The `packages:` member globs declared by one pnpm workspace file. */
function workspaceMembers(rel: string): string[] {
  const declared = (yaml.load(readFileSync(resolve(root, rel), 'utf8')) as { packages?: unknown }).packages
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`gen-third-party-notices: ${rel} declares no workspace members; the manifest set cannot be derived.`)
  }
  return declared.map(member => String(member))
}

/**
 * Every workspace manifest, keyed by repository-relative path, plus the set of
 * workspace package names. Paths are normalized to `/` at ingestion: Node's
 * `fs.globSync` returns OS-native separators, and the area matching in
 * `tierExternalDeps` compares `/`-suffixed prefixes, so Windows backslashes
 * would silently push dev-area manifests into the runtime tier.
 * @returns every workspace manifest by path, with the full set of workspace package names.
 */
export function loadWorkspaceManifests(): { manifests: Map<string, Manifest>; names: Set<string> } {
  const patterns = manifestPatterns(workspaceMembers('pnpm-workspace.yaml'))
  const manifests = new Map<string, Manifest>()
  const names = new Set<string>()
  for (const pattern of patterns) {
    for (const path of globSync(pattern, { cwd: root })) {
      const normalized = path.replaceAll('\\', '/')
      const manifest = readManifest(normalized)
      manifests.set(normalized, manifest)
      if (manifest.name !== undefined) names.add(manifest.name)
    }
  }
  if (manifests.size < 100) throw new Error(`gen-third-party-notices: only ${manifests.size} workspace manifests found; the glob set is stale.`)
  return { manifests, names }
}

/**
 * Direct npm dependencies distributed through installed runtime libraries or
 * browser builds. Tooling declarations alone do not imply distribution.
 */
export function collectNpmDeps(manifests: Map<string, Manifest>, names: Set<string>, browser: ReadonlySet<string>): ExternalDep[] {
  return [...tierExternalDeps(manifests, names, browser)]
    .filter(([name]) => !FIRST_PARTY.has(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, runtime]) => ({ name, ...installedMetadata(name, manifests), runtime }))
}

/**
 * Tier every external dependency the workspace declares.
 * @param manifests - workspace manifests keyed by repository-relative path.
 * @param names - every workspace package name, which never counts as external.
 * @param browser - Direct third-party packages resolved by the browser builds.
 * @returns each external package mapped to whether it is a runtime dependency.
 */
export function tierExternalDeps(
  manifests: Map<string, Manifest>, names: Set<string>, browser: ReadonlySet<string> = new Set(),
): Map<string, boolean> {
  const tiers = new Map<string, boolean>()
  // `tsx` is runtime by fiat: the root source-run scripts execute through its ESM hook.
  tiers.set('tsx', true)
  for (const [path, manifest] of manifests) {
    const devOnly = DEV_ONLY_AREAS.some(area => (area.endsWith('/') ? path.startsWith(area) : path === area))
    for (const kind of ALL_KINDS) {
      for (const [dep, range] of Object.entries(manifest[kind] ?? {})) {
        if (names.has(dep) || range.startsWith('workspace:')) continue
        const runtime = browser.has(dep) || !devOnly && (RUNTIME_KINDS as readonly string[]).includes(kind)
        tiers.set(dep, (tiers.get(dep) ?? false) || runtime)
      }
    }
  }
  for (const name of browser) {
    if (!names.has(name) && !tiers.has(name)) throw new Error(`gen-third-party-notices: browser package ${name} has no workspace dependency declaration`)
  }
  return tiers
}
