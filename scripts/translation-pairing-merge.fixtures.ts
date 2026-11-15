/** Scratch repositories and spawned merge drivers shared by the pairing merge cases. */

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe } from 'vitest'
import { storeGitBlob } from './translation-pairing-git.ts'
import {
  mergeTranslationPairingRecords as mergeTranslationPairingRecordsWithScope,
  resolveTranslationPairingConflicts as resolveTranslationPairingConflictsWithScope,
} from './translation-pairing-merge.ts'
import {
  renderTranslationPairingRecord,
  translationPairPaths,
} from './translation-pairing-record.ts'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

/** Absolute path of the merge driver entrypoint. */
export const driver = fileURLToPath(new URL('./merge-translation-pairing.ts', import.meta.url))
/** Absolute path of the launcher Git runs as the custom merge driver. */
export const driverLauncher = fileURLToPath(new URL('./merge-translation-pairing-driver.sh', import.meta.url))
/** Absolute repository root, whose `node_modules` and `scripts` every fixture links. */
export const workspaceRoot = fileURLToPath(new URL('../', import.meta.url))
/** ESM loader that lets a fixture launch the driver from its TypeScript source. */
export const tsxLoader = import.meta.resolve('tsx/esm')

const fixtures: string[] = []

/** A scratch repository and the Git environment its commits run under. */
export interface Fixture {
  env: NodeJS.ProcessEnv
  root: string
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) removeFixtureSafely(fixture)
})

/**
 * Registers one part of the `translation pairing merge composition` suite.
 * Every case in this suite drives real `git` invocations against a scratch
 * repository, so it is bound by process creation rather than by its assertions.
 * The value matches DSH_COVERAGE_TEST_TIMEOUT_MS, which the Windows coverage
 * lane passes as --testTimeout: a describe value overrides that flag rather than
 * yielding to it, so a smaller one here lowers what the lane grants every case
 * in this file, none of which carries an allowance of its own. Measurements and
 * the rejected alternatives are in
 * .agents/notes/archived/testing/2026-08-27-translation-pairing-merge-budget.md.
 * @param body - cases for this part of the suite.
 * @returns nothing.
 */
export function pairingMergeSuite(body: () => void): void {
  describe('translation pairing merge composition', { timeout: 90_000 }, body)
}

/**
 * Merges three records with the active-corpus scope check relaxed to admit every pair.
 * @param root - repository root holding the records.
 * @param metaPath - repository-relative pairing-record path.
 * @param ancestorRecord - record text from the merge base.
 * @param currentRecord - record text from the checked-out branch.
 * @param otherRecord - record text from the merged branch.
 * @returns the merged owner content and its blob hashes.
 */
export function mergeTranslationPairingRecords(
  root: string,
  metaPath: string,
  ancestorRecord: string,
  currentRecord: string,
  otherRecord: string,
) {
  return mergeTranslationPairingRecordsWithScope(
    root,
    metaPath,
    ancestorRecord,
    currentRecord,
    otherRecord,
    () => true,
  )
}

/**
 * Resolves every stopped pairing conflict with the active-corpus scope check relaxed.
 * @param root - repository root holding the stopped merge.
 * @returns the repository-relative paths the resolver rewrote.
 */
export function resolveTranslationPairingConflicts(root: string): string[] {
  return resolveTranslationPairingConflictsWithScope(root, () => true)
}

/**
 * Runs Git inside a fixture, failing the case when Git exits non-zero.
 * @param fixture - fixture owning the child environment.
 * @param args - Git arguments.
 * @returns trimmed stdout of the successful Git run.
 */
export function git(fixture: Fixture, args: string[]): string {
  return execFileSync('git', ['-C', fixture.root, ...args], {
    encoding: 'utf8',
    env: fixture.env,
  }).trim()
}

/**
 * Writes one fixture-relative file, creating its parent directories.
 * @param root - fixture root.
 * @param path - path relative to the fixture root.
 * @param content - exact file content.
 * @returns nothing.
 */
export function write(root: string, path: string, content: string): void {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

/**
 * Quotes a path for the `sh` command line Git runs a merge driver through.
 * @param value - path to quote.
 * @returns the double-quoted, escaped argument.
 */
export function shellQuote(value: string): string {
  return `"${value.replace(/["\\$`]/g, '\\$&')}"`
}

/**
 * Links the repository runtime into a fixture so its driver can be launched.
 * @param root - fixture root.
 * @returns nothing.
 */
export function installFixtureRuntime(root: string): void {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  symlinkSync(
    join(workspaceRoot, 'node_modules'),
    join(root, 'node_modules'),
    linkType,
  )
  symlinkSync(join(workspaceRoot, 'scripts'), join(root, 'scripts'), linkType)
}

/**
 * Starts a merge through a driver launcher whose `node` stands in for the real runtime.
 * @param fixture - fixture to merge in.
 * @param nodeScript - the fake `node` program the launcher will run.
 * @returns the spawned merge.
 */
export function startMergeWithFakeNode(
  fixture: Fixture,
  nodeScript = '#!/bin/sh\nexit 72\n',
) {
  const fakeBin = join(fixture.root, 'fake-bin')
  const fakeNode = join(fakeBin, 'node')
  write(fixture.root, 'fake-bin/node', nodeScript)
  chmodSync(fakeNode, 0o755)
  git(fixture, [
    'config',
    'merge.dsh-translation-pairing.driver',
    `${shellQuote(driverLauncher)} %O %A %B %P`,
  ])
  return spawnSync('git', ['-C', fixture.root, 'merge', '--no-commit', 'master'], {
    encoding: 'utf8',
    env: {
      ...fixture.env,
      PATH: `${fakeBin}${delimiter}${fixture.env.PATH ?? ''}`,
    },
  })
}

/**
 * Creates an initialized scratch repository and registers its cleanup.
 * @param attributes - whether to declare the pairing merge attribute.
 * @returns the fixture, ready for commits.
 */
export function createFixture(attributes = true): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-merge-'))
  fixtures.push(root)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'pairing@example.test',
    GIT_AUTHOR_NAME: 'Pairing Test',
    GIT_COMMITTER_EMAIL: 'pairing@example.test',
    GIT_COMMITTER_NAME: 'Pairing Test',
    GIT_CONFIG_GLOBAL: join(root, 'global.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_DEFAULT_HASH: 'sha1',
  }
  const fixture = { env, root }
  execFileSync('git', ['init', '--quiet', '--initial-branch=master', root], { env })
  if (attributes) write(root, '.gitattributes', '*.i18n.yaml merge=dsh-translation-pairing\n')
  return fixture
}

/**
 * Writes both owner files of a pair plus the record that describes them.
 * @param root - fixture root.
 * @param path - repository-relative path of the paired source document.
 * @param source - English source content.
 * @param zh - Chinese translation content.
 * @returns the rendered record content.
 */
export function record(root: string, path: string, source: string, zh: string): string {
  const paths = translationPairPaths(path)
  write(root, paths.source, source)
  write(root, paths.zh, zh)
  const content = renderTranslationPairingRecord(paths, {
    sourceHash: storeGitBlob(root, Buffer.from(source)),
    zhHash: storeGitBlob(root, Buffer.from(zh)),
  })
  write(root, paths.meta, content)
  return content
}
