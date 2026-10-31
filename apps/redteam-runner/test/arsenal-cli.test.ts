/**
 * `redteam-runner arsenal` CLI handler (ARS-8, spec §9).
 *
 * Pins the operator surface's exit codes: usage errors and a
 * misconfigured REDTEAM_ARSENAL_* variable exit 2 before any refresh
 * is attempted; a refresh attempt adopts the refresh report's exit
 * code (0 = new generation swapped in, 1 = failed with the old
 * generation still serving). Git and build seams are stubbed — no
 * network, no real clone, no operator data home.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runArsenalCli } from '../src/cli/arsenal.js'
import { DEFAULT_ARSENAL_SOURCE_REPO } from '../src/arsenal/config.js'
import type { ArsenalBuildOutcome, GitRunner } from '../src/arsenal/refresh.js'

const FAKE_COMMIT = '440486fd08b0a0d9ad9a041a0bb234dcdf65dee2'

/** Run `fn` with console output captured (the CLI prints its summary). */
async function captured(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = []
  const origLog = console.log
  const origError = console.error
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  try {
    const code = await fn()
    return { code, out: lines.join('\n') }
  } finally {
    console.log = origLog
    console.error = origError
  }
}

function fakeGit(sourceRepo: string): GitRunner {
  return async (args) => {
    const joined = args.join(' ')
    if (joined.includes('remote')) return { code: 0, stdout: `${sourceRepo}\n`, stderr: '' }
    if (joined.includes('rev-parse')) return { code: 0, stdout: `${FAKE_COMMIT}\n`, stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
}

function buildOutcome(over: Partial<ArsenalBuildOutcome> = {}): ArsenalBuildOutcome {
  return {
    ok: true,
    generation: 1,
    entryCount: 3,
    collectionCount: 2,
    collectionsOk: 2,
    collectionsFailed: 0,
    unparsedCount: 0,
    dupeCount: 0,
    priority: [{ slug: 'seclists', entryCount: 2 }],
    failureReasons: [],
    ...over,
  }
}

describe('arsenal CLI (ARS-8)', () => {
  it('usage errors exit 2 and attempt no refresh', async () => {
    for (const argv of [[], ['bogus'], ['refresh', '--bogus-flag']]) {
      const { code, out } = await captured(() => runArsenalCli(argv, {} as NodeJS.ProcessEnv))
      assert.equal(code, 2, `argv ${JSON.stringify(argv)} must exit 2`)
      assert.match(out, /usage: redteam-runner arsenal refresh/)
    }
  })

  it('a misconfigured REDTEAM_ARSENAL_* variable exits 2 naming the variable', async () => {
    const env = { REDTEAM_ARSENAL_ENABLED: 'yes' } as NodeJS.ProcessEnv
    const { code, out } = await captured(() => runArsenalCli(['refresh'], env))
    assert.equal(code, 2)
    assert.match(out, /REDTEAM_ARSENAL_ENABLED/)
  })

  it('refresh success adopts exit 0 and prints the generation summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arsenal-cli-'))
    const dbPath = join(dir, 'arsenal', 'arsenal.db')
    const env = { REDTEAM_ARSENAL_DB_PATH: dbPath } as NodeJS.ProcessEnv
    try {
      // A present cache clone: refresh takes the verify + pull path.
      mkdirSync(join(dir, 'arsenal', 'cache', 'awesome-hacking', '.git'), { recursive: true })
      const deps = { git: fakeGit(DEFAULT_ARSENAL_SOURCE_REPO), buildIndex: async () => buildOutcome() }
      const plain = await captured(() => runArsenalCli(['refresh'], env, deps))
      assert.equal(plain.code, 0)
      assert.match(plain.out, /arsenal refresh: generation 1 built/)
      const forced = await captured(() => runArsenalCli(['refresh', '--force-clone'], env, deps))
      assert.equal(forced.code, 0)
      assert.match(forced.out, /--force-clone discarded the cache/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a failed refresh adopts exit 1 and the output keeps the old generation serving', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arsenal-cli-'))
    const dbPath = join(dir, 'arsenal', 'arsenal.db')
    const env = { REDTEAM_ARSENAL_DB_PATH: dbPath } as NodeJS.ProcessEnv
    try {
      mkdirSync(join(dir, 'arsenal', 'cache', 'awesome-hacking', '.git'), { recursive: true })
      const deps = {
        git: fakeGit(DEFAULT_ARSENAL_SOURCE_REPO),
        buildIndex: async () =>
          buildOutcome({ ok: false, generation: 0, entryCount: 0, failureReasons: ['priority collection seclists is empty'] }),
      }
      const { code, out } = await captured(() => runArsenalCli(['refresh'], env, deps))
      assert.equal(code, 1)
      assert.match(out, /old generation still serving/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
