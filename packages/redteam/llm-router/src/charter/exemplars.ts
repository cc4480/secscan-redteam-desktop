/**
 * The exemplar pack: versioned worked task-to-artifact pairs that accompany
 * the charter in artifact-producing prompts (spec §8). Loaded like the
 * charter asset — fail loud when missing, malformed, or unversioned —
 * because a prompt assembled without its pack is a different prompt than
 * the one the fleet was measured with.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CharterError, type CharterRole } from './loader.js'

const VERSION_MARKER = /<!--\s*exemplar-pack-version:\s*(\d+)\s*-->/

/** Roles whose default prompt assembly includes the full pack (spec §8). */
export const EXEMPLAR_PACK_ROLES: readonly CharterRole[] = ['exploiter-operator', 'exploiter-challenger']

/**
 * Candidate locations of the exemplar pack asset, in resolution order,
 * mirroring {@link charterAssetCandidates}: the vendored-payload location
 * first (`charter/` beside the bundled module), then beside the module in
 * the source tree, or one, two, or three levels up from compiled output.
 *
 * @returns the candidate asset paths
 */
export function exemplarPackCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  return [
    join(moduleDir, 'charter', 'exemplars.md'),
    join(moduleDir, 'exemplars.md'),
    join(moduleDir, '..', 'src', 'charter', 'exemplars.md'),
    join(moduleDir, '..', '..', 'src', 'charter', 'exemplars.md'),
    join(moduleDir, '..', '..', '..', 'src', 'charter', 'exemplars.md'),
  ]
}

/**
 * Resolve the bundled exemplar pack path.
 *
 * @returns the first candidate path that exists
 * @throws CharterError when no candidate exists
 */
export function defaultExemplarPackPath(): string {
  const candidates = exemplarPackCandidates()
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new CharterError(`exemplar pack asset not found; searched: ${candidates.join(', ')}`)
}

/**
 * Read the exemplar pack asset text.
 *
 * @param path - the asset path; defaults to {@link defaultExemplarPackPath}
 * @returns the asset text, trimmed
 * @throws CharterError when the asset is unreadable or empty
 */
export function loadExemplarPackText(path: string = defaultExemplarPackPath()): string {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new CharterError(
      `exemplar pack asset unreadable: ${path} (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  const text = raw.trim()
  if (text.length === 0) throw new CharterError(`exemplar pack asset is empty: ${path}`)
  return text
}

/**
 * The pack version stamped in the asset's version marker. Every prompt
 * assembly reports this version so refusal telemetry (§3) can attribute
 * outcomes to the exact pack that was in the prompt.
 *
 * @param text - the pack asset text; defaults to the bundled asset
 * @returns the pack version number
 * @throws CharterError when the asset carries no version marker
 */
export function exemplarPackVersion(text: string = loadExemplarPackText()): number {
  const match = text.match(VERSION_MARKER)
  if (match === null) {
    throw new CharterError('exemplar pack asset carries no version marker; a pack edit must bump its version')
  }
  return Number(match[1])
}

/**
 * Whether a role's default assembly includes the pack: artifact-producing
 * roles in, the rest out (context budget outranks completeness). Callers may
 * override per task for artifact-producing work in other roles.
 *
 * @param role - the charter role being assembled
 * @returns true when the pack is included by default for the role
 */
export function exemplarPackIncludedByDefault(role: CharterRole): boolean {
  return EXEMPLAR_PACK_ROLES.includes(role)
}
