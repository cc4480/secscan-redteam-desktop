/** Repository-owned Git and version metadata embedded in client build artifacts. */

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isObject } from './client-build-environment-json.ts'
import {
  CLIENT_COMMIT_HASH_VARIABLE,
  OFFICIAL_CLIENT_BUILD_ENVIRONMENT,
  clientBuildEnvironment,
  type ClientBuildEnvironment,
} from './client-build-environment-values.ts'

/**
 * Resolve the short source commit used by browser build metadata.
 * @param root - repository root used when no explicit value is supplied.
 * @param environment - environment that may already carry a commit value.
 * @returns lowercase 7-character Git commit prefix.
 */
export function repositoryCommitHash(root: string, environment: NodeJS.ProcessEnv = process.env): string {
  const explicit = environment[CLIENT_COMMIT_HASH_VARIABLE]
  const value = explicit ?? execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (!/^[0-9a-f]{7,40}$/iu.test(value)) {
    throw new Error(`${CLIENT_COMMIT_HASH_VARIABLE} must be a Git commit hash; got ${JSON.stringify(value)}`)
  }
  return value.slice(0, 7).toLowerCase()
}

/**
 * Resolve the repository package version used by browser build metadata.
 * @param root - repository root containing the authoritative package.json.
 * @returns the repository's semver-compatible package version.
 */
export function repositoryVersion(root: string): string {
  const path = resolve(root, 'package.json')
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`cannot read repository version from ${path}: ${detail}`)
  }
  if (!isObject(manifest) || typeof manifest.version !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error(`repository package.json has an invalid version ${JSON.stringify(isObject(manifest) ? manifest.version : undefined)}`)
  }
  return manifest.version
}

/**
 * Read whether Git reports any staged, unstaged, untracked, or submodule change.
 * @param root - repository root whose worktree is inspected.
 * @returns true or false inside a Git worktree; undefined without Git metadata.
 */
export function repositoryGitDirty(root: string): boolean | undefined {
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (probe.error !== undefined || probe.status !== 0 || probe.stdout.trim() !== 'true') return undefined

  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (status.error !== undefined) throw status.error
  if (status.status !== 0) {
    throw new Error(`git status failed in ${root}: ${status.stderr.trim() || String(status.status)}`)
  }
  return status.stdout !== ''
}

/**
 * Resolve the public environment for a complete default build from one checkout.
 * Repository-owned metadata replaces inherited values; other public values pass through.
 * @param root - repository root supplying version and Git metadata.
 * @param environment - caller environment supplying optional commit and public extensions.
 * @returns complete public client environment for the default build.
 */
export function repositoryClientBuildEnvironment(
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
): ClientBuildEnvironment {
  const inherited = { ...clientBuildEnvironment(environment) }
  delete inherited.DSH_CLIENT_COMMIT_HASH
  delete inherited.DSH_CLIENT_GIT_DIRTY
  delete inherited.DSH_CLIENT_VERSION
  const dirty = repositoryGitDirty(root)
  return {
    ...inherited,
    DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, environment),
    ...(dirty === true ? { DSH_CLIENT_GIT_DIRTY: 'true' } : {}),
    DSH_CLIENT_VERSION: repositoryVersion(root),
  }
}

/**
 * Resolve the exact public values required by an official build at one commit.
 * @param root - repository root whose HEAD must match the built source.
 * @param environment - optional explicit commit source for non-Git build environments.
 * @returns complete official client environment.
 */
export function officialClientBuildEnvironment(
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<Record<`DSH_CLIENT_${string}`, string>> {
  return {
    DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, environment),
    DSH_CLIENT_VERSION: repositoryVersion(root),
    ...OFFICIAL_CLIENT_BUILD_ENVIRONMENT,
  }
}
