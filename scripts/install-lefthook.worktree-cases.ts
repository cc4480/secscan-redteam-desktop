/** Automated-job skips, main/linked worktree isolation, and checkout relocation. */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { unlinkFixtureLinks } from './test-fixture-cleanup.ts'
import {
  type CommandResult,
  commonDirectory,
  createFixture,
  git,
  gitResult,
  hooksPath,
  installLockPath,
  installerSuite,
  runInstaller,
  waitForPath,
  write,
} from './install-lefthook.fixtures.ts'
import { installFakeLefthook, installPairingProbeFixture } from './install-lefthook.fake-binary.ts'

const pairingMergeDriver = 'scripts/merge-translation-pairing-driver.sh %O %A %B %P'

installerSuite(() => {
  for (const [label, extraEnv] of [
    ['CI', { CI: 'true' }],
    ['GitHub Actions', { GITHUB_ACTIONS: 'true' }],
  ] satisfies [string, NodeJS.ProcessEnv][]) {
    it(`skips hook installation when ${label} marks an automated job`, async () => {
      const fixture = createFixture()
      const common = commonDirectory(fixture)
      const missingInclude = join(fixture.container, 'missing-ci-credentials.gitconfig')
      git(fixture, fixture.main, [
        'config',
        '--local',
        'includeIf.gitdir:/github/workspace/.git.path',
        missingInclude,
      ])

      const result = await runInstaller(fixture, fixture.main, extraEnv)

      expect(result.status, result.stderr).toBe(0)
      expect(gitResult(fixture, fixture.main, ['config', '--get', 'extensions.worktreeConfig']).status).toBe(1)
      expect(git(fixture, fixture.main, ['config', '--get', 'core.repositoryFormatVersion'])).toBe('0')
      expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
      expect(existsSync(join(common, 'config.worktree'))).toBe(false)
      expect(gitResult(fixture, fixture.main, [
        'config', '--get', 'merge.dsh-translation-pairing.driver',
      ]).status).toBe(1)
    })
  }

  it('isolates main and linked worktrees without changing legacy common hooks', async () => {
    const fixture = createFixture()
    const common = commonDirectory(fixture)
    const legacyHook = join(common, 'hooks/pre-commit')
    write(legacyHook, '#!/bin/sh\n# legacy hook\n', 0o755)

    const mainInstall = await runInstaller(fixture, fixture.main)
    const linkedInstall = await runInstaller(fixture, fixture.linked)
    expect(mainInstall.status, mainInstall.stderr).toBe(0)
    expect(linkedInstall.status, linkedInstall.stderr).toBe(0)

    const mainHooks = hooksPath(fixture, fixture.main)
    const linkedHooks = hooksPath(fixture, fixture.linked)
    expect(mainHooks).not.toBe(linkedHooks)
    expect(git(fixture, fixture.main, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(mainHooks)
    expect(git(fixture, fixture.linked, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(linkedHooks)
    expect(git(fixture, fixture.main, [
      'config', '--worktree', '--get', 'merge.dsh-translation-pairing.driver',
    ])).toBe(pairingMergeDriver)
    expect(git(fixture, fixture.linked, [
      'config', '--worktree', '--get', 'merge.dsh-translation-pairing.driver',
    ])).toBe(pairingMergeDriver)

    const mainHook = readFileSync(join(mainHooks, 'pre-commit'), 'utf8')
    const linkedHook = readFileSync(join(linkedHooks, 'pre-commit'), 'utf8')
    const canonicalMain = git(fixture, fixture.main, ['rev-parse', '--show-toplevel'])
    const canonicalLinked = git(fixture, fixture.linked, ['rev-parse', '--show-toplevel'])
    expect(mainHook).toContain(`# root=${canonicalMain}`)
    expect(mainHook).toContain('# config=main-worktree-config')
    expect(mainHook).not.toContain(canonicalLinked)
    expect(linkedHook).toContain(`# root=${canonicalLinked}`)
    expect(linkedHook).toContain('# config=linked-worktree-config')
    expect(linkedHook).not.toContain(canonicalMain)
    expect(existsSync(join(mainHooks, 'pre-merge-commit'))).toBe(true)
    expect(existsSync(join(linkedHooks, 'pre-merge-commit'))).toBe(true)
    expect(readFileSync(legacyHook, 'utf8')).toBe('#!/bin/sh\n# legacy hook\n')

    const commonConfig = join(common, 'config')
    expect(git(fixture, fixture.main, ['config', '--file', commonConfig, '--get', 'core.repositoryFormatVersion'])).toBe('1')
    expect(git(fixture, fixture.main, ['config', '--file', commonConfig, '--get', 'extensions.worktreeConfig'])).toBe('true')
    expect(gitResult(fixture, fixture.main, ['config', '--file', commonConfig, '--get', 'core.bare']).status).toBe(1)

    const mainHookBeforeRemoval = readFileSync(join(mainHooks, 'pre-commit'), 'utf8')
    // Windows Git follows the fixture's MOUNT_POINT junctions into their real
    // targets while removing a worktree; unlink them first so the removal
    // cannot delete the repository's scripts/ or tsx package.
    unlinkFixtureLinks(fixture.linked)
    git(fixture, fixture.main, ['worktree', 'remove', '--force', fixture.linked])
    expect(readFileSync(join(mainHooks, 'pre-commit'), 'utf8')).toBe(mainHookBeforeRemoval)
    expect(readFileSync(legacyHook, 'utf8')).toBe('#!/bin/sh\n# legacy hook\n')
  })

  it('replaces the owned hook path Git copies into a newly added worktree', async () => {
    const fixture = createFixture()
    const mainInstall = await runInstaller(fixture, fixture.main)
    expect(mainInstall.status, mainInstall.stderr).toBe(0)
    const mainHooks = hooksPath(fixture, fixture.main)
    const mainHookBefore = readFileSync(join(mainHooks, 'pre-commit'), 'utf8')
    const lateLinked = join(fixture.container, 'late-linked')
    git(fixture, fixture.main, ['worktree', 'add', '-b', 'late-linked', lateLinked])
    write(join(lateLinked, 'lefthook.yml'), 'late-linked-worktree-config\n')
    installFakeLefthook(lateLinked)
    installPairingProbeFixture(lateLinked)
    expect(git(fixture, lateLinked, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(mainHooks)

    const linkedInstall = await runInstaller(fixture, lateLinked)

    expect(linkedInstall.status, linkedInstall.stderr).toBe(0)
    const linkedHooks = hooksPath(fixture, lateLinked)
    expect(linkedHooks).not.toBe(mainHooks)
    expect(git(fixture, lateLinked, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(linkedHooks)
    expect(readFileSync(join(linkedHooks, 'pre-commit'), 'utf8')).toContain(
      '# config=late-linked-worktree-config',
    )
    expect(readFileSync(join(mainHooks, 'pre-commit'), 'utf8')).toBe(mainHookBefore)
  })

  it('serializes concurrent installs and keeps repeated output stable', async () => {
    const fixture = createFixture()
    const delayed = { DSH_TEST_LEFTHOOK_DELAY_MS: '150' }
    const first = await Promise.all([
      runInstaller(fixture, fixture.main, delayed),
      runInstaller(fixture, fixture.linked, delayed),
    ])
    for (const result of first) expect(result.status, result.stderr).toBe(0)

    const mainHookPath = join(hooksPath(fixture, fixture.main), 'pre-push')
    const initialHook = readFileSync(mainHookPath, 'utf8')
    const repeated = await Promise.all([
      runInstaller(fixture, fixture.main, delayed),
      runInstaller(fixture, fixture.main, delayed),
    ])
    for (const result of repeated) expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(mainHookPath, 'utf8')).toBe(initialHook)
    expect(existsSync(join(commonDirectory(fixture), 'dsh-lefthook-install.lock'))).toBe(false)
    expect(existsSync(join(hooksPath(fixture, fixture.main), '.fake-lefthook-running'))).toBe(false)
  })

  it('waits for a concurrent installer to finish publishing its lock record', async () => {
    const fixture = createFixture()
    const lockPath = installLockPath(fixture)
    const publicationBarrier = join(fixture.container, 'lock-publication')
    const observationBarrier = join(fixture.container, 'lock-observation')
    const publishing = runInstaller(fixture, fixture.main, {
      DSH_TEST_LEFTHOOK_LOCK_PUBLISH_BARRIER: publicationBarrier,
    })
    let waiting: Promise<CommandResult> | undefined
    const release = (): void => {
      writeFileSync(`${publicationBarrier}.release`, '')
      writeFileSync(`${observationBarrier}.release`, '')
    }
    try {
      await waitForPath(`${publicationBarrier}.ready`)
      expect(readFileSync(lockPath, 'utf8')).toBe('')
      waiting = runInstaller(fixture, fixture.linked, {
        DSH_TEST_LEFTHOOK_LOCK_OBSERVE_BARRIER: observationBarrier,
      })
      await waitForPath(`${observationBarrier}.ready`)
      expect(readFileSync(lockPath, 'utf8')).toBe('')
      release()
      const results = await Promise.all([publishing, waiting])
      for (const result of results) expect(result.status, result.stderr).toBe(0)
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      release()
      await Promise.allSettled([publishing, ...waiting === undefined ? [] : [waiting]])
    }
  })

  it('repairs its owned absolute hook path after the checkout moves', async () => {
    const fixture = createFixture()
    const oldRoot = fixture.main
    const first = await runInstaller(fixture, oldRoot)
    expect(first.status, first.stderr).toBe(0)
    const oldHooks = hooksPath(fixture, oldRoot)
    const movedRoot = join(fixture.container, 'moved-main')
    renameSync(oldRoot, movedRoot)

    const moved = await runInstaller(fixture, movedRoot)

    expect(moved.status, moved.stderr).toBe(0)
    const movedHooks = hooksPath(fixture, movedRoot)
    expect(movedHooks).not.toBe(oldHooks)
    expect(git(fixture, movedRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(movedHooks)
    const canonicalMoved = git(fixture, movedRoot, ['rev-parse', '--show-toplevel'])
    expect(readFileSync(join(movedHooks, 'pre-commit'), 'utf8')).toContain(`# root=${canonicalMoved}`)
    expect(readFileSync(join(movedHooks, '.dsh-lefthook-owned'), 'utf8')).toContain(
      JSON.stringify(movedHooks),
    )
  })
})
