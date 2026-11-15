/**
 * A release family's publishable member and the manifest reads that discover
 * one, so every family shares one discovery pass.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The workspace root manifest, which is never a release member. */
const WORKSPACE_ROOT_PACKAGE = '@deepseek-ai/dsh-root'

/** One publishable package of a release family. */
export interface ReleaseMember {
  readonly directory: string
  readonly name: string
  readonly version: string
  readonly manifest: Readonly<Record<string, unknown>>
}

/** The executable a family's installed artifacts are driven through. */
export interface InstalledEntry {
  readonly packageName: string
  readonly binPath: string
}

/**
 * Read and parse a JSON file.
 * @param path - absolute file path.
 * @returns The parsed object.
 */
function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Read a required string field.
 * @param manifest - parsed manifest.
 * @param field - field name.
 * @param context - manifest path for the error message.
 * @returns The field value.
 */
function requireString(manifest: Record<string, unknown>, field: string, context: string): string {
  const value = manifest[field]
  if (typeof value !== 'string' || value === '') throw new Error(`${context} must declare a string ${field}`)
  return value
}

/**
 * Discover the members selected by one family's manifest patterns.
 * @param id - the family's `--family` identifier, used in errors.
 * @param patterns - repository-relative glob patterns selecting the manifests.
 * @param root - repository root.
 * @returns Publishable members sorted by directory, with names validated and deduplicated.
 */
export function discoverMembers(
  id: string,
  patterns: readonly string[],
  root: string,
): ReleaseMember[] {
  const manifestPaths = globSync([...patterns], { cwd: root }).sort()
  if (manifestPaths.length === 0) throw new Error(`release family ${id} matched no manifests`)

  const members: ReleaseMember[] = []
  const seen = new Set<string>()
  for (const manifestPath of manifestPaths) {
    const normalized = manifestPath.replaceAll('\\', '/')
    const manifest = readManifest(resolve(root, manifestPath))
    if (manifest.private === true) continue
    const name = requireString(manifest, 'name', normalized)
    const version = requireString(manifest, 'version', normalized)
    if (name === WORKSPACE_ROOT_PACKAGE) throw new Error(`${normalized} selected the workspace root`)
    if (!name.startsWith('@deepseek-ai/')) throw new Error(`${normalized} must name an @deepseek-ai package`)
    if (seen.has(name)) throw new Error(`${name} appears twice in release family ${id}`)
    seen.add(name)
    members.push({
      directory: normalized.slice(0, normalized.length - '/package.json'.length),
      name,
      version,
      manifest,
    })
  }
  return members
}
