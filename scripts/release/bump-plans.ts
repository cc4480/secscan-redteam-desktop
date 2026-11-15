/**
 * The rewrite a bump plans for one family: which manifests change, from what
 * version to what, and which tag the new version publishes from.
 */

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReleaseFamily, ReleaseMember } from './families.ts'
import { compareVersions, nextSharedVersion, nextVendorVersion } from './bump-versions.ts'
import { capture } from './process.ts'

/** The workspace root manifest, which carries the dsh family's version. */
const ROOT_MANIFEST = 'package.json'

/** One manifest the bump rewrites, and the tag its new version will carry. */
export interface PlannedVersion {
  readonly manifestPath: string
  readonly label: string
  readonly from: string
  readonly to: string
  /** The tag this version publishes from, or undefined for a non-published manifest. */
  readonly tag: string | undefined
}

/** One private dsh workspace whose version follows the publishable family. */
interface PrivateDshVersion {
  /** Repository-relative manifest path. */
  readonly manifestPath: string
  /** Package directory used in bump output. */
  readonly label: string
  /** Current manifest version. */
  readonly version: string
}

/**
 * The newest version a member tagged.
 * @param family - the member's family.
 * @param member - the member.
 * @returns The version, or undefined when the member has no release tag.
 */
function lastTaggedVersion(family: ReleaseFamily, member: ReleaseMember): string | undefined {
  const prefix = family.tagPrefixFor(member)
  const versions = capture('git', ['tag', '--list', `${prefix}*`])
    .split('\n').filter(line => line !== '').map(tag => tag.slice(prefix.length))
  if (versions.length === 0) return undefined
  return versions.reduce((newest, candidate) => compareVersions(candidate, newest) > 0 ? candidate : newest)
}

/**
 * Write a version into a manifest, preserving formatting and key order.
 * @param root - repository root.
 * @param manifestPath - repository-relative manifest path.
 * @param from - the version the manifest currently carries.
 * @param to - the target version.
 */
export function writeVersion(root: string, manifestPath: string, from: string, to: string): void {
  const path = join(root, manifestPath)
  const text = readFileSync(path, 'utf8')
  const line = `"version": "${from}"`
  if (!text.includes(line)) throw new Error(`${manifestPath}: cannot locate ${line}`)
  writeFileSync(path, text.replace(line, `"version": "${to}"`))
}

/**
 * Read the workspace root version.
 * @param root - repository root.
 * @returns The root manifest version.
 */
function rootVersion(root: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(root, ROOT_MANIFEST), 'utf8'))
  const version = (manifest as Record<string, unknown>).version
  if (typeof version !== 'string') throw new Error('package.json must declare a string version')
  return version
}

/**
 * Discover private package and application manifests that share the dsh version
 * without joining its publish set.
 * @param root - repository root.
 * @returns Private workspace manifests sorted by path.
 */
function privateDshVersions(root: string): PrivateDshVersion[] {
  return globSync(['apps/*/package.json', 'packages/*/*/package.json'], { cwd: root })
    .map(path => path.replaceAll('\\', '/'))
    .sort()
    .flatMap((manifestPath) => {
      const parsed: unknown = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${manifestPath} is not a JSON object`)
      }
      const manifest = parsed as Record<string, unknown>
      if (manifest.private !== true) return []
      if (typeof manifest.version !== 'string') {
        throw new Error(`${manifestPath} must declare a string version`)
      }
      return [{
        manifestPath,
        label: manifestPath.slice(0, -'/package.json'.length),
        version: manifest.version,
      }]
    })
}

/**
 * Plan the dsh family's rewrite: one version for every publishable member,
 * private package, and the root.
 * @param family - the dsh family.
 * @param root - repository root.
 * @param members - the family's members.
 * @param request - `major`, `minor`, `patch`, or an explicit version.
 * @returns The manifests to rewrite and the shared target version.
 */
export function planShared(
  family: ReleaseFamily,
  root: string,
  members: readonly ReleaseMember[],
  request: string,
): { planned: PlannedVersion[]; version: string } {
  const [first] = members
  if (first === undefined) throw new Error(`release family ${family.id} has no members`)
  const version = nextSharedVersion(first.version, request)
  // The workspace root carries the family version too: the workspace constraint
  // requires every member's version to equal the root's.
  const planned: PlannedVersion[] = [
    { manifestPath: ROOT_MANIFEST, label: ROOT_MANIFEST, from: rootVersion(root), to: version, tag: undefined },
  ]
  for (const member of members) {
    planned.push({
      manifestPath: `${member.directory}/package.json`,
      label: member.directory,
      from: member.version,
      to: version,
      tag: family.tagFor({ ...member, version }),
    })
  }
  const publishableManifests = new Set(members.map(member => `${member.directory}/package.json`))
  for (const entry of privateDshVersions(root)) {
    if (publishableManifests.has(entry.manifestPath)) continue
    planned.push({
      manifestPath: entry.manifestPath,
      label: entry.label,
      from: entry.version,
      to: version,
      tag: undefined,
    })
  }
  return { planned, version }
}

/**
 * Plan the vendored family's rewrite: every package advances together while
 * retaining its own version line and tag.
 * @param family - the vendored family.
 * @param members - the family's members.
 * @param prerelease - prerelease identifier to append, for a rehearsal publication.
 * @returns The manifests to rewrite.
 */
export function planPerPackage(
  family: ReleaseFamily,
  members: readonly ReleaseMember[],
  prerelease: string | undefined,
): PlannedVersion[] {
  const planned: PlannedVersion[] = []
  for (const member of members) {
    const tagged = lastTaggedVersion(family, member)
    const to = nextVendorVersion(member.version, tagged, prerelease)
    planned.push({
      manifestPath: `${member.directory}/package.json`,
      label: member.directory,
      from: member.version,
      to,
      tag: family.tagFor({ ...member, version: to }),
    })
  }
  return planned
}
