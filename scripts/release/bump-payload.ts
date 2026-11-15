/**
 * What a member's published payload contains: npm's always-published set, the
 * manifest's `files`, and the build inputs behind untracked build output.
 */

import { matchesGlob } from 'node:path'
import type { ReleaseMember } from './families.ts'

/** Files npm publishes whether or not `files` lists them. */
const ALWAYS_PUBLISHED = ['package.json', 'README*', 'LICENSE*', 'LICENCE*'] as const

/**
 * Inputs that decide what a built payload contains. A package whose `files`
 * selects `lib/` publishes build output that git does not track, so a change to
 * the sources or the build configuration changes the tarball while no published
 * path appears in the diff.
 */
const BUILD_INPUTS = ['src/**', 'tsconfig*.json', 'tsdown.config.*', 'build.config.*'] as const

/**
 * Whether a repository-relative path reaches the member's published payload.
 * @param member - the member the path belongs to.
 * @param path - repository-relative path.
 * @returns True when `files`, npm's always-published set, or a build input selects it.
 */
export function reachesPayload(member: ReleaseMember, path: string): boolean {
  const relative = path.slice(member.directory.length + 1)
  const files = member.manifest.files
  const selected = Array.isArray(files) ? files.filter((entry): entry is string => typeof entry === 'string') : []
  const built = selected.some(pattern => pattern.startsWith('lib'))
  const patterns = [...ALWAYS_PUBLISHED, ...selected, ...built ? BUILD_INPUTS : []]
  return patterns.some(pattern =>
    matchesGlob(relative, pattern) || matchesGlob(relative, `${pattern}/**`) || relative === pattern)
}
