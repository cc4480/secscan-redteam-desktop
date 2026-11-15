/** Detached worktrees and the workspace package set one baseline publishes. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { CommandRunner } from './publish-npm-baseline-command.ts'
import { expectString, readObject } from './publish-npm-baseline-json.ts'
import type { PackageOrigin } from './publish-npm-baseline-tarball.ts'
import { stageInternalDependencies } from './publish-npm-baseline-tarball.ts'
import { discoverNpmBaselineManifests } from './npm-baseline-packages.ts'

/** One workspace package selected for publication. */
export interface PackageTarget {
  name: string
  directory: string
  origin: PackageOrigin
}

/** Owns a temporary detached worktree and removes it after staging. */
export class DetachedWorktree {
  private constructor(
    readonly path: string,
    private readonly temporaryRoot: string,
    private readonly repositoryRoot: string,
    private readonly runner: CommandRunner,
  ) {}

  /**
   * Add a detached worktree at one commit under a fresh temporary root.
   * @param repositoryRoot - the checkout to add the worktree to.
   * @param commit - the commit to check out detached.
   * @param runner - runner used for the `git` calls.
   * @returns the worktree, which the caller must dispose.
   */
  static create(repositoryRoot: string, commit: string, runner: CommandRunner): DetachedWorktree {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-npm-baseline-'))
    const path = join(temporaryRoot, 'worktree')
    try {
      runner.run('git', ['worktree', 'add', '--detach', path, commit], repositoryRoot)
      return new DetachedWorktree(path, temporaryRoot, repositoryRoot, runner)
    } catch (error: unknown) {
      rmSync(temporaryRoot, { recursive: true, force: true })
      throw error
    }
  }

  /** Remove the worktree and its temporary root. */
  dispose(): void {
    const result = this.runner.result(
      'git',
      ['worktree', 'remove', '--force', this.path],
      this.repositoryRoot,
    )
    if (result.status !== 0) {
      console.error(`publish-npm-baseline: could not remove worktree ${this.path}`)
      if (result.stderr.trim() !== '') console.error(result.stderr.trim())
    }
    rmSync(this.temporaryRoot, { recursive: true, force: true })
  }
}

/** Discovers and stages every package published in one repository baseline. */
export class WorkspacePackageSet {
  private constructor(
    readonly packages: PackageTarget[],
    readonly baseVersion: string,
  ) {}

  /**
   * Select every package manifest the baseline publishes.
   * @param root - the checkout or worktree to read.
   * @returns the selected packages and the root baseline version.
   */
  static discover(root: string): WorkspacePackageSet {
    const manifestPaths = discoverNpmBaselineManifests(root)
    if (manifestPaths.length === 0) {
      throw new Error('no package manifests found under vendor/, packages/, or apps/')
    }

    const packages: PackageTarget[] = []
    const names = new Set<string>()
    const baseVersion = expectString(readObject(resolve(root, 'package.json')), 'version', 'package.json')
    if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
      throw new Error(`package.json must have a stable X.Y.Z version, got ${baseVersion}`)
    }
    for (const manifestPath of manifestPaths) {
      const manifest = readObject(resolve(root, manifestPath))
      const name = expectString(manifest, 'name', manifestPath)
      const version = expectString(manifest, 'version', manifestPath)
      const isVendored = manifestPath.startsWith('vendor/')
      // Vendored packages are rescoped too (vendor/README.md), so publication
      // never carries an upstream name that would squat it on the registry.
      if (!name.startsWith('@deepseek-ai/')) {
        throw new Error(`${manifestPath} must name an @deepseek-ai package`)
      }
      if (name === '@deepseek-ai/dsh-root') {
        throw new Error(`${manifestPath} unexpectedly selected the workspace root`)
      }
      if (names.has(name)) throw new Error(`duplicate package name: ${name}`)
      if (!isVendored && version !== baseVersion) {
        throw new Error(`${manifestPath} has version ${version}; expected ${baseVersion}`)
      }
      names.add(name)
      packages.push({
        name,
        directory: dirname(manifestPath),
        origin: isVendored ? 'vendor' : 'harness',
      })
    }
    packages.sort((left, right) => left.name.localeCompare(right.name))
    return new WorkspacePackageSet(packages, baseVersion)
  }

  /**
   * Rewrite every selected manifest to the release version and pin its internals.
   * @param root - the staged worktree root.
   * @param releaseVersion - the version the baseline publishes.
   */
  stage(root: string, releaseVersion: string): void {
    const internalNames = new Set(this.packages.map(pkg => pkg.name))
    for (const target of this.packages) {
      const manifestPath = resolve(root, target.directory, 'package.json')
      const manifest = readObject(manifestPath)
      manifest.version = releaseVersion
      delete manifest.private
      stageInternalDependencies(manifest, internalNames, releaseVersion, manifestPath)
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    }
  }
}
