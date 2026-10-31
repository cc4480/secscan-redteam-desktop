/**
 * Arsenal index store (spec §5, test points T6 + T7).
 *
 * Pins the generation swap protocol: a mid-build failure and a
 * priority-empty validation failure both leave the prior database
 * byte-identical and serving; a successful swap increments the generation
 * exactly once; an index written by newer code fails loud instead of
 * silently downgrading. Everything runs on temp dirs — no network, no
 * operator data home is ever touched.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import {
  ARSENAL_SCHEMA_VERSION,
  ArsenalValidationError,
  buildAndSwapArsenalIndex,
  openArsenalServingStore,
  readArsenalIndexMeta,
  type ArsenalBuildData,
} from '../src/arsenal/index-store.js'

let dir: string
let dbPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arsenal-store-'))
  dbPath = join(dir, 'arsenal', 'arsenal.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function sampleData(over: Partial<ArsenalBuildData> = {}): ArsenalBuildData {
  return {
    sourceRepo: 'https://github.com/hack-with-github/awesome-hacking.git',
    sourceCommit: '440486fd08b0a0d9ad9a041a0bb234dcdf65dee2',
    builtAt: '2026-10-31T00:00:00.000Z',
    collections: [
      {
        slug: 'seclists',
        name: 'SecLists',
        url: 'https://github.com/danielmiessler/SecLists',
        description: "The security tester's companion.",
        topic: 'Lists',
        fetchedAt: '2026-10-31T00:00:00.000Z',
        entryCount: 2,
        fetchError: null,
      },
      {
        slug: 'web-hacking',
        name: 'Web Hacking',
        url: 'https://example.test/web-hacking',
        description: '',
        topic: 'Web',
        fetchedAt: null,
        entryCount: 1,
        fetchError: null,
      },
    ],
    entries: [
      {
        name: 'Common Passwords',
        url: 'https://example.test/seclists/common-passwords',
        description: 'Password wordlists.',
        collectionSlug: 'seclists',
        tags: ['password'],
        targets: ['WA'],
        battery: [],
      },
      {
        name: 'DNS Subdomains',
        url: 'https://example.test/seclists/dns-subdomains',
        description: '',
        collectionSlug: 'seclists',
        tags: [],
        targets: [],
        battery: [],
      },
      {
        name: 'JWT Tool',
        url: 'https://example.test/web-hacking/jwt-tool',
        description: 'JSON Web Token attack toolkit.',
        collectionSlug: 'web-hacking',
        tags: ['jwt'],
        targets: ['WA'],
        battery: ['F-10'],
      },
    ],
    unparsedCount: 1,
    dupeCount: 2,
    prioritySlugs: ['seclists'],
    ...over,
  }
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('arsenal index store — swap protocol (T6)', () => {
  it('first build serves generation 1; a second build increments exactly once', () => {
    const first = buildAndSwapArsenalIndex(dbPath, sampleData())
    assert.equal(first.generation, 1)
    assert.equal(first.entryCount, 3)
    const meta1 = readArsenalIndexMeta(dbPath)
    assert.equal(meta1?.generation, 1)
    assert.equal(meta1?.entryCount, 3)
    assert.equal(meta1?.collectionCount, 2)
    assert.equal(meta1?.unparsedCount, 1)
    assert.equal(meta1?.dupeCount, 2)
    assert.equal(meta1?.schemaVersion, ARSENAL_SCHEMA_VERSION)

    const grown = sampleData()
    grown.entries = [
      ...grown.entries,
      {
        name: 'Fuzz Strings',
        url: 'https://example.test/seclists/fuzz-strings',
        description: '',
        collectionSlug: 'seclists',
        tags: [],
        targets: [],
        battery: [],
      },
    ]
    const second = buildAndSwapArsenalIndex(dbPath, grown)
    assert.equal(second.generation, 2)
    assert.equal(readArsenalIndexMeta(dbPath)?.generation, 2)
    assert.equal(readArsenalIndexMeta(dbPath)?.entryCount, 4)
  })

  it('an open serving store picks up the swapped generation without reopening by hand', () => {
    buildAndSwapArsenalIndex(dbPath, sampleData())
    const store = openArsenalServingStore(dbPath)
    assert.equal(store.current()?.meta.generation, 1)
    const grown = sampleData()
    grown.entries = grown.entries.slice(0, 1)
    grown.collections = grown.collections.map(c =>
      c.slug === 'seclists' ? { ...c, entryCount: 1 } : { ...c, entryCount: 0 },
    )
    buildAndSwapArsenalIndex(dbPath, grown, { releaseServing: () => store.close() })
    assert.equal(store.current()?.meta.generation, 2)
    assert.equal(store.current()?.meta.entryCount, 1)
    store.close()
  })

  it('a mid-build failure leaves the prior database byte-identical and serving', () => {
    buildAndSwapArsenalIndex(dbPath, sampleData())
    readArsenalIndexMeta(dbPath) // reach steady state before hashing
    const before = fileHash(dbPath)

    const broken = sampleData()
    broken.entries = [
      ...broken.entries,
      { ...broken.entries[0]! }, // duplicate normalized URL → UNIQUE violation mid-insert
    ]
    assert.throws(() => buildAndSwapArsenalIndex(dbPath, broken))

    assert.equal(fileHash(dbPath), before)
    assert.equal(readArsenalIndexMeta(dbPath)?.generation, 1)
    assert.equal(existsSync(`${dbPath}.tmp`), false)
    const store = openArsenalServingStore(dbPath)
    assert.equal(store.current()?.meta.generation, 1)
    store.close()
  })

  it('a priority collection with zero entries blocks the swap (validation)', () => {
    buildAndSwapArsenalIndex(dbPath, sampleData())
    readArsenalIndexMeta(dbPath)
    const before = fileHash(dbPath)

    const starved = sampleData()
    starved.entries = starved.entries.filter(e => e.collectionSlug !== 'seclists')
    assert.throws(() => buildAndSwapArsenalIndex(dbPath, starved), ArsenalValidationError)
    assert.equal(fileHash(dbPath), before)
    assert.equal(readArsenalIndexMeta(dbPath)?.generation, 1)
  })

  it('a priority collection missing from the build blocks the swap (validation)', () => {
    const data = sampleData({ prioritySlugs: ['seclists', 'gtfobins'] })
    assert.throws(() => buildAndSwapArsenalIndex(dbPath, data), ArsenalValidationError)
    assert.equal(existsSync(dbPath), false)
  })

  it('an empty generation never swaps in', () => {
    const data = sampleData({ entries: [], prioritySlugs: [] })
    assert.throws(() => buildAndSwapArsenalIndex(dbPath, data), ArsenalValidationError)
    assert.equal(existsSync(dbPath), false)
    assert.equal(readArsenalIndexMeta(dbPath), null)
  })
})

describe('arsenal index store — schema discipline (T7)', () => {
  it('no index yet: serving reads as null, not an error', () => {
    const store = openArsenalServingStore(dbPath)
    assert.equal(store.current(), null)
    assert.equal(store.meta(), null)
    store.close()
    assert.equal(readArsenalIndexMeta(dbPath), null)
  })

  it('a database written by newer code fails loud — serving, meta read, and rebuild all refuse', () => {
    buildAndSwapArsenalIndex(dbPath, sampleData())
    const db = new DatabaseSync(dbPath)
    db.prepare("UPDATE index_meta SET value = ? WHERE key = 'schema_version'").run(
      String(ARSENAL_SCHEMA_VERSION + 1),
    )
    db.close()

    assert.throws(() => readArsenalIndexMeta(dbPath), /newer than this code/)
    const store = openArsenalServingStore(dbPath)
    assert.throws(() => store.current(), /newer than this code/)
    store.close()
    // A rebuild must not silently overwrite the newer database either.
    assert.throws(() => buildAndSwapArsenalIndex(dbPath, sampleData()), /newer than this code/)
  })
})
