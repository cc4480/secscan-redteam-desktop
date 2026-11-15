/**
 * The release family abstraction: member discovery, publish order, version
 * baseline, and tag naming shared by every publish sequence.
 */

import { type PublishPlan, planPublishOrder } from './publish-order.ts'
import { type InstalledEntry, type ReleaseMember, discoverMembers } from './release-member.ts'

/** A release sequence: its members, its version baseline, and its tag naming. */
export abstract class ReleaseFamily {
  /** Workflow-facing `--family` identifier. */
  abstract readonly id: string

  /** Repository-relative glob patterns selecting this family's manifests. */
  abstract readonly patterns: readonly string[]

  /** Git tag prefix this family publishes from. */
  abstract readonly tagPrefix: string

  /**
   * Assert that built artifacts match this release family's required profile.
   * Families without environment-selected artifacts accept every build tree.
   * @param _root - repository root containing generated artifacts.
   */
  verifyBuildArtifacts(_root: string): void {}

  /**
   * Discover this family's members.
   * @param root - repository root.
   * @returns Publishable members sorted by directory, with names validated and deduplicated.
   */
  members(root: string): ReleaseMember[] {
    return discoverMembers(this.id, this.patterns, root)
  }

  /**
   * Order members so every package publishes after the family members it
   * depends on, which is what makes a partial publication self-consistent: an
   * interrupted run leaves a prefix whose packages never point at something
   * absent from the registry.
   *
   * Install edges are honoured absolutely — a cycle among them is a defect this
   * reports rather than works around. Peer edges order what they can and are
   * dropped where honouring one would deadlock: sibling packages declare each
   * other as peers, and npm treats an unmet peer as a warning rather than a
   * resolution failure ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
   * Every dropped edge is reported, because dropping one is a decision about a
   * real release rather than an implementation detail.
   * @param members - this family's members.
   * @returns The order, ties broken by name for determinism, and the peer edges it left unordered.
   */
  publishOrder(members: readonly ReleaseMember[]): PublishPlan {
    return planPublishOrder(this.id, members)
  }

  /**
   * Assert this family's version baseline holds across its members.
   * @param members - this family's members.
   */
  abstract verifyVersions(members: readonly ReleaseMember[]): void

  /**
   * The tag prefix a member's versions are tagged under. Every tag for that
   * member starts with it, which is how the last published version is found.
   * @param member - the member being published.
   * @returns The prefix, ending in `-v`.
   */
  abstract tagPrefixFor(member: ReleaseMember): string

  /**
   * The npm dist-tag assigned while publishing a version.
   * @param version - package version from the packed manifest.
   * @returns `next` for a prerelease, or undefined so npm uses `latest`.
   */
  distTagForVersion(version: string): string | undefined {
    return version.includes('-') ? 'next' : undefined
  }

  /**
   * The tag a member publishes from.
   * @param member - the member being published.
   * @returns The full tag name, without `refs/tags/`.
   */
  tagFor(member: ReleaseMember): string {
    return `${this.tagPrefixFor(member)}${member.version}`
  }

  /**
   * Check what a member's packed tarball carries.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  abstract validatePayload(member: ReleaseMember, files: readonly string[]): void

  /**
   * The executable that proves this family's artifacts install and run, or
   * `undefined` for a family that publishes no executable.
   */
  abstract readonly installedEntry: InstalledEntry | undefined
}
