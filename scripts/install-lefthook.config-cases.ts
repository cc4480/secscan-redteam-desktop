/** Included Git config, command-scoped overrides, and the pairing merge driver. */

import { existsSync, readFileSync } from 'node:fs'
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
  for (const includeKey of ['include.path', 'includeIf.onbranch:conditional.path']) {
    for (const key of ['core.worktree', 'core.bare', 'extensions.dshunknown']) {
      it(`ignores ${key} loaded through ${includeKey}`, async () => {
        const fixture = createFixture()
        const commonConfig = join(commonDirectory(fixture), 'config')
        const includedConfig = join(fixture.container, `${includeKey.split('.')[0]}-${key.replace('.', '-')}.gitconfig`)
        const value = key === 'core.worktree' ? fixture.main : 'true'
        git(fixture, fixture.main, ['config', '--file', includedConfig, key, value])
        git(fixture, fixture.main, ['config', '--file', commonConfig, includeKey, includedConfig])

        const result = await runInstaller(fixture, fixture.linked)

        expect(result.status, result.stderr).toBe(0)
        expect(git(fixture, fixture.linked, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(
          hooksPath(fixture, fixture.linked),
        )
        expect(existsSync(join(hooksPath(fixture, fixture.linked), 'pre-commit'))).toBe(true)
      })
    }
  }

  it('ignores an inactive global includeIf that provides a hook path for another repository', async () => {
    const fixture = createFixture()
    const globalConfig = fixture.env.GIT_CONFIG_GLOBAL
    if (globalConfig === undefined) throw new Error('fixture global config path is missing')
    const includedConfig = join(fixture.container, 'other-repository.gitconfig')
    const includedHooks = join(fixture.container, 'other-repository-hooks')
    git(fixture, fixture.main, ['config', '--file', includedConfig, 'core.hooksPath', includedHooks])
    git(fixture, fixture.main, [
      'config',
      '--file',
      globalConfig,
      `includeIf.gitdir:${join(fixture.container, 'other')}/.path`,
      includedConfig,
    ])

    const result = await runInstaller(fixture, fixture.linked)

    expect(result.status, result.stderr).toBe(0)
    expect(git(fixture, fixture.linked, ['config', '--get', 'core.hooksPath'])).toBe(hooksPath(fixture, fixture.linked))
  })

  it('never overrides a command-scoped hook path', async () => {
    const fixture = createFixture()
    const commandHooks = join(fixture.container, 'command-hooks')
    const sentinel = join(commandHooks, 'pre-commit')
    write(sentinel, '#!/bin/sh\n# command-scope sentinel\n', 0o755)

    const result = await runInstaller(fixture, fixture.main, {
      DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: commandHooks,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('command-scoped core.hooksPath')
    expect(readFileSync(sentinel, 'utf8')).toBe('#!/bin/sh\n# command-scope sentinel\n')
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'core.hooksPath']).status).toBe(1)
    expect(gitResult(fixture, fixture.main, [
      'config', '--get', 'merge.dsh-translation-pairing.driver',
    ]).status).toBe(1)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })

  it('never replaces a custom worktree pairing merge driver', async () => {
    const fixture = createFixture()
    const commonConfig = join(commonDirectory(fixture), 'config')
    git(fixture, fixture.main, ['config', '--file', commonConfig, 'core.repositoryFormatVersion', '1'])
    git(fixture, fixture.main, ['config', '--file', commonConfig, 'extensions.worktreeConfig', 'true'])
    git(fixture, fixture.main, [
      'config', '--worktree', 'merge.dsh-translation-pairing.driver', 'custom-driver %A',
    ])

    const result = await runInstaller(fixture, fixture.main)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('refusing to replace worktree merge.dsh-translation-pairing.driver')
    expect(git(fixture, fixture.main, [
      'config', '--worktree', '--get', 'merge.dsh-translation-pairing.driver',
    ])).toBe('custom-driver %A')
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'core.hooksPath']).status).toBe(1)
  })

  it('never masks an inherited custom pairing merge driver', async () => {
    const fixture = createFixture()
    git(fixture, fixture.main, [
      'config', '--local', 'merge.dsh-translation-pairing.driver', 'inherited-driver %A',
    ])

    const result = await runInstaller(fixture, fixture.main)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('refusing to mask inherited merge.dsh-translation-pairing.driver')
    expect(git(fixture, fixture.main, [
      'config', '--local', '--get', 'merge.dsh-translation-pairing.driver',
    ])).toBe('inherited-driver %A')
    expect(gitResult(fixture, fixture.main, [
      'config', '--worktree', '--get', 'merge.dsh-translation-pairing.driver',
    ]).status).toBe(1)
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'core.hooksPath']).status).toBe(1)
  })

  it('does not pass unrelated command-scoped Git config to Lefthook', async () => {
    const fixture = createFixture()

    const result = await runInstaller(fixture, fixture.main, {
      DSH_TEST_FORBIDDEN_GIT_CONFIG_KEY: 'dsh.testSentinel',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'dsh.testSentinel',
      GIT_CONFIG_VALUE_0: 'must-not-reach-lefthook',
    })

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(hooksPath(fixture, fixture.main), 'pre-commit'))).toBe(true)
  })
})
