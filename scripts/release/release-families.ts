/**
 * The two release families this repository's release scripts own, and the
 * registry that resolves one by its `--family` identifier.
 */

import {
  officialClientBuildEnvironment,
  readClientBuildRecord,
} from '../client-build-environment.ts'
import { validateTarballPayload } from '../publication-payload.ts'
import { ReleaseFamily } from './release-family.ts'
import type { ReleaseMember } from './release-member.ts'

/** Release packages and apps: one shared version across the whole family. */
class DshFamily extends ReleaseFamily {
  readonly id = 'dsh'
  readonly patterns = [
    'packages/*/*/package.json',
    'apps/*/package.json',
  ] as const
  readonly tagPrefix = 'dsh-v'

  /** Require current artifacts from a complete official client build. */
  override verifyBuildArtifacts(root: string): void {
    readClientBuildRecord(root, officialClientBuildEnvironment(root))
  }

  /**
   * Require one version across the family, the way a single tag can name it.
   * @param members - this family's members.
   */
  verifyVersions(members: readonly ReleaseMember[]): void {
    const versions = new Set(members.map(member => member.version))
    if (versions.size !== 1) {
      const detail = members.map(member => `${member.directory}: ${member.version}`).join('\n')
      throw new Error(`dsh release members must share one version:\n${detail}`)
    }
  }

  /**
   * The single family prefix: every member shares one version, so one tag names it.
   * @returns `dsh-v`.
   */
  tagPrefixFor(): string {
    return this.tagPrefix
  }

  override distTagForVersion(version: string): string | undefined {
    const separator = version.indexOf('-')
    if (separator === -1) return undefined
    const [channel] = version.slice(separator + 1).split('.')
    if (channel === 'alpha' || channel === 'canary') return channel
    return 'next'
  }

  /**
   * Reject source and declaration-map members, the repository's publication policy.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  validatePayload(member: ReleaseMember, files: readonly string[]): void {
    validateTarballPayload(files, member.name)
  }

  readonly installedEntry = { packageName: '@deepseek-ai/dsh', binPath: 'lib/bin.js' }
}

/** `vendor/*`: every package keeps its own version line, so every package has its own tag. */
class VendorFamily extends ReleaseFamily {
  readonly id = 'vendor'
  readonly patterns = ['vendor/*/package.json'] as const
  readonly tagPrefix = 'vendor-'

  /**
   * Accept independent versions; only reject a version this repository cannot publish.
   * @param members - this family's members.
   */
  verifyVersions(members: readonly ReleaseMember[]): void {
    for (const member of members) {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(member.version)) {
        throw new Error(`${member.directory} has an unpublishable version: ${member.version}`)
      }
    }
  }

  /**
   * A prefix per member, because one vendor release can carry several versions.
   * @param member - the member being published.
   * @returns `vendor-<unscoped name>-v`.
   */
  tagPrefixFor(member: ReleaseMember): string {
    return `${this.tagPrefix}${member.name.replace('@deepseek-ai/', '')}-v`
  }

  /**
   * Require the payload the vendored manifest declares, including upstream's
   * `src` tree and declaration maps.
   *
   * The harness policy that rejects both does not apply here: these manifests
   * export `./src/*` for source navigation, so dropping `src` would publish a
   * package whose export map points at absent files. What must hold instead is
   * that every path the manifest selects is present, which `files` already
   * decides and `pnpm pack` already enforces.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  validatePayload(member: ReleaseMember, files: readonly string[]): void {
    if (files.length === 0) throw new Error(`${member.name} packed an empty tarball`)
  }

  /** No installed-entry probe: these are libraries a consumer imports, with no executable. */
  readonly installedEntry = undefined
}

/** Every release family this module owns, in workflow order. */
function releaseFamilies(): readonly ReleaseFamily[] {
  return [new DshFamily(), new VendorFamily()]
}

/**
 * Resolve a family by its `--family` identifier.
 * @param id - family identifier.
 * @returns The family.
 */
export function releaseFamily(id: string): ReleaseFamily {
  const family = releaseFamilies().find(candidate => candidate.id === id)
  if (family === undefined) {
    const known = releaseFamilies().map(candidate => candidate.id).join(', ')
    throw new Error(`unknown release family ${id}; expected one of ${known}`)
  }
  return family
}

/**
 * The npm tarball filename `pnpm pack` writes for a member.
 * @param member - the packed member.
 * @returns The tarball filename.
 */
export function tarballName(member: ReleaseMember): string {
  const unscoped = member.name.startsWith('@') ? member.name.slice(1).replace('/', '-') : member.name
  return `${unscoped}-${member.version}.tgz`
}
