/**
 * Fixtures, git helpers, and per-case cleanup shared by the client build
 * environment cases.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, vi } from 'vitest'
import { writeClientBuildRecord } from './client-build-environment.ts'

/** Repository root the workflow case reads its workflow files from. */
export const root = resolve(import.meta.dirname, '..')

/** Environment variable the bundle-define case sets to observe passthrough. */
export const PROBE_NAME = 'DSH_CLIENT_BUILD_TEST'

/** Full-length commit hash the metadata cases shorten to seven characters. */
export const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'

/** Workflows whose environment must never carry a public client value. */
export const dshBuildWorkflows = [
  'build-exe-for-python-sdk.yml',
  'ci.yml',
  'e2e.yml',
  'release.yml',
  'release-publish.yml',
  'sandbox.yml',
]

const originalProbe = process.env[PROBE_NAME]
const roots: string[] = []

afterEach(() => {
  if (originalProbe === undefined) Reflect.deleteProperty(process.env, PROBE_NAME)
  else process.env[PROBE_NAME] = originalProbe
  vi.resetModules()
  for (const fixture of roots.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

/** Creates a temporary directory that the current case's cleanup removes. */
export function fixtureRoot(prefix: string): string {
  const created = mkdtempSync(join(tmpdir(), prefix))
  roots.push(created)
  return created
}

/** Writes one file, creating its parent directories. */
export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** Builds a client artifact tree carrying a recorded build environment. */
export function buildFixture(environment: Record<string, string>): string {
  const fixture = fixtureRoot('dsh-client-build-')
  write(join(fixture, 'apps/web/dist/index.html'), '<main></main>')
  write(join(fixture, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(fixture, environment)
  return fixture
}

/** Runs one git subcommand inside a fixture repository. */
export function git(path: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: path,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Commits a package version into a fresh fixture repository. */
export function repositoryFixture(version = '1.2.3-rc.4'): string {
  const fixture = fixtureRoot('dsh-client-build-repository-')
  write(join(fixture, 'package.json'), `${JSON.stringify({ version })}\n`)
  write(join(fixture, 'tracked.txt'), 'committed\n')
  git(fixture, ['init'])
  git(fixture, ['config', 'user.name', 'DSH test'])
  git(fixture, ['config', 'user.email', 'dsh-test@example.invalid'])
  git(fixture, ['config', 'commit.gpgsign', 'false'])
  git(fixture, ['add', 'package.json', 'tracked.txt'])
  git(fixture, ['commit', '-m', 'fixture'])
  return fixture
}
