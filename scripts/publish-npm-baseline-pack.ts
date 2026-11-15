/** Pack planning and the worktree-isolated release build. */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { RELEASE_MANIFEST_NAME, ReleaseBundle } from './publish-npm-baseline-bundle.ts'
import type { CommandRunner } from './publish-npm-baseline-command.ts'
import { confirmEnter, formatCopyableCommand } from './publish-npm-baseline-command.ts'
import {
  expectString,
  formatUtcTimestamp,
  normalizeRegistry,
  parseObject,
  validateBaseVersion,
  validateDistTag,
} from './publish-npm-baseline-json.ts'
import { InstalledBundleSmoke } from './publish-npm-baseline-smoke.ts'
import { DetachedWorktree, WorkspacePackageSet } from './publish-npm-baseline-workspace.ts'

/** Options one pack run accepts from the command line. */
export interface PackOptions {
  ref: string
  registry: string
  outputDirectory: string
}

/** Fixes the identity of one pack attempt before any expensive work begins. */
export class BaselinePackPlan {
  constructor(
    readonly commit: string,
    readonly shortCommit: string,
    readonly timestamp: string,
    readonly baseVersion: string,
    readonly version: string,
    readonly distTag: string,
    readonly registry: string,
    readonly artifactDirectory: string,
  ) {}

  /**
   * Show the planned identity and wait for the operator to confirm it.
   * @param assumeYes - skip the interactive prompt.
   */
  async confirm(assumeYes: boolean): Promise<void> {
    console.log('publish-npm-baseline: planned pack')
    console.log(`  commit:    ${this.commit}`)
    console.log(`  timestamp: ${this.timestamp} UTC`)
    console.log(`  version:   ${this.version}`)
    console.log(`  dist-tag:  ${this.distTag}`)
    console.log(`  registry:  ${this.registry}`)
    console.log(`  output:    ${this.artifactDirectory}`)
    if (assumeYes) return
    await confirmEnter(
      'Press Enter to start packing or type anything to cancel: ',
      'pack requires an interactive terminal or --yes',
      'pack cancelled',
    )
  }
}

/** Builds a release bundle without mutating the caller's checkout. */
export class BaselinePackager {
  constructor(
    private readonly repositoryRoot: string,
    private readonly runner: CommandRunner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Resolve the commit, version, dist-tag, and output directory for one pack.
   * @param options - the pack options from the command line.
   * @returns the plan the confirmation and pack steps consume.
   */
  plan(options: PackOptions): BaselinePackPlan {
    const timestamp = formatUtcTimestamp(this.now())
    const registry = normalizeRegistry(options.registry)
    const commit = this.runner.capture(
      'git',
      ['rev-parse', '--verify', `${options.ref}^{commit}`],
      this.repositoryRoot,
    )
    const shortCommit = this.runner.capture(
      'git',
      ['rev-parse', '--short=10', commit],
      this.repositoryRoot,
    )
    const rootManifest = parseObject(
      this.runner.capture('git', ['show', `${commit}:package.json`], this.repositoryRoot),
      `${commit}:package.json`,
    )
    const baseVersion = expectString(rootManifest, 'version', `${commit}:package.json`)
    validateBaseVersion(baseVersion, `${commit}:package.json`)
    const version = `${baseVersion}-${timestamp}-${shortCommit}`
    const distTag = `dev-${baseVersion}`
    validateDistTag(distTag)
    const artifactDirectory = resolve(options.outputDirectory, version)
    if (existsSync(artifactDirectory)) {
      throw new Error(`output already exists: ${artifactDirectory}`)
    }
    return new BaselinePackPlan(
      commit,
      shortCommit,
      timestamp,
      baseVersion,
      version,
      distTag,
      registry,
      artifactDirectory,
    )
  }

  /**
   * Build the bundle in a detached worktree and remove the worktree afterwards.
   * @param plan - the confirmed pack plan.
   * @returns the packed and smoke-tested bundle.
   */
  pack(plan: BaselinePackPlan): ReleaseBundle {
    const { artifactDirectory } = plan
    if (existsSync(artifactDirectory)) {
      throw new Error(`output already exists: ${artifactDirectory}`)
    }
    const worktree = DetachedWorktree.create(this.repositoryRoot, plan.commit, this.runner)
    let createdArtifactDirectory = false
    try {
      const packageSet = WorkspacePackageSet.discover(worktree.path)
      if (packageSet.baseVersion !== plan.baseVersion) {
        throw new Error(
          `workspace package version ${packageSet.baseVersion} does not match root version `
          + `${plan.baseVersion} at ${plan.commit}`,
        )
      }

      console.log(`publish-npm-baseline: installing detached worktree ${plan.shortCommit}`)
      this.runner.run('pnpm', ['install', '--frozen-lockfile'], worktree.path)
      this.runner.run('pnpm', ['run', 'constraints'], worktree.path)
      packageSet.stage(worktree.path, plan.version)
      mkdirSync(artifactDirectory, { recursive: true })
      createdArtifactDirectory = true

      console.log(
        `publish-npm-baseline: building ${packageSet.packages.length} packages as ${plan.version}`,
      )
      this.runner.run('pnpm', ['run', 'build'], worktree.path)
      this.runner.run('pnpm', ['run', 'publint'], worktree.path)
      this.runner.run('pnpm', ['run', 'verify-built-package-invariants'], worktree.path)
      this.runner.run('pnpm', [
        '--filter', './vendor/**',
        '--filter', './packages/**',
        '--filter', './apps/**',
        '--recursive',
        'pack',
        '--pack-destination', artifactDirectory,
      ], worktree.path)

      const bundle = ReleaseBundle.create(
        artifactDirectory,
        packageSet.packages,
        plan.commit,
        plan.version,
        plan.distTag,
        plan.registry,
        this.runner,
      )
      new InstalledBundleSmoke(bundle, this.runner).run()
      createdArtifactDirectory = false
      console.log(`publish-npm-baseline: packed ${bundle.manifest.packages.length} packages`)
      console.log(`  version:  ${bundle.manifest.version}`)
      console.log(`  dist-tag: ${bundle.manifest.distTag}`)
      console.log(`  manifest: ${resolve(bundle.directory, RELEASE_MANIFEST_NAME)}`)
      console.log('  publish:  ' + formatCopyableCommand('pnpm', [
        '--dir',
        this.repositoryRoot,
        'exec',
        'tsx',
        resolve(this.repositoryRoot, 'scripts/publish-npm-baseline.ts'),
        'publish',
        '--manifest',
        resolve(bundle.directory, RELEASE_MANIFEST_NAME),
        '--yes',
      ]))
      return bundle
    } finally {
      worktree.dispose()
      if (createdArtifactDirectory) {
        rmSync(artifactDirectory, { recursive: true, force: true })
      }
    }
  }
}
