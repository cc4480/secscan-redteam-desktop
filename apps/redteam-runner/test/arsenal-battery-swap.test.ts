/**
 * ARS-9 acceptance battery — §6.1.7 swap integrity (spec T6).
 *
 * Two levels, both against REAL production code:
 *
 *   Store level — buildAndSwapArsenalIndex directly: a successful swap
 *   increments the generation EXACTLY once; an injected mid-build failure
 *   (duplicate URL hitting the UNIQUE constraint mid-insert) and both
 *   validation failures (priority-empty, priority-missing, empty
 *   generation) leave the prior database file BYTE-IDENTICAL (sha256) and
 *   still serving its generation.
 *
 *   Refresh level — runArsenalRefresh with its two published seams
 *   (RefreshDeps.git / RefreshDeps.buildIndex, refresh.ts) injected: the
 *   git runner is a stub (no network, no real clone), the build outcomes
 *   speak the documented seam contract. What is under test at this level
 *   is refresh's own orchestration: failure staging, exit codes, the
 *   "old generation still serving" report, and — with a buildIndex that
 *   performs the REAL store swap — that one refresh moves the serving
 *   generation by exactly one. The end-to-end default path (real clone +
 *   ingest's buildArsenalData) is PENDING-UPSTREAM on ARS-3's Step 6
 *   pipeline entry and is recorded as such in the crew log; nothing here
 *   pretends to cover it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildAndSwapArsenalIndex,
  openArsenalServingStore,
  readArsenalIndexMeta,
  type ArsenalBuildData,
} from '../src/arsenal/index-store.js'
import { runArsenalRefresh, type ArsenalBuildOutcome, type GitRunner } from '../src/arsenal/refresh.js'
import { resolveArsenalConfig } from '../src/arsenal/config.js'

const FAKE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

function makeData(patch: Partial<ArsenalBuildData> = {}): ArsenalBuildData {
  return {
    sourceRepo: 'https://github.com/hack-with-github/awesome-hacking.git',
    sourceCommit: FAKE_COMMIT,
    builtAt: '2026-10-31T00:00:00.000Z',
    collections: [
      {
        slug: 'seclists',
        name: 'SecLists',
        url: 'https://example.test/repos/seclists',
        description: 'Security tester companion list collection',
        topic: 'Wordlists',
        fetchedAt: '2026-10-31T00:00:00.000Z',
        entryCount: 3,
        fetchError: null,
      },
      {
        slug: 'awesome-osint',
        name: 'Awesome OSINT',
        url: 'https://example.test/repos/awesome-osint',
        description: 'OSINT resource list, Level 1 only',
        topic: 'OSINT',
        fetchedAt: null,
        entryCount: 0,
        fetchError: null,
      },
    ],
    entries: [
      {
        name: 'JWT Wordlist',
        url: 'https://example.test/seclists/jwt-wordlist',
        description: 'Curated passwords and tokens for JSON Web Token brute force attacks',
        collectionSlug: 'seclists',
        tags: ['topic:wordlists'],
        targets: ['WA'],
        battery: ['F-10'],
      },
      {
        name: 'Password Collection',
        url: 'https://example.test/seclists/passwords',
        description: 'A wordlist of common passwords for credential testing',
        collectionSlug: 'seclists',
        tags: ['topic:wordlists'],
        targets: ['WA'],
        battery: [],
      },
      {
        name: 'Fuzzing Strings',
        url: 'https://example.test/seclists/fuzzing',
        description: 'Strings that break parsers',
        collectionSlug: 'seclists',
        tags: ['topic:wordlists'],
        targets: ['WA'],
        battery: [],
      },
    ],
    unparsedCount: 0,
    dupeCount: 0,
    prioritySlugs: ['seclists'],
    ...patch,
  }
}

function tempDb(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'arsenal-battery-swap-'))
  return { dir, dbPath: join(dir, 'arsenal', 'arsenal.db') }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Seed a serving generation 1 and return its file hash. */
function seed(dbPath: string): string {
  const swapped = buildAndSwapArsenalIndex(dbPath, makeData())
  assert.equal(swapped.generation, 1, 'seed build must produce generation 1')
  return sha256(dbPath)
}

