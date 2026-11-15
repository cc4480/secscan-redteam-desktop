/** Hook-path ownership: user-owned values, dormant siblings, and symlinked worktree config. */

import { existsSync, lstatSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  commonDirectory,
  createFixture,
  git,
  gitDirectory,
  gitResult,
  hooksPath,
  installerSuite,
  runInstaller,
  write,
} from './install-lefthook.fixtures.ts'

installerSuite(() => {
  it('preserves user-owned hook paths unless an inherited value is explicitly overridden', async () => {
    const fixture = createFixture()
    const customHook = join(fixture.main, 'custom-hooks/pre-commit')
    write(customHook, '#!/bin/sh\n# custom hook\n', 0o755)
    git(fixture, fixture.main, ['config', 'core.hooksPath', 'custom-hooks'])

    const refused = await runInstaller(fixture, fixture.main)
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('refusing to replace user-owned core.hooksPath')
    expect(refused.stderr).toContain('DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE=1')
    expect(git(fixture, fixture.main, ['config', '--get', 'core.hooksPath'])).toBe('custom-hooks')
    expect(readFileSync(customHook, 'utf8')).toBe('#!/bin/sh\n# custom hook\n')
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'extensions.worktreeConfig']).status).toBe(1)

    const optedIn = await runInstaller(fixture, fixture.main, {
      DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE: '1',
    })
    expect(optedIn.status, optedIn.stderr).toBe(0)
    expect(git(fixture, fixture.main, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(hooksPath(fixture, fixture.main))
    expect(git(fixture, fixture.linked, ['config', '--get', 'core.hooksPath'])).toBe('custom-hooks')
    expect(gitResult(fixture, fixture.linked, ['config', '--worktree', '--get', 'core.hooksPath']).status).toBe(1)
    expect(readFileSync(customHook, 'utf8')).toBe('#!/bin/sh\n# custom hook\n')

    git(fixture, fixture.linked, ['config', '--worktree', 'core.hooksPath', 'linked-custom-hooks'])
    const explicitWorktreePath = await runInstaller(fixture, fixture.linked, {
      DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE: '1',
    })
    expect(explicitWorktreePath.status).toBe(1)
    expect(git(fixture, fixture.linked, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe('linked-custom-hooks')
  })

  it('does not trust an ownership marker outside a registered worktree hook path', async () => {
    const fixture = createFixture()
    const mainInstall = await runInstaller(fixture, fixture.main)
    expect(mainInstall.status, mainInstall.stderr).toBe(0)
    const externalHooks = join(fixture.container, 'external-owned-hooks')
    write(
      join(externalHooks, '.dsh-lefthook-owned'),
      `${JSON.stringify({
        version: 1,
        owner: 'deepseek-harness worktree-local lefthook hooks',
        hooksPath: externalHooks,
      })}\n`,
      0o600,
    )
    git(fixture, fixture.linked, ['config', '--worktree', 'core.hooksPath', externalHooks])

    const result = await runInstaller(fixture, fixture.linked)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('worktree-scoped core.hooksPath')
    expect(git(fixture, fixture.linked, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(externalHooks)
    expect(existsSync(hooksPath(fixture, fixture.linked))).toBe(false)
  })

  it('refuses to activate a sibling worktree dormant hook path', async () => {
    const fixture = createFixture()
    const linkedConfig = join(gitDirectory(fixture, fixture.linked), 'config.worktree')
    const linkedHooks = join(fixture.linked, 'custom-hooks')
    git(fixture, fixture.main, ['config', '--file', linkedConfig, 'core.hooksPath', linkedHooks])
    expect(gitResult(fixture, fixture.linked, ['config', '--get', 'core.hooksPath']).status).toBe(1)

    const result = await runInstaller(fixture, fixture.main)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('sibling dormant worktree config')
    expect(result.stderr).toContain(JSON.stringify(linkedConfig))
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'extensions.worktreeConfig']).status).toBe(1)
    expect(gitResult(fixture, fixture.linked, ['config', '--get', 'core.hooksPath']).status).toBe(1)
    expect(git(fixture, fixture.main, ['config', '--file', linkedConfig, '--get', 'core.hooksPath'])).toBe(linkedHooks)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('refuses an active symlinked worktree config before writing through it', async () => {
    const fixture = createFixture()
    const commonConfig = join(commonDirectory(fixture), 'config')
    const worktreeConfig = join(gitDirectory(fixture, fixture.main), 'config.worktree')
    const externalConfig = join(fixture.container, 'external.gitconfig')
    const externalContent = '[user]\n\tname = External owner\n'
    write(externalConfig, externalContent)
    git(fixture, fixture.main, ['config', '--file', commonConfig, 'core.repositoryFormatVersion', '1'])
    git(fixture, fixture.main, ['config', '--file', commonConfig, 'extensions.worktreeConfig', 'true'])
    symlinkSync(externalConfig, worktreeConfig)

    const result = await runInstaller(fixture, fixture.main)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('active worktree config')
    expect(result.stderr).toContain('not a regular file')
    expect(lstatSync(worktreeConfig).isSymbolicLink()).toBe(true)
    expect(readFileSync(externalConfig, 'utf8')).toBe(externalContent)
    expect(gitResult(fixture, fixture.main, [
      'config', '--file', externalConfig, '--get', 'core.hooksPath',
    ]).status).toBe(1)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })
})
