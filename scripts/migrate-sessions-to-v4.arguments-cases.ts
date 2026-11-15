/** Command-surface cases: torn tails, unsupported layouts, help, and argument validation. */

import { existsSync } from 'node:fs'
import { readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixture, repository, run, runAt, temporaryRoot } from './migrate-sessions-to-v4.spec-helpers.ts'

describe('one-time V4 migration command', () => {
  it('opens an existing V4 torn tail without repairing its bytes', async () => {
    const root = temporaryRoot()
    const current = await fixture(root, 'current', 4, 'none')
    const torn = Buffer.concat([current.bytes, Buffer.from('{"unfinished"')])
    await writeFile(current.path, torn)
    const result = await run('--sessions-dir', root)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('already V4 (opened successfully)')
    expect(await readFile(current.path)).toEqual(torn)
  })

  it('reports unsupported root-level logs and does not traverse directory links', async () => {
    const root = temporaryRoot()
    const outside = temporaryRoot()
    const original = await fixture(outside, 'outside', 3, 'none')
    await writeFile(join(root, 'legacy.jsonl'), original.bytes)
    await symlink(outside, join(root, 'linked-project'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = await run('--sessions-dir', root)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('unsupported flat-file layout')
    expect(result.stdout).toContain('project symbolic links are not traversed')
    expect(existsSync(join(original.directory, 'session.v4.jsonl'))).toBe(false)
  })

  it('shows help, rejects unknown arguments, and logs a missing root failure', async () => {
    const help = await run('--help')
    expect(help.stdout).toContain('Defaults to ~/.dsh/sessions')
    expect(help.stdout).toContain('CPU count capped at 16')
    expect((await run('--unknown')).status).toBe(1)
    const missing = join(temporaryRoot(), 'missing')
    const result = await run('--sessions-dir', missing)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('converted=0, already-V4=0, failed=1, skipped=0')
    expect(result.logPath).toBeDefined()
    expect(result.summary).toMatchObject({
      inputCount: 0,
      totals: { converted: 0, alreadyV4: 0, failed: 1, skipped: 0 },
      bySourceVersion: { unknown: { converted: 0, alreadyV4: 0, failed: 1, skipped: 0 } },
      failureGroups: [{ sourceVersion: 'unknown', count: 1, items: [{ inputPath: missing }] }],
    })
  })

  it.each(['32', '1e2', '+1', '01', ' 1'])('accepts positive safe-integer --jobs %s', async (jobs) => {
    const result = await run('--sessions-dir', temporaryRoot(), '--jobs', jobs)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain(`Session jobs: ${Number(jobs)}`)
    expect(result.stdout).toContain('converted=0, already-V4=0, failed=0, skipped=0')
    expect(result.summary).toMatchObject({
      inputCount: 0,
      totals: { converted: 0, alreadyV4: 0, failed: 0, skipped: 0 },
      bySourceVersion: {},
      failureGroups: [],
    })
  })

  it('runs the entrypoint through a symbolic link to the checkout', async () => {
    const checkout = join(temporaryRoot(), 'checkout')
    await symlink(repository, checkout, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      const result = await runAt(join(checkout, 'scripts/migrate-sessions-to-v4.ts'), '--help')
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('Usage: pnpm run migrate:sessions-to-v4')
    } finally {
      await unlink(checkout)
    }
  })

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])('rejects invalid --jobs %s before opening a corpus', async (jobs) => {
    const result = await run('--sessions-dir', join(temporaryRoot(), 'missing'), `--jobs=${jobs}`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--jobs must be a positive safe integer')
    expect(result.stdout).not.toContain('Session migration')
    expect(result.logPath).toBeUndefined()
  })
})