function assertStillServing(dbPath: string, generation: number): void {
  const meta = readArsenalIndexMeta(dbPath)
  assert.ok(meta, 'the prior index must still be readable after a failed swap')
  assert.equal(meta.generation, generation, 'the serving generation must be unchanged')
  const store = openArsenalServingStore(dbPath)
  try {
    const current = store.current()
    assert.ok(current, 'the serving store must still open the prior generation')
    assert.equal(current.meta.generation, generation)
    const row = current.db
      .prepare('SELECT name FROM entries WHERE name = ?')
      .get('JWT Wordlist') as { name?: string } | undefined
    assert.equal(row?.name, 'JWT Wordlist', "the prior generation's content must still be served")
  } finally {
    store.close()
  }
}

describe('§6.1.7 swap integrity — store level (spec T6)', () => {
  it('a successful swap increments the generation exactly once, per swap', () => {
    const { dir, dbPath } = tempDb()
    try {
      seed(dbPath)
      const second = buildAndSwapArsenalIndex(dbPath, makeData({ builtAt: '2026-10-31T01:00:00.000Z' }))
      assert.equal(second.generation, 2, 'second swap must land on generation 2 — exactly +1')
      const third = buildAndSwapArsenalIndex(dbPath, makeData({ builtAt: '2026-10-31T02:00:00.000Z' }))
      assert.equal(third.generation, 3, 'third swap must land on generation 3 — exactly +1 again')
      assert.equal(readArsenalIndexMeta(dbPath)?.generation, 3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an injected mid-build failure leaves the prior DB byte-identical and serving', () => {
    const { dir, dbPath } = tempDb()
    try {
      const before = seed(dbPath)
      const dupe = makeData()
      // A second entry reusing an earlier URL trips the UNIQUE constraint
      // mid-insert — the build dies with rows already written to the tmp DB.
      dupe.entries = [
        ...dupe.entries,
        { ...dupe.entries[0]!, name: 'JWT Wordlist Again' },
      ]
      assert.throws(() => buildAndSwapArsenalIndex(dbPath, dupe), 'the duplicate-URL build must throw')
      assert.equal(sha256(dbPath), before, 'the serving DB file must be byte-identical after a mid-build failure')
      assertStillServing(dbPath, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a priority-empty validation failure leaves the prior DB byte-identical and serving', () => {
    const { dir, dbPath } = tempDb()
    try {
      const before = seed(dbPath)
      const empty = makeData()
      empty.entries = empty.entries.map(e => ({ ...e, collectionSlug: 'awesome-osint', url: `${e.url}-moved` }))
      empty.collections = empty.collections.map(c =>
        c.slug === 'seclists' ? { ...c, entryCount: 0 } : { ...c, entryCount: 3 },
      )
      assert.throws(
        () => buildAndSwapArsenalIndex(dbPath, empty),
        (err: unknown) => err instanceof Error && err.name === 'ArsenalValidationError',
        'a priority collection with zero entries must fail validation by name',
      )
      assert.equal(sha256(dbPath), before, 'the serving DB file must be byte-identical after a validation failure')
      assertStillServing(dbPath, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a priority-missing validation failure leaves the prior DB byte-identical and serving', () => {
    const { dir, dbPath } = tempDb()
    try {
      const before = seed(dbPath)
      const missing = makeData({ prioritySlugs: ['seclists', 'no-such-collection'] })
      assert.throws(
        () => buildAndSwapArsenalIndex(dbPath, missing),
        (err: unknown) => err instanceof Error && err.name === 'ArsenalValidationError',
        'a missing priority collection must fail validation by name',
      )
      assert.equal(sha256(dbPath), before)
      assertStillServing(dbPath, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an empty generation never swaps in', () => {
    const { dir, dbPath } = tempDb()
    try {
      const before = seed(dbPath)
      const empty = makeData({ entries: [], prioritySlugs: [] })
      empty.collections = empty.collections.map(c => ({ ...c, entryCount: 0 }))
      assert.throws(
        () => buildAndSwapArsenalIndex(dbPath, empty),
        (err: unknown) => err instanceof Error && err.name === 'ArsenalValidationError',
        'a zero-entry generation must fail validation by name',
      )
      assert.equal(sha256(dbPath), before)
      assertStillServing(dbPath, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('§6.1.7 swap integrity — refresh level (kill mid-refresh)', () => {
  function fakeGit(sourceRepo: string): GitRunner {
    return async (args) => {
      const joined = args.join(' ')
      if (joined.includes('remote')) return { code: 0, stdout: `${sourceRepo}\n`, stderr: '' }
      if (joined.includes('rev-parse')) return { code: 0, stdout: `${FAKE_COMMIT}\n`, stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
  }

  it('a build that dies mid-refresh leaves the prior DB byte-identical, still serving, and the report says so', async () => {
    const { dir, dbPath } = tempDb()
    try {
      const before = seed(dbPath)
      const config = resolveArsenalConfig({ REDTEAM_ARSENAL_DB_PATH: dbPath })
      const report = await runArsenalRefresh({
        config,
        deps: {
          git: fakeGit(config.sourceRepo),
          buildIndex: async () => {
            throw new Error('kill mid-refresh (battery injection)')
          },
        },
      })
      assert.equal(report.ok, false)
      assert.equal(report.exitCode, 1)
      assert.equal(report.stage, 'build')
      assert.ok(
        report.lines.some(l => l.includes('old generation still serving')),
        'the refresh output must say the old generation is still serving',
      )
      assert.equal(sha256(dbPath), before, 'the serving DB file must be byte-identical after a killed refresh')
      assertStillServing(dbPath, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a validation-failure outcome is reported, not swapped, and the DB is untouched', async () => {
    const { dir, dbPath } = tempDb()
    try {
      const before = seed(dbPath)
      const config = resolveArsenalConfig({ REDTEAM_ARSENAL_DB_PATH: dbPath })
      // The documented RefreshDeps outcome for a validation failure (the
      // store has already refused the swap): ok:false + failureReasons.
      const outcome: ArsenalBuildOutcome = {
        ok: false,
        generation: 1,
        entryCount: 3,
        collectionCount: 2,
        collectionsOk: 2,
        collectionsFailed: 0,
        unparsedCount: 0,
        dupeCount: 0,
        priority: [{ slug: 'seclists', entryCount: 0 }],
        failureReasons: ['[arsenal] index validation failed: priority collection "seclists" has 0 entries'],
      }
      const report = await runArsenalRefresh({
        config,
        deps: { git: fakeGit(config.sourceRepo), buildIndex: async () => outcome },
      })
      assert.equal(report.ok, false)
      assert.equal(report.exitCode, 1)
      assert.ok(
        report.lines.some(l => l.includes('validation')),
        'the refresh output must carry the validation failure',
      )
      assert.ok(report.lines.some(l => l.includes('old generation still serving')))
      assert.equal(sha256(dbPath), before)
      assertStillServing(dbPath, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a successful refresh moves the serving generation by exactly one', async () => {
    const { dir, dbPath } = tempDb()
    try {
      seed(dbPath)
      const config = resolveArsenalConfig({ REDTEAM_ARSENAL_DB_PATH: dbPath })
      const report = await runArsenalRefresh({
        config,
        deps: {
          git: fakeGit(config.sourceRepo),
          buildIndex: async () => {
            // The REAL store swap, driven through the refresh seam.
            const swapped = buildAndSwapArsenalIndex(dbPath, makeData({ builtAt: '2026-10-31T03:00:00.000Z' }))
            return {
              ok: true,
              generation: swapped.generation,
              entryCount: swapped.entryCount,
              collectionCount: 2,
              collectionsOk: 2,
              collectionsFailed: 0,
              unparsedCount: 0,
              dupeCount: 0,
              priority: [{ slug: 'seclists', entryCount: 3 }],
              failureReasons: [],
            } satisfies ArsenalBuildOutcome
          },
        },
      })
      assert.equal(report.ok, true)
      assert.equal(report.exitCode, 0)
      assert.equal(report.build?.generation, 2)
      assert.equal(
        readArsenalIndexMeta(dbPath)?.generation,
        2,
        'one successful refresh must move the serving generation exactly +1',
      )
      assert.ok(
        report.lines.some(l => l.includes('generation 2')),
        'the refresh summary must name the new generation',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
