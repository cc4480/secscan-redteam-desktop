/** Ownership-marker, hook-alias, and repository-config refusals. */

import {
  existsSync,
  linkSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  commonDirectory,
  createFixture,
  git,
  gitResult,
  hooksPath,
  installerSuite,
  runInstaller,
  write,
} from './install-lefthook.fixtures.ts'

installerSuite(() => {
  it.skipIf(process.platform === 'win32')('refuses a multiply linked ownership marker before relocation rewrites it', async () => {
    const fixture = createFixture()
    const oldRoot = fixture.main
    const first = await runInstaller(fixture, oldRoot)
    expect(first.status, first.stderr).toBe(0)
    const oldHooks = hooksPath(fixture, oldRoot)
    const markerName = '.dsh-lefthook-owned'
    const externalMarker = join(fixture.container, 'external-marker')
    linkSync(join(oldHooks, markerName), externalMarker)
    const externalContent = readFileSync(externalMarker, 'utf8')
    const movedRoot = join(fixture.container, 'moved-main')
    renameSync(oldRoot, movedRoot)

    const result = await runInstaller(fixture, movedRoot)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid ownership marker')
    expect(readFileSync(externalMarker, 'utf8')).toBe(externalContent)
  })

  it.skipIf(process.platform === 'win32')('refuses aliased generated hooks before Lefthook can overwrite their targets', async () => {
    for (const kind of ['symlink', 'hardlink'] as const) {
      const fixture = createFixture()
      const first = await runInstaller(fixture, fixture.main)
      expect(first.status, first.stderr).toBe(0)
      const hook = join(hooksPath(fixture, fixture.main), 'pre-commit')
      const externalHook = join(fixture.container, `${kind}-external-hook`)
      rmSync(hook)
      write(externalHook, `external ${kind} target\n`)
      if (kind === 'symlink') symlinkSync(externalHook, hook)
      else linkSync(externalHook, hook)
      const externalContent = readFileSync(externalHook, 'utf8')

      const result = await runInstaller(fixture, fixture.main)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('non-regular or multiply linked hook entry')
      expect(readFileSync(externalHook, 'utf8')).toBe(externalContent)
    }
  })

  it('restores the marker-backed stale hook path when relocation reinstall fails', async () => {
    const fixture = createFixture()
    const oldRoot = fixture.main
    const first = await runInstaller(fixture, oldRoot)
    expect(first.status, first.stderr).toBe(0)
    const oldHooks = hooksPath(fixture, oldRoot)
    const markerName = '.dsh-lefthook-owned'
    const previousMarker = readFileSync(join(oldHooks, markerName), 'utf8')
    const movedRoot = join(fixture.container, 'moved-main')
    renameSync(oldRoot, movedRoot)

    const failed = await runInstaller(fixture, movedRoot, { DSH_TEST_LEFTHOOK_FAIL: '1' })

    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('exit status 77')
    const movedHooks = hooksPath(fixture, movedRoot)
    expect(git(fixture, movedRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(oldHooks)
    expect(readFileSync(join(movedHooks, markerName), 'utf8')).toBe(previousMarker)
  })

  it('refuses dormant repository extensions before upgrading the repository format', async () => {
    const fixture = createFixture()
    const commonConfig = join(commonDirectory(fixture), 'config')
    git(fixture, fixture.main, ['config', 'extensions.dshUnknown', 'true'])
    expect(gitResult(fixture, fixture.main, ['status', '--porcelain']).status).toBe(0)

    const result = await runInstaller(fixture, fixture.main)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('dormant repository extension extensions.dshunknown')
    expect(git(fixture, fixture.main, [
      'config', '--file', commonConfig, '--get', 'core.repositoryFormatVersion',
    ])).toBe('0')
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'extensions.worktreeConfig']).status).toBe(1)
    expect(gitResult(fixture, fixture.main, ['status', '--porcelain']).status).toBe(0)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })

  it('refuses direct core.worktree before enabling worktree config', async () => {
    const fixture = createFixture()
    const commonConfig = join(commonDirectory(fixture), 'config')
    git(fixture, fixture.main, ['config', '--file', commonConfig, 'core.worktree', fixture.main])

    const result = await runInstaller(fixture, fixture.linked)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('core.worktree is in the common config')
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'extensions.worktreeConfig']).status).toBe(1)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('refuses a symlinked common repository config before writing through it', async () => {
    const fixture = createFixture()
    const commonConfig = join(commonDirectory(fixture), 'config')
    const externalConfig = join(fixture.container, 'external-common.gitconfig')
    renameSync(commonConfig, externalConfig)
    symlinkSync(externalConfig, commonConfig)
    const externalContent = readFileSync(externalConfig, 'utf8')

    const result = await runInstaller(fixture, fixture.main)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('common repository config')
    expect(result.stderr).toContain('not a regular file')
    expect(lstatSync(commonConfig).isSymbolicLink()).toBe(true)
    expect(readFileSync(externalConfig, 'utf8')).toBe(externalContent)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })
})
