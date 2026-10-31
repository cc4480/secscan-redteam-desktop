/**
 * Arsenal read-path tools (spec §7, test points T5 + T9 + T10 + T11).
 *
 * The three tools (`arsenal_search`, `arsenal_browse`, `arsenal_recommend`)
 * are exercised directly against a fixture index built through the store's
 * own `buildAndSwapArsenalIndex` — no private DDL, no network. Pins: the
 * FTS sanitizer keeps operator text inert (T5), search filters/ranks and
 * reports the pre-limit total (T9), identical calls on a fixed generation
 * answer byte-identically and `recommend` explains itself with the
 * rule-derived facets (T10), and an empty index is the typed
 * ARSENAL_INDEX_EMPTY result from every tool (T11).
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildAndSwapArsenalIndex,
  type ArsenalBuildData,
} from '../src/arsenal/index-store.js'
import {
  ARSENAL_EMPTY_FIX,
  ARSENAL_TOOLS,
  ARSENAL_TOOLS_BY_NAME,
  buildArsenalFtsMatch,
  buildArsenalFtsMatchAny,
  arsenalFtsTerms,
} from '../src/arsenal/tools.js'

const BUILT_AT = '2026-10-31T12:00:00.000Z'
const SOURCE_COMMIT = 'fixturecommit123'
const LONG_DESCRIPTION = 'wordlist ' + 'usernames '.repeat(40)

interface IndexStamp {
  generation: number
  built_at: string
  source_commit: string
}

interface ResultItem {
  name: string
  url: string
  description: string
  description_truncated: boolean
  collection: string
  tags: string[]
  targets: string[]
  battery: string[]
  why?: string[]
}

interface SearchEnvelope {
  results: ResultItem[]
  total: number
  index: IndexStamp
}

let dir: string
let dbPath: string
let savedDbPath: string | undefined

function fixtureData(): ArsenalBuildData {
  return {
    sourceRepo: 'https://example.invalid/awesome-hacking.git',
    sourceCommit: SOURCE_COMMIT,
    builtAt: BUILT_AT,
    unparsedCount: 0,
    dupeCount: 0,
    prioritySlugs: ['seclists', 'payloadsallthethings', 'gtfobins'],
    collections: [
      {
        slug: 'seclists',
        name: 'SecLists',
        url: 'https://example.invalid/seclists',
        description: 'Wordlists for testing.',
        topic: 'Wordlists',
        fetchedAt: BUILT_AT,
        entryCount: 3,
        fetchError: null,
      },
      {
        slug: 'payloadsallthethings',
        name: 'PayloadsAllTheThings',
        url: 'https://example.invalid/payloadsallthethings',
        description: 'Payloads and bypasses.',
        topic: 'Web Hacking',
        fetchedAt: BUILT_AT,
        entryCount: 2,
        fetchError: null,
      },
      {
        slug: 'gtfobins',
        name: 'GTFOBins',
        url: 'https://example.invalid/gtfobins',
        description: 'Unix binaries that bypass restrictions.',
        topic: 'Privilege Escalation',
        fetchedAt: BUILT_AT,
        entryCount: 1,
        fetchError: null,
      },
      {
        slug: 'awesome-osint',
        name: 'Awesome OSINT',
        url: 'https://example.invalid/awesome-osint',
        description: 'OSINT resources, Level 1 only.',
        topic: 'OSINT',
        fetchedAt: null,
        entryCount: 0,
        fetchError: null,
      },
    ],
    entries: [
      {
        name: 'JWT Wordlist',
        url: 'https://example.invalid/seclists/jwt-wordlist',
        description:
          'Wordlist of common JWT secrets for token forgery tests.',
        collectionSlug: 'seclists',
        tags: ['topic:wordlists', 'collection:seclists', 'wordlist'],
        targets: ['WA'],
        battery: ['F-10', 'functionality'],
      },
      {
        name: 'Password Collection',
        url: 'https://example.invalid/seclists/password-collection',
        description: 'Large password wordlist for credential testing.',
        collectionSlug: 'seclists',
        tags: ['topic:wordlists', 'collection:seclists', 'wordlist'],
        targets: ['WA', 'SS'],
        battery: ['functionality'],
      },
      {
        name: 'Comprehensive Username List',
        url: 'https://example.invalid/seclists/usernames',
        description: LONG_DESCRIPTION,
        collectionSlug: 'seclists',
        tags: ['topic:wordlists', 'collection:seclists', 'wordlist'],
        targets: ['WA'],
        battery: [],
      },
      {
        name: 'SSRF Payloads',
        url: 'https://example.invalid/payloadsallthethings/ssrf',
        description:
          'Server-side request forgery payloads for internal service probing.',
        collectionSlug: 'payloadsallthethings',
        tags: ['topic:web-hacking', 'collection:payloadsallthethings', 'payloads'],
        targets: ['WA'],
        battery: ['F-9'],
      },
      {
        name: 'IDOR Examples',
        url: 'https://example.invalid/payloadsallthethings/idor',
        description:
          'Insecure direct object reference examples and test cases.',
        collectionSlug: 'payloadsallthethings',
        tags: ['topic:web-hacking', 'collection:payloadsallthethings'],
        targets: ['WA'],
        battery: ['F-1'],
      },
      {
        name: 'sudo',
        url: 'https://example.invalid/gtfobins/sudo',
        description: 'sudo binary techniques for privilege escalation on Linux.',
        collectionSlug: 'gtfobins',
        tags: ['topic:privilege-escalation', 'collection:gtfobins'],
        targets: ['LX'],
        battery: [],
      },
    ],
  }
}

function tool(name: string) {
  const found = ARSENAL_TOOLS_BY_NAME.get(name)
  assert.ok(found, `tool ${name} registered`)
  return found
}

async function search(args: Record<string, unknown>): Promise<SearchEnvelope> {
  return JSON.parse(await tool('arsenal_search').run(args)) as SearchEnvelope
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'arsenal-tools-'))
  dbPath = join(dir, 'arsenal.db')
  savedDbPath = process.env['REDTEAM_ARSENAL_DB_PATH']
  const built = buildAndSwapArsenalIndex(dbPath, fixtureData())
  assert.equal(built.generation, 1)
  assert.equal(built.entryCount, 6)
  process.env['REDTEAM_ARSENAL_DB_PATH'] = dbPath
})

after(() => {
  if (savedDbPath === undefined) delete process.env['REDTEAM_ARSENAL_DB_PATH']
  else process.env['REDTEAM_ARSENAL_DB_PATH'] = savedDbPath
  rmSync(dir, { recursive: true, force: true })
})

describe('surface', () => {
  it('registers exactly the three read-path tools, schemas closed', () => {
    assert.deepEqual(
      ARSENAL_TOOLS.map(t => t.name),
      ['arsenal_search', 'arsenal_browse', 'arsenal_recommend'],
    )
    assert.equal(ARSENAL_TOOLS_BY_NAME.size, 3)
    for (const t of ARSENAL_TOOLS) {
      assert.equal(t.inputSchema['additionalProperties'], false, t.name)
      assert.equal(ARSENAL_TOOLS_BY_NAME.get(t.name), t)
    }
    assert.deepEqual(ARSENAL_TOOLS[0]?.inputSchema['required'], ['query'])
    assert.deepEqual(ARSENAL_TOOLS[2]?.inputSchema['required'], ['task'])
  })
})

describe('T5 — FTS sanitizer keeps operator text inert', () => {
  it('quotes every term and ANDs them for search', () => {
    assert.equal(buildArsenalFtsMatch('jwt'), '"jwt"')
    assert.equal(buildArsenalFtsMatch('  jwt   secrets '), '"jwt" AND "secrets"')
    assert.equal(buildArsenalFtsMatch('OR'), '"OR"')
    assert.equal(buildArsenalFtsMatch('NEAR('), '"NEAR("')
    assert.equal(buildArsenalFtsMatch('foo * bar'), '"foo" AND "*" AND "bar"')
  })

  it('escapes embedded quotes by doubling', () => {
    assert.equal(buildArsenalFtsMatch('a"b'), '"a""b"')
  })

  it('maps NUL to U+FFFD before it can reach MATCH', () => {
    assert.equal(buildArsenalFtsMatch('a\0b'), '"a\uFFFDb"')
    assert.deepEqual(arsenalFtsTerms(''), [])
  })

  it('recommend joins the same literal terms with OR', () => {
    assert.equal(buildArsenalFtsMatchAny('jwt ssrf'), '"jwt" OR "ssrf"')
  })

  it('an operator-laden query is a literal search, not a syntax error', async () => {
    const env = await search({ query: '" OR * NEAR(' })
    assert.equal(env.total, 0)
    assert.deepEqual(env.results, [])
  })
})

describe('T9 — search over the fixture index', () => {
  it('finds the JWT row and stamps the envelope with the generation', async () => {
    const env = await search({ query: 'JWT' })
    assert.equal(env.total, 1)
    assert.equal(env.results[0]?.name, 'JWT Wordlist')
    assert.equal(env.results[0]?.collection, 'seclists')
    assert.deepEqual(env.results[0]?.battery, ['F-10', 'functionality'])
    assert.equal(env.index.generation, 1)
    assert.equal(env.index.built_at, BUILT_AT)
    assert.equal(env.index.source_commit, SOURCE_COMMIT)
  })

  it('ranks a name hit first and reports the pre-limit total', async () => {
    const all = await search({ query: 'wordlist' })
    assert.equal(all.total, 3)
    assert.equal(all.results[0]?.name, 'JWT Wordlist')
    const page = await search({ query: 'wordlist', limit: 2 })
    assert.equal(page.total, 3)
    assert.equal(page.results.length, 2)
    const clamped = await search({ query: 'wordlist', limit: 500 })
    assert.equal(clamped.results.length, 3)
  })

  it('truncates long descriptions at 280 chars and flags it', async () => {
    const env = await search({ query: 'wordlist' })
    const long = env.results.find(r => r.name === 'Comprehensive Username List')
    assert.ok(long)
    assert.equal(long.description.length, 280)
    assert.equal(long.description_truncated, true)
    const short = env.results.find(r => r.name === 'JWT Wordlist')
    assert.equal(short?.description_truncated, false)
  })

  it('filters by target facet, excluding non-matching rows', async () => {
    const lx = await search({ query: 'sudo', target: 'LX' })
    assert.equal(lx.total, 1)
    assert.equal(lx.results[0]?.name, 'sudo')
    const none = await search({ query: 'wordlist', target: 'LX' })
    assert.equal(none.total, 0)
    assert.deepEqual(none.results, [])
  })

  it('filters by battery item id', async () => {
    const ssrf = await search({ query: 'payloads', battery: 'F-9' })
    assert.equal(ssrf.total, 1)
    assert.equal(ssrf.results[0]?.name, 'SSRF Payloads')
    const idor = await search({ query: 'examples', battery: 'F-1' })
    assert.equal(idor.total, 1)
    assert.equal(idor.results[0]?.name, 'IDOR Examples')
  })

  it('filters by category as slug or topic; unknown category is an empty envelope', async () => {
    assert.equal((await search({ query: 'wordlist', category: 'seclists' })).total, 3)
    assert.equal((await search({ query: 'wordlist', category: 'Wordlists' })).total, 3)
    const unknown = await search({ query: 'wordlist', category: 'nope' })
    assert.equal(unknown.total, 0)
    assert.deepEqual(unknown.results, [])
    assert.equal(unknown.index.generation, 1)
  })
})

describe('browse', () => {
  it('returns the topic census without a category', async () => {
    const env = JSON.parse(await tool('arsenal_browse').run({})) as {
      topics: Array<{ topic: string; collections: number; entries: number }>
      index: IndexStamp
    }
    assert.deepEqual(env.topics, [
      { topic: 'OSINT', collections: 1, entries: 0 },
      { topic: 'Privilege Escalation', collections: 1, entries: 1 },
      { topic: 'Web Hacking', collections: 1, entries: 2 },
      { topic: 'Wordlists', collections: 1, entries: 3 },
    ])
    assert.equal(env.index.generation, 1)
  })

  it("lists a topic's collections with honest level2 flags", async () => {
    const wordlists = JSON.parse(
      await tool('arsenal_browse').run({ category: 'Wordlists' }),
    ) as {
      collections: Array<{ slug: string; entry_count: number; level2: boolean }>
    }
    assert.deepEqual(wordlists.collections, [
      {
        slug: 'seclists',
        name: 'SecLists',
        url: 'https://example.invalid/seclists',
        description: 'Wordlists for testing.',
        entry_count: 3,
        level2: true,
      },
    ])
    const osint = JSON.parse(
      await tool('arsenal_browse').run({ category: 'OSINT' }),
    ) as { collections: Array<{ slug: string; level2: boolean }> }
    assert.equal(osint.collections[0]?.slug, 'awesome-osint')
    assert.equal(osint.collections[0]?.level2, false)
    const bySlug = JSON.parse(
      await tool('arsenal_browse').run({ category: 'seclists' }),
    ) as { collections: unknown[] }
    assert.equal(bySlug.collections.length, 1)
    const unknown = JSON.parse(
      await tool('arsenal_browse').run({ category: 'Nope' }),
    ) as { collections: unknown[] }
    assert.deepEqual(unknown.collections, [])
  })
})

describe('T10 — recommend determinism + why facets', () => {
  it('returns the facet-matching entry first, with its why', async () => {
    const env = JSON.parse(
      await tool('arsenal_recommend').run({
        task: 'Forge a JWT to hijack the web app session',
      }),
    ) as SearchEnvelope
    // Candidates are the OR term matches: "jwt" hits the JWT row, and "web"
    // hits both Web Hacking rows through their stored `topic:web-hacking`
    // tag. Facet overlap (battery F-10 + functionality + target WA) ranks
    // the JWT row strictly first.
    assert.equal(env.total, 3)
    assert.deepEqual(
      env.results.map(r => r.name),
      ['JWT Wordlist', 'IDOR Examples', 'SSRF Payloads'],
    )
    assert.ok(env.results[0]?.why?.includes('battery:F-10'))
    assert.ok(env.results[0]?.why?.includes('target:WA'))
    assert.equal(env.index.generation, 1)
  })

  it('applies target as a hard filter', async () => {
    const env = JSON.parse(
      await tool('arsenal_recommend').run({ task: 'jwt', target: 'LX' }),
    ) as SearchEnvelope
    assert.equal(env.total, 0)
    assert.deepEqual(env.results, [])
  })

  it('answers identical calls byte-identically on a fixed generation', async () => {
    const s1 = await tool('arsenal_search').run({ query: 'wordlist' })
    const s2 = await tool('arsenal_search').run({ query: 'wordlist' })
    assert.equal(s1, s2)
    const r1 = await tool('arsenal_recommend').run({ task: 'jwt forgery' })
    const r2 = await tool('arsenal_recommend').run({ task: 'jwt forgery' })
    assert.equal(r1, r2)
  })
})

describe('validation', () => {
  it('rejects missing or oversize required text', async () => {
    await assert.rejects(tool('arsenal_search').run({}), /"query"/)
    await assert.rejects(
      tool('arsenal_search').run({ query: 'x'.repeat(201) }),
      /"query"/,
    )
    await assert.rejects(tool('arsenal_recommend').run({}), /"task"/)
    await assert.rejects(
      tool('arsenal_recommend').run({ task: 'x'.repeat(501) }),
      /"task"/,
    )
  })

  it('rejects an unknown target and a non-numeric limit', async () => {
    await assert.rejects(
      tool('arsenal_search').run({ query: 'jwt', target: 'XX' }),
      /"target"/,
    )
    await assert.rejects(
      tool('arsenal_search').run({ query: 'jwt', limit: '5' }),
      /"limit"/,
    )
  })
})

describe('T11 — empty index', () => {
  it('every tool returns the typed empty result, never a throw or a list', async () => {
    const emptyPath = join(dir, 'no-index-here.db')
    process.env['REDTEAM_ARSENAL_DB_PATH'] = emptyPath
    try {
      const expected = JSON.stringify({
        error: { code: 'ARSENAL_INDEX_EMPTY', fix: ARSENAL_EMPTY_FIX },
      })
      assert.equal(await tool('arsenal_search').run({ query: 'jwt' }), expected)
      assert.equal(await tool('arsenal_browse').run({}), expected)
      assert.equal(
        await tool('arsenal_recommend').run({ task: 'jwt' }),
        expected,
      )
      assert.equal(ARSENAL_EMPTY_FIX, 'Run: redteam-runner arsenal refresh')
    } finally {
      process.env['REDTEAM_ARSENAL_DB_PATH'] = dbPath
    }
  })
})
