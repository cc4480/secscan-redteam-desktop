/** Rollback after failed installation, pairing-driver probe, and Git support checks. */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  commandResult,
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
  it('never overrides a hook path included by worktree config', async () => {
    const fixture = createFixture()
    const commonConfig = join(commonDirectory(fixture), 'config')
    const worktreeConfig = join(gitDirectory(fixture, fixture.main), 'config.worktree')
    const includedConfig = join(fixture.container, 'included-worktree.gitconfig')
    const includedHooks = join(fixture.container, 'included-hooks')
    const sentinel = join(includedHooks, 'pre-commit')
    write(sentinel, '#!/bin/sh\n# included-worktree sentinel\n', 0o755)
    git(fixture, fixture.main, ['config', '--file', includedConfig, 'core.hooksPath', includedHooks])
    git(fixture, fixture.main, ['config', '--file', commonConfig, 'core.repositoryFormatVersion', '1'])
    git(fixture, fixture.main, ['config', '--file', commonConfig, 'extensions.worktreeConfig', 'true'])
    git(fixture, fixture.main, ['config', '--file', worktreeConfig, 'include.path', includedConfig])

    const result = await runInstaller(fixture, fixture.main, {
      DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE: '1',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('worktree-scoped core.hooksPath')
    expect(git(fixture, fixture.main, ['config', '--get', 'core.hooksPath'])).toBe(includedHooks)
    expect(readFileSync(sentinel, 'utf8')).toBe('#!/bin/sh\n# included-worktree sentinel\n')
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })

  it('restores the previous hook lookup when Lefthook installation fails', async () => {
    const fixture = createFixture()
    const common = commonDirectory(fixture)
    const legacyHook = join(common, 'hooks/pre-push')
    write(legacyHook, '#!/bin/sh\n# legacy pre-push\n', 0o755)

    const result = await runInstaller(fixture, fixture.main, { DSH_TEST_LEFTHOOK_FAIL: '1' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('exit status 77')
    expect(gitResult(fixture, fixture.main, ['config', '--worktree', '--get', 'core.hooksPath']).status).toBe(1)
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'core.hooksPath']).status).toBe(1)
    expect(gitResult(fixture, fixture.main, [
      'config', '--worktree', '--get', 'merge.dsh-translation-pairing.name',
    ]).status).toBe(1)
    expect(gitResult(fixture, fixture.main, [
      'config', '--worktree', '--get', 'merge.dsh-translation-pairing.driver',
    ]).status).toBe(1)
    expect(readFileSync(legacyHook, 'utf8')).toBe('#!/bin/sh\n# legacy pre-push\n')
  })

  it('does not publish worktree integration when the pairing driver probe fails', async () => {
    const fixture = createFixture()
    rmSync(join(fixture.main, 'node_modules/tsx'), { recursive: true, force: true })

    const result = await runInstaller(fixture, fixture.main)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('merge-translation-pairing.ts --probe failed')
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'core.hooksPath']).status).toBe(1)
    expect(gitResult(fixture, fixture.main, [
      'config', '--get', 'merge.dsh-translation-pairing.driver',
    ]).status).toBe(1)
  })

  it('reports installation and hook-path rollback failures together', async () => {
    const fixture = createFixture()

    const result = await runInstaller(fixture, fixture.main, {
      DSH_TEST_LEFTHOOK_BREAK_WORKTREE_CONFIG: '1',
      DSH_TEST_LEFTHOOK_FAIL: '1',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Lefthook installation failed')
    expect(result.stderr).toContain('exit status 77')
    expect(result.stderr).toContain('worktree integration rollback also failed')
    expect(result.stderr).toContain('git config --worktree --unset-all core.hooksPath failed')
    expect(result.stderr).toContain('git config --worktree --unset-all merge.dsh-translation-pairing.driver failed')
  })

  it('refuses an unowned directory at the reserved worktree hook path', async () => {
    const fixture = createFixture()
    const reservedHook = join(hooksPath(fixture, fixture.main), 'pre-commit')
    write(reservedHook, '#!/bin/sh\n# user content\n', 0o755)

    const result = await runInstaller(fixture, fixture.main)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('refusing to overwrite unowned hooks directory')
    expect(readFileSync(reservedHook, 'utf8')).toBe('#!/bin/sh\n# user content\n')
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'extensions.worktreeConfig']).status).toBe(1)
  })

  it.skipIf(process.platform === 'win32')('rejects Git without config-scope support before mutation', async () => {
    const fixture = createFixture()
    const realGit = commandResult('which', ['git'], fixture.main, fixture.env).stdout.trim()
    const fakeBin = join(fixture.container, 'fake-bin')
    const fakeGit = join(fakeBin, 'git')
    write(
      fakeGit,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version 2.25.0"; exit 0; fi\nexec "${realGit}" "$@"\n`,
      0o755,
    )

    const result = await runInstaller(fixture, fixture.main, {
      PATH: `${fakeBin}:${fixture.env.PATH ?? ''}`,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Git 2.26 or newer is required')
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'extensions.worktreeConfig']).status).toBe(1)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })
})
