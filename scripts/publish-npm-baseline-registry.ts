/** Publishing and verifying a release bundle against its recorded registry. */

import { tmpdir } from 'node:os'
import type { ReleaseBundle } from './publish-npm-baseline-bundle.ts'
import type { CommandRunner } from './publish-npm-baseline-command.ts'
import {
  commandFailure,
  confirmEnter,
  npmClientEnvironment,
} from './publish-npm-baseline-command.ts'
import { parseDistTagListing } from './publish-npm-baseline-json.ts'

const RELEASE_ENTRY_PACKAGE = '@deepseek-ai/dsh'
const LATEST_DIST_TAG = 'latest'

/** Publishes and verifies a release bundle against its recorded registry. */
export class RegistryPublication {
  private readonly npmEnvironment = npmClientEnvironment()
  private readonly npmWorkingDirectory = tmpdir()

  constructor(
    private readonly bundle: ReleaseBundle,
    private readonly runner: CommandRunner,
  ) {}

  /**
   * Publish every recorded tarball, then verify the registry agrees.
   * @param assumeYes - skip the interactive confirmation.
   */
  async publish(assumeYes: boolean): Promise<void> {
    this.pingRegistry()
    this.requireIdentity()
    if (!assumeYes) await this.confirm()

    for (const pkg of this.bundle.manifest.packages) {
      const existingIntegrity = this.remoteIntegrity(pkg.name)
      if (existingIntegrity === undefined) {
        this.runner.run('npm', [
          'publish',
          this.bundle.tarballPath(pkg),
          `--registry=${this.bundle.manifest.registry}`,
          `--tag=${this.bundle.manifest.distTag}`,
        ], this.npmWorkingDirectory, this.npmEnvironment)
      } else {
        if (existingIntegrity !== pkg.integrity) {
          throw new Error(
            `${pkg.name}@${this.bundle.manifest.version} already exists with different integrity`,
          )
        }
        console.log(
          `publish-npm-baseline: already published ${pkg.name}@${this.bundle.manifest.version}`,
        )
      }
      this.ensureDistTag(pkg.name, this.bundle.manifest.distTag)
    }
    this.ensureDistTag(RELEASE_ENTRY_PACKAGE, LATEST_DIST_TAG)
    this.verifyRemote()
    this.verifyReleaseEntryDistTag()
  }

  /** Verify the registry serves every recorded tarball and dist-tag. */
  verify(): void {
    this.pingRegistry()
    this.verifyRemote()
    this.verifyReleaseEntryDistTag()
  }

  private verifyRemote(): void {
    for (const pkg of this.bundle.manifest.packages) {
      const integrity = this.remoteIntegrity(pkg.name)
      if (integrity === undefined) {
        throw new Error(`package is missing: ${pkg.name}@${this.bundle.manifest.version}`)
      }
      if (integrity !== pkg.integrity) {
        throw new Error(`integrity mismatch: ${pkg.name}@${this.bundle.manifest.version}`)
      }
      const tagVersion = this.remoteDistTag(pkg.name, this.bundle.manifest.distTag)
      if (tagVersion !== this.bundle.manifest.version) {
        throw new Error(
          `${pkg.name}@${this.bundle.manifest.distTag} points to ${tagVersion ?? '<missing>'}; `
          + `expected ${this.bundle.manifest.version}`,
        )
      }
      console.log(`publish-npm-baseline: verified ${pkg.name}@${this.bundle.manifest.version}`)
    }
    console.log(
      `publish-npm-baseline: verified ${this.bundle.manifest.packages.length} packages and `
      + `dist-tag ${this.bundle.manifest.distTag}`,
    )
  }

  private verifyReleaseEntryDistTag(): void {
    const tagVersion = this.remoteDistTag(RELEASE_ENTRY_PACKAGE, LATEST_DIST_TAG)
    if (tagVersion !== this.bundle.manifest.version) {
      throw new Error(
        `${RELEASE_ENTRY_PACKAGE}@${LATEST_DIST_TAG} points to ${tagVersion ?? '<missing>'}; `
        + `expected ${this.bundle.manifest.version}`,
      )
    }
    console.log(
      `publish-npm-baseline: verified ${RELEASE_ENTRY_PACKAGE}@${LATEST_DIST_TAG} at `
      + this.bundle.manifest.version,
    )
  }

  private pingRegistry(): void {
    const { registry } = this.bundle.manifest
    this.runner.capture(
      'npm', ['ping', `--registry=${registry}`], this.npmWorkingDirectory, this.npmEnvironment,
    )
  }

  private requireIdentity(): void {
    const { registry } = this.bundle.manifest
    const identity = this.runner.capture(
      'npm', ['whoami', `--registry=${registry}`], this.npmWorkingDirectory, this.npmEnvironment,
    )
    console.log(`publish-npm-baseline: registry identity ${identity} at ${registry}`)
  }

  private async confirm(): Promise<void> {
    await confirmEnter(
      `Publish ${this.bundle.manifest.packages.length} packages as `
      + `${this.bundle.manifest.version} to ${this.bundle.manifest.registry}? `
      + 'Press Enter to continue or type anything to cancel: ',
      'publish requires an interactive terminal or --yes',
      'publication cancelled',
    )
  }

  private remoteIntegrity(name: string): string | undefined {
    const { registry, version } = this.bundle.manifest
    const result = this.runner.result(
      'npm',
      ['view', `${name}@${version}`, 'dist.integrity', '--json', `--registry=${registry}`],
      this.npmWorkingDirectory,
      this.npmEnvironment,
    )
    if (result.status !== 0) {
      if (/E404|NOT_FOUND|404 Not Found/.test(`${result.stdout}\n${result.stderr}`)) return undefined
      throw commandFailure('npm', ['view', `${name}@${version}`], result)
    }
    const value: unknown = result.stdout.trim() === '' ? undefined : JSON.parse(result.stdout)
    if (typeof value !== 'string' || !value.startsWith('sha512-')) {
      throw new Error(`registry returned no integrity for ${name}@${version}`)
    }
    return value
  }

  private remoteDistTag(name: string, distTag: string): string | undefined {
    const { registry } = this.bundle.manifest
    const raw = this.runner.capture(
      'npm',
      ['dist-tag', 'ls', name, `--registry=${registry}`],
      this.npmWorkingDirectory,
      this.npmEnvironment,
    )
    return parseDistTagListing(raw, name).get(distTag)
  }

  private ensureDistTag(name: string, distTag: string): void {
    if (this.remoteDistTag(name, distTag) === this.bundle.manifest.version) return
    const { registry, version } = this.bundle.manifest
    this.runner.run(
      'npm',
      ['dist-tag', 'add', `${name}@${version}`, distTag, `--registry=${registry}`],
      this.npmWorkingDirectory,
      this.npmEnvironment,
    )
  }
}
