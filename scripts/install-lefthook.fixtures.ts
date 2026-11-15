/** Scratch worktree fixtures and the spawned installer used by the installer cases. */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe } from 'vitest'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'
import { installFakeLefthook, installPairingProbeFixture } from './install-lefthook.fake-binary.ts'

const installer = fileURLToPath(new URL('./install-lefthook.mjs', import.meta.url))
const fixtures: string[] = []

interface Fixture {
  container: string
  env: NodeJS.ProcessEnv
  linked: string
  main: string
}

/** Exit status and captured streams from one spawned command. */
export interface CommandResult {
  status: number | null
  stderr: string
  stdout: string
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) removeFixtureSafely(fixture)
})

/**
 * Registers one part of the `worktree-local Lefthook installer` suite.
 * Every case builds scratch worktrees and drives them through spawned Git and
 * Node subprocesses, so the suite is bound by process creation rather than by
 * its assertions. The value matches DSH_COVERAGE_TEST_TIMEOUT_MS, which the
 * Windows coverage lane passes as --testTimeout: a describe value overrides that
 * flag rather than yielding to it, so a smaller one here lowers what the lane
 * grants every case in this file, none of which carries an allowance of its own.
 * Rationale and the paired hook budget are in
 * .agents/notes/archived/testing/2026-08-29-windows-lane-hook-and-lefthook-budget.md.
 * @param body - cases for this part of the suite.
 * @returns nothing.
 */
export function installerSuite(body: () => void): void {
  describe('worktree-local Lefthook installer', { timeout: 90_000 }, body)
}

/**
 * Runs one command and captures its exit status and streams.
 * @param command - executable to spawn.
 * @param args - arguments passed to the executable.
 * @param cwd - working directory of the child.
 * @param env - environment of the child.
 * @returns the child's status and captured stderr and stdout.
 */
export function commandResult(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env })
  return { status: result.status, stderr: result.stderr, stdout: result.stdout }
}

/**
 * Runs Git inside a fixture and keeps a non-zero exit status.
 * @param fixture - fixture owning the child environment.
 * @param cwd - repository working directory.
 * @param args - Git arguments.
 * @returns the child's status and captured stderr and stdout.
 */
export function gitResult(fixture: Fixture, cwd: string, args: string[]): CommandResult {
  return commandResult('git', args, cwd, fixture.env)
}

/**
 * Runs Git inside a fixture, failing the case when Git exits non-zero.
 * @param fixture - fixture owning the child environment.
 * @param cwd - repository working directory.
 * @param args - Git arguments.
 * @returns trimmed stdout of the successful Git run.
 */
export function git(fixture: Fixture, cwd: string, args: string[]): string {
  const result = gitResult(fixture, cwd, args)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

/**
 * Writes a file with its parent directory created.
 * @param path - destination path.
 * @param content - file content.
 * @param mode - optional permission bits.
 * @returns nothing.
 */
export function write(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, mode === undefined ? undefined : { mode })
}

/**
 * Creates the main and linked worktrees one case installs into.
 * @param names - optional directory names for the two worktrees.
 * @returns the fixture handle recording both roots and their child environment.
 */
export function createFixture(names: { main?: string; linked?: string } = {}): Fixture {
  const container = mkdtempSync(join(tmpdir(), 'dsh-lefthook-'))
  fixtures.push(container)
  const main = join(container, names.main ?? 'main')
  const linked = join(container, names.linked ?? 'linked')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: 'false',
    GITHUB_ACTIONS: 'false',
    GIT_AUTHOR_EMAIL: 'hooks@example.test',
    GIT_AUTHOR_NAME: 'Hooks Test',
    GIT_COMMITTER_EMAIL: 'hooks@example.test',
    GIT_COMMITTER_NAME: 'Hooks Test',
    GIT_CONFIG_GLOBAL: join(container, 'global.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: container,
    XDG_CONFIG_HOME: join(container, '.config'),
  }
  const fixture = { container, env, linked, main }
  mkdirSync(main)
  git(fixture, container, ['init', main])
  write(join(main, 'README.md'), '# fixture\n')
  git(fixture, main, ['add', 'README.md'])
  git(fixture, main, ['commit', '-m', 'fixture'])
  git(fixture, main, ['worktree', 'add', '-b', 'linked', linked])
  write(join(main, 'lefthook.yml'), 'main-worktree-config\n')
  write(join(linked, 'lefthook.yml'), 'linked-worktree-config\n')
  installFakeLefthook(main)
  installFakeLefthook(linked)
  installPairingProbeFixture(main)
  installPairingProbeFixture(linked)
  return fixture
}

/**
 * Resolves one worktree's absolute Git directory.
 * @param fixture - fixture owning the child environment.
 * @param root - worktree root to resolve.
 * @returns the absolute Git directory of that worktree.
 */
export function gitDirectory(fixture: Fixture, root: string): string {
  return git(fixture, root, ['rev-parse', '--absolute-git-dir'])
}

/**
 * Resolves the directory both worktrees share.
 * @param fixture - fixture owning the child environment.
 * @returns the absolute common Git directory.
 */
export function commonDirectory(fixture: Fixture): string {
  const output = git(fixture, fixture.main, ['rev-parse', '--git-common-dir'])
  return isAbsolute(output) ? output : resolve(fixture.main, output)
}

/**
 * Resolves the hook directory the installer owns for one worktree.
 * @param fixture - fixture owning the child environment.
 * @param root - worktree root to resolve.
 * @returns the installer-owned hook directory of that worktree.
 */
export function hooksPath(fixture: Fixture, root: string): string {
  return join(gitDirectory(fixture, root), 'dsh-hooks')
}

/**
 * Resolves the installer lock record path of one fixture.
 * @param fixture - fixture owning the child environment.
 * @returns the absolute lock record path.
 */
export function installLockPath(fixture: Fixture): string {
  return join(commonDirectory(fixture), 'dsh-lefthook-install.lock')
}

/**
 * Waits until a path appears in a fixture.
 * @param path - path the child is expected to publish.
 * @returns a promise settling once the path exists.
 */
export async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
}

/**
 * Runs the installer script in a fixture root.
 * @param fixture - fixture owning the child environment.
 * @param root - worktree root to install into.
 * @param extraEnv - environment overrides for this run.
 * @returns the installer's status and captured streams.
 */
export function runInstaller(
  fixture: Fixture,
  root: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [installer], {
      cwd: root,
      env: { ...fixture.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (status) => { resolveResult({ status, stderr, stdout }) })
  })
}
