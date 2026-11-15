/** Installer lock records, including stale and invalid records left for recovery. */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
  createFixture,
  git,
  gitResult,
  hooksPath,
  installLockPath,
  installerSuite,
  runInstaller,
} from './install-lefthook.fixtures.ts'

installerSuite(() => {
  it('leaves stale installer locks for explicit recovery', async () => {
    const fixture = createFixture()
    const lockPath = installLockPath(fixture)
    const completed = spawnSync(process.execPath, ['-e', ''])
    expect(completed.status).toBe(0)
    const staleRecord = `${String(completed.pid)} 00000000-0000-4000-8000-000000000000\n`
    writeFileSync(lockPath, staleRecord)

    const results = await Promise.all(Array.from(
      { length: 4 },
      () => runInstaller(fixture, fixture.main),
    ))

    for (const result of results) {
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('stale Lefthook installer lock')
      expect(result.stderr).toContain('remove it manually')
    }
    expect(readFileSync(lockPath, 'utf8')).toBe(staleRecord)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
    expect(gitResult(fixture, fixture.main, ['config', '--get', 'extensions.worktreeConfig']).status).toBe(1)
  })

  it('leaves invalid installer locks for explicit recovery', async () => {
    const fixture = createFixture()
    const lockPath = installLockPath(fixture)
    const invalidRecord = 'not an installer lock\n'
    writeFileSync(lockPath, invalidRecord)

    const result = await runInstaller(fixture, fixture.main)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid Lefthook installer lock')
    expect(result.stderr).toContain('remove it manually')
    expect(readFileSync(lockPath, 'utf8')).toBe(invalidRecord)
    expect(existsSync(hooksPath(fixture, fixture.main))).toBe(false)
  })

  it('does not release an installer lock whose ownership changed', async () => {
    const fixture = createFixture()
    const lockPath = installLockPath(fixture)
    // The fake child replaces the record while the installer holds the lock.
    const result = await runInstaller(fixture, fixture.main, {
      DSH_TEST_LEFTHOOK_REPLACE_LOCK_PATH: lockPath,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('installer lock ownership changed')
    expect(readFileSync(lockPath, 'utf8')).toBe('replacement owner\n')
  })

  it.skipIf(process.platform === 'win32')('preserves trailing spaces in worktree paths', async () => {
    const fixture = createFixture({ main: 'main ', linked: 'linked ' })

    for (const root of [fixture.main, fixture.linked]) {
      const result = await runInstaller(fixture, root)
      expect(result.status, result.stderr).toBe(0)
      expect(git(fixture, root, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(hooksPath(fixture, root))
    }
  })
})
