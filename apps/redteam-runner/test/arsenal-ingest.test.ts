/**
 * Arsenal ingest tests — spec T1-L1 (Level 1 fixture → exact collection
 * rows + counts) and T2 (URL normalization dedupe, first-wins), plus the
 * parsing ladder's edge semantics from spec §4.2/§4.3.
 *
 * Fixtures are committed synthetic documents (brief §4: designed, never
 * fetched). Level 2 per-collection assertions (T1-L2) append to this file
 * with the Step 6 work; the ladder they run on is pinned here.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ArsenalConfig } from '../src/arsenal/config.js'
import {
  arsenalReadmeUrl,
  arsenalSlugFor,
  buildArsenalData,
  normalizeArsenalUrl,
  parseHtmlIndexEntries,
  parseLevel1,
  parseLinkedList,
  resolveItemEntry,
} from '../src/arsenal/ingest.js'
import {
  buildAndSwapArsenalIndex,
  readArsenalIndexMeta,
} from '../src/arsenal/index-store.js'

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'test',
  'fixtures',
  'arsenal',
)
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

describe('T1-L1: Level 1 fixture census', () => {
  const result = parseLevel1(fixture('awesome-hacking.md'))

  it('yields the exact collection rows, in document order', () => {
    assert.deepEqual(result.collections, [
      {
        slug: 'web-hacking',
        name: 'Web Hacking',
        url: 'https://github.com/arsenal-fixture/web-hacking',
        description: 'Web application hacking resources and techniques.',
        topic: 'Web Hacking',
      },
      {
        slug: 'api-security',
        name: 'API Security',
        url: 'https://github.com/arsenal-fixture/api-security',
        description: 'API security testing references and checklists.',
        topic: 'Web Hacking',
      },
      {
        slug: 'payloadsallthethings',
        name: 'PayloadsAllTheThings',
        url: 'https://github.com/swisskyrepo/PayloadsAllTheThings',
        description: 'Payloads and bypass techniques for web vulnerabilities.',
        topic: 'Web Hacking',
      },
      {
        slug: 'seclists',
        name: 'SecLists',
        url: 'https://github.com/danielmiessler/SecLists',
        description:
          "The security tester's companion: usernames, passwords, URLs, fuzzing strings.",
        topic: 'Wordlists',
      },
      {
        slug: 'gtfobins',
        name: 'GTFOBins',
        url: 'https://github.com/GTFOBins/GTFOBins.github.io',
        description:
          'Unix binaries that can be used to bypass local security restrictions.',
        topic: 'Privilege Escalation',
      },
      {
        slug: 'red-teaming-toolkit',
        name: 'Red Teaming Toolkit',
        url: 'https://github.com/arsenal-fixture/red-teaming-toolkit',
        description: '',
        topic: 'Privilege Escalation',
      },
      {
        slug: 'bug-bounty-reference',
        name: 'Bug Bounty Reference',
        url: 'https://github.com/arsenal-fixture/bug-bounty-reference',
        description: 'References and notes for bug bounty hunting.',
        topic: 'Bug Bounty',
      },
      {
        slug: 'loose-reference',
        name: 'Loose Reference',
        url: 'https://example.test/loose-reference',
        description: 'mentioned in prose bullet text.',
        topic: 'Bug Bounty',
      },
    ])
  })

  it('counts reconcile: 13 items = 8 rows + 1 dupe + 3 unparsed + 1 urlless', () => {
    assert.equal(result.itemCount, 13)
    assert.equal(result.dupeCount, 1)
    assert.equal(result.unparsedCount, 3)
    assert.equal(result.urllessCount, 1)
    assert.equal(
      result.collections.length +
        result.dupeCount +
        result.unparsedCount +
        result.urllessCount,
      result.itemCount,
    )
  })

  it('lands a row for every priority collection in the fixture census', () => {
    const slugs = new Set(result.collections.map(c => c.slug))
    for (const slug of [
      'seclists',
      'payloadsallthethings',
      'gtfobins',
      'red-teaming-toolkit',
      'web-hacking',
      'api-security',
      'bug-bounty-reference',
    ]) {
      assert.ok(slugs.has(slug), `priority slug missing: ${slug}`)
    }
  })

  it('never surfaces the fenced fake entry', () => {
    assert.ok(!result.collections.some(c => c.url.includes('fenced-fake')))
  })
})

describe('T2: URL normalization and dedupe', () => {
  it('lowercases scheme/host and strips the trailing slash', () => {
    assert.equal(
      normalizeArsenalUrl('HTTPS://GITHUB.COM/danielmiessler/SecLists/'),
      'https://github.com/danielmiessler/SecLists',
    )
  })

  it('strips a .git suffix, with or without a trailing slash', () => {
    assert.equal(normalizeArsenalUrl('https://github.com/a/b.git'), 'https://github.com/a/b')
    assert.equal(normalizeArsenalUrl('https://github.com/a/b.git/'), 'https://github.com/a/b')
  })

  it('preserves path case, query, and fragment verbatim', () => {
    assert.equal(
      normalizeArsenalUrl('https://EXAMPLE.test/Some/Path/?q=1#frag'),
      'https://example.test/Some/Path?q=1#frag',
    )
  })

  it('rejects non-http(s) schemes, credentials, and non-URLs', () => {
    assert.equal(normalizeArsenalUrl('javascript:alert(1)'), null)
    assert.equal(normalizeArsenalUrl('ftp://example.test/x'), null)
    assert.equal(normalizeArsenalUrl('https://user:pass@example.test/x'), null)
    assert.equal(normalizeArsenalUrl(''), null)
    assert.equal(normalizeArsenalUrl('not a url'), null)
  })

  it('dedupes by normalized URL, first occurrence wins', () => {
    const parsed = parseLinkedList(
      [
        '- [First Name](https://example.test/dup) - first description',
        '- [Second Name](https://EXAMPLE.test/dup/) - second description',
        '- [Third Name](https://example.test/dup.git) - third description',
      ].join('\n'),
    )
    assert.equal(parsed.entries.length, 1)
    assert.equal(parsed.entries[0].name, 'First Name')
    assert.equal(parsed.entries[0].description, 'first description')
    assert.equal(parsed.dupeCount, 2)
  })
})

describe('slug derivation (spec §4.2)', () => {
  it('uses the repo name, lowercased without camel splitting', () => {
    assert.equal(
      arsenalSlugFor('https://github.com/danielmiessler/SecLists', 'SecLists'),
      'seclists',
    )
    assert.equal(
      arsenalSlugFor('https://github.com/swisskyrepo/PayloadsAllTheThings', 'x'),
      'payloadsallthethings',
    )
  })

  it('strips a .github.io repo suffix down to the project name', () => {
    assert.equal(
      arsenalSlugFor('https://github.com/GTFOBins/GTFOBins.github.io', 'GTFOBins'),
      'gtfobins',
    )
  })

  it('falls back to the display name for a project-site root URL', () => {
    assert.equal(arsenalSlugFor('https://gtfobins.github.io/', 'GTFOBins'), 'gtfobins')
    assert.equal(
      arsenalSlugFor('https://example.test/', 'Red Teaming Toolkit'),
      'red-teaming-toolkit',
    )
  })
})

describe('ladder edge semantics', () => {
  it('takes the first link of a two-link bullet; the second stays description text', () => {
    const outcome = resolveItemEntry(
      '[PayloadSmith](https://example.test/p) - payload generation; see [the formats page](https://example.test/p/formats) for details',
    )
    assert.deepEqual(outcome, {
      kind: 'entry',
      entry: {
        name: 'PayloadSmith',
        url: 'https://example.test/p',
        description:
          'payload generation; see [the formats page](https://example.test/p/formats) for details',
      },
    })
  })

  it('keeps FTS-looking text in a description as literal data', () => {
    const outcome = resolveItemEntry(
      '[QuoteSneak](https://example.test/q) - Notes on queries containing " OR * NEAR( as literal text',
    )
    assert.equal(outcome.kind, 'entry')
    if (outcome.kind === 'entry') {
      assert.ok(outcome.entry.description.includes('" OR * NEAR('))
    }
  })

  it('classifies reference-style links, unclosed links, and bare URLs as unparsed', () => {
    assert.equal(resolveItemEntry('[python][pyref]').kind, 'unparsed')
    assert.equal(
      resolveItemEntry('[Broken](https://example.test/x - never closes').kind,
      'unparsed',
    )
    assert.equal(
      resolveItemEntry('forgot the syntax entirely https://example.test/no-brackets').kind,
      'unparsed',
    )
    assert.equal(
      resolveItemEntry('[Sneaky](javascript:alert(1)) - not a web link').kind,
      'unparsed',
    )
  })

  it('classifies prose items and empty anchors as urlless', () => {
    assert.equal(resolveItemEntry('SchedTasker - homepage to be announced').kind, 'urlless')
    assert.equal(resolveItemEntry('[Empty Anchor]() - placeholder').kind, 'urlless')
  })

  it('does not ingest an image link, but counts the attempt', () => {
    assert.equal(
      resolveItemEntry('![logo](https://example.test/logo.png) badge').kind,
      'unparsed',
    )
  })

  it('parses CRLF documents and nested bullets identically', () => {
    const doc = '# T\r\n\r\n## Topic\r\n- [A](https://example.test/a) - one\r\n  - [B](https://example.test/b)\r\n'
    const parsed = parseLevel1(doc)
    assert.equal(parsed.collections.length, 2)
    assert.equal(parsed.collections[1].topic, 'Topic')
    assert.equal(parsed.collections[1].description, '')
  })
})

describe('arsenalReadmeUrl (spec §4.1 source derivation)', () => {
  it('maps a GitHub repo to its raw README at the default-branch HEAD', () => {
    assert.equal(
      arsenalReadmeUrl('https://github.com/danielmiessler/SecLists'),
      'https://raw.githubusercontent.com/danielmiessler/SecLists/HEAD/README.md',
    )
  })

  it('leaves a project-site URL as its own Level 2 source', () => {
    assert.equal(arsenalReadmeUrl('https://gtfobins.github.io'), 'https://gtfobins.github.io')
  })
})

// The api-security-checklist fixture is held by ARS-7 under the FLAG 2
// ruling, so the build test serves this inline document for that one
// collection (3 entries + 1 URL-less) and the committed fixtures for the
// other six.
const API_CHECKLIST_DOC = [
  '# API Security Checklist (build-test stub)',
  '- [Rate Limiting](https://example.test/api/rate-limiting) - Throttle requests per client.',
  '- [JWT Validation](https://example.test/api/jwt-validation) - Verify token signatures on every request.',
  '- [Input Validation](https://example.test/api/input-validation) - Validate all inputs server-side.',
  '- A checklist item with no link at all',
].join('\n')

function fixtureFetchText(overrides?: Map<string, string | Error>) {
  const byMarker: [string, string][] = [
    ['/danielmiessler/SecLists/', fixture('seclists.md')],
    ['/swisskyrepo/PayloadsAllTheThings/', fixture('payloadsallthethings.md')],
    ['/GTFOBins/', fixture('gtfobins.md')],
    ['/red-teaming-toolkit/', fixture('red-teaming-toolkit.md')],
    ['/infoslack/awesome-web-hacking/', fixture('web-hacking.md')],
    ['/shieldfy/API-Security-Checklist/', API_CHECKLIST_DOC],
    // The census row (not the map row) supplies the fetch URL (spec §4.1),
    // and the fixture census points at arsenal-fixture/* — match on the repo
    // segment alone.
    ['/bug-bounty-reference/', fixture('bug-bounty-reference.md')],
  ]
  return async (url: string) => {
    for (const [marker, override] of overrides ?? []) {
      if (url.includes(marker)) {
        if (override instanceof Error) throw override
        return { text: override, finalUrl: url, hops: 0 }
      }
    }
    for (const [marker, text] of byMarker) {
      if (url.includes(marker)) return { text, finalUrl: url, hops: 0 }
    }
    throw new Error(`no stubbed fixture for ${url}`)
  }
}

function buildFixtureCache(maxEntriesPerCollection = 20000) {
  const root = mkdtempSync(join(tmpdir(), 'arsenal-build-'))
  const cacheDir = join(root, 'cache')
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, 'README.md'), fixture('awesome-hacking.md'))
  const config: ArsenalConfig = {
    enabled: true,
    dbPath: join(root, 'arsenal.db'),
    arsenalDir: root,
    cacheDir,
    sourceRepo: 'https://github.com/hack-with-github/awesome-hacking',
    refreshIntervalHours: 0,
    maxEntriesPerCollection,
  }
  return { root, cacheDir, config }
}

describe('buildArsenalData (Step 6 generation assembly)', () => {
  it('assembles census + Level 2 with the verified per-collection counts', async () => {
    const { cacheDir, config } = buildFixtureCache()
    const data = await buildArsenalData(
      { config, cacheDir, sourceCommit: '440486fd' },
      { fetchText: fixtureFetchText(), now: () => new Date('2026-10-31T00:00:00.000Z') },
    )
    // 8 census rows + 2 map-fallback rows (the fixture census names its
    // Web Hacking / API Security rows with fixture slugs; the canonical
    // priority slugs join from the map, never silently short).
    assert.equal(data.collections.length, 10)
    const bySlug = new Map(data.collections.map(c => [c.slug, c]))
    const expectedEntries: Record<string, number> = {
      seclists: 6,
      payloadsallthethings: 7,
      gtfobins: 5,
      'red-teaming-toolkit': 5,
      'awesome-web-hacking': 8,
      'api-security-checklist': 3,
      'bug-bounty-reference': 2,
    }
    for (const [slug, count] of Object.entries(expectedEntries)) {
      const row = bySlug.get(slug)
      assert.ok(row, `priority row missing: ${slug}`)
      assert.equal(row.entryCount, count, `${slug} entryCount`)
      assert.equal(row.fetchError, null, `${slug} fetchError`)
      assert.equal(row.fetchedAt, '2026-10-31T00:00:00.000Z', `${slug} fetchedAt`)
    }
    assert.equal(data.entries.length, 36)
    // Folded meta: unparsed carries urlless + true unparsed from both levels.
    assert.equal(data.unparsedCount, 15)
    assert.equal(data.dupeCount, 7)
    assert.equal(data.sourceRepo, config.sourceRepo)
    assert.equal(data.sourceCommit, '440486fd')
    // Census-only rows stay Level 1: never fetched, no error recorded.
    for (const slug of ['web-hacking', 'api-security', 'loose-reference']) {
      const row = bySlug.get(slug)
      assert.ok(row, `census row missing: ${slug}`)
      assert.equal(row.fetchedAt, null)
      assert.equal(row.entryCount, 0)
      assert.equal(row.fetchError, null)
    }
  })

  it('enriches entries with inherited + rule facets (spec §4.4)', async () => {
    const { cacheDir, config } = buildFixtureCache()
    const data = await buildArsenalData(
      { config, cacheDir, sourceCommit: 'x' },
      { fetchText: fixtureFetchText() },
    )
    const seclistsEntry = data.entries.find(e => e.collectionSlug === 'seclists')
    assert.ok(seclistsEntry)
    assert.ok(seclistsEntry.tags.includes('collection:seclists'))
    assert.ok(seclistsEntry.tags.includes('topic:wordlists'))
    const jwt = data.entries.find(e => e.name === 'JWT Attacks')
    assert.ok(jwt)
    assert.equal(jwt.collectionSlug, 'payloadsallthethings')
    assert.ok(jwt.battery.includes('F-10'), `JWT battery: ${jwt.battery}`)
  })

  it('feeds the store: a full generation swaps in with reconciled meta', async () => {
    const { root, cacheDir, config } = buildFixtureCache()
    const data = await buildArsenalData(
      { config, cacheDir, sourceCommit: '440486fd' },
      { fetchText: fixtureFetchText() },
    )
    const swapped = buildAndSwapArsenalIndex(join(root, 'arsenal.db'), data)
    assert.equal(swapped.generation, 1)
    assert.equal(swapped.entryCount, 36)
    const meta = readArsenalIndexMeta(join(root, 'arsenal.db'))
    assert.ok(meta)
    assert.equal(meta.collectionCount, 10)
    assert.equal(meta.unparsedCount, 15)
    assert.equal(meta.dupeCount, 7)
  })

  it('records a fetch failure on the row and still returns the build', async () => {
    const { cacheDir, config } = buildFixtureCache()
    const data = await buildArsenalData(
      { config, cacheDir, sourceCommit: 'x' },
      {
        fetchText: fixtureFetchText(
          new Map([['/danielmiessler/SecLists/', new Error('destination denied: loopback')]]),
        ),
      },
    )
    const row = data.collections.find(c => c.slug === 'seclists')
    assert.ok(row)
    assert.equal(row.entryCount, 0)
    assert.equal(row.fetchedAt, null)
    assert.ok(row.fetchError?.includes('destination denied'))
    assert.equal(data.entries.filter(e => e.collectionSlug === 'seclists').length, 0)
    assert.equal(data.entries.length, 30)
  })

  it('records a zero-entry parse as a fetch error on the row', async () => {
    const { cacheDir, config } = buildFixtureCache()
    const data = await buildArsenalData(
      { config, cacheDir, sourceCommit: 'x' },
      {
        fetchText: fixtureFetchText(
          new Map([['/GTFOBins/', '# A page with no list items at all']]),
        ),
      },
    )
    const row = data.collections.find(c => c.slug === 'gtfobins')
    assert.ok(row)
    assert.equal(row.entryCount, 0)
    assert.ok(row.fetchedAt !== null)
    assert.ok(row.fetchError?.startsWith('zero entries parsed from'))
  })

  it('dedupes across collections, first in priority order wins', async () => {
    const { cacheDir, config } = buildFixtureCache()
    const shared = '- [Shared Tool](https://example.test/shared) - listed twice'
    const data = await buildArsenalData(
      { config, cacheDir, sourceCommit: 'x' },
      {
        fetchText: fixtureFetchText(
          new Map<string, string | Error>([
            ['/danielmiessler/SecLists/', `# SecLists stub\n${shared}`],
            ['/swisskyrepo/PayloadsAllTheThings/', `# Payloads stub\n${shared}`],
          ]),
        ),
      },
    )
    const hits = data.entries.filter(e => e.url === 'https://example.test/shared')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].collectionSlug, 'seclists')
  })

  it('counts per-collection cap overflow in build meta, never silently', async () => {
    const { cacheDir, config } = buildFixtureCache(2)
    const data = await buildArsenalData(
      { config, cacheDir, sourceCommit: 'x' },
      { fetchText: fixtureFetchText() },
    )
    assert.equal(data.entries.length, 14)
    assert.equal(data.unparsedCount, 37)
    for (const row of data.collections) {
      assert.ok(row.entryCount <= 2, `${row.slug} exceeds the cap`)
    }
  })

  it('throws loud when the cached census README is missing', async () => {
    const { config } = buildFixtureCache()
    await assert.rejects(
      buildArsenalData(
        { config, cacheDir: join(tmpdir(), 'arsenal-no-such-cache'), sourceCommit: 'x' },
        { fetchText: fixtureFetchText() },
      ),
      /cannot read the cached Awesome Hacking README/,
    )
  })
})

describe('parseHtmlIndexEntries (coordinator-ruled GTFOBins HTML-index rung)', () => {
  const GTFO_INDEX_HTML = [
    '<!DOCTYPE html>',
    '<html><body><table><tbody>',
    '<tr><th><a href="/gtfobins/7z/" class="bin-name">7z</a></th>',
    '<td><ul><li><a href="/gtfobins/7z/#file-read">File read</a></li></ul></td></tr>',
    '<tr><th><a href="/gtfobins/aa-exec/" class="bin-name">aa-exec</a></th></tr>',
    '<tr><th><a href="/gtfobins/7z/" class="bin-name">7z</a></th></tr>',
    '</tbody></table></body></html>',
  ].join('\n')

  it('extracts bin-name anchors as entries, resolving hrefs against the index URL', () => {
    const parsed = parseHtmlIndexEntries(GTFO_INDEX_HTML, 'https://gtfobins.github.io')
    assert.deepEqual(
      parsed.entries.map(e => [e.name, e.url]),
      [
        ['7z', 'https://gtfobins.github.io/gtfobins/7z'],
        ['aa-exec', 'https://gtfobins.github.io/gtfobins/aa-exec'],
      ],
    )
    // Function sub-links are not items; the duplicate bin-name is a dupe.
    assert.equal(parsed.itemCount, 3)
    assert.equal(parsed.dupeCount, 1)
    assert.equal(parsed.unparsedCount, 0)
  })

  it('buildArsenalData routes an HTML fetch through the rung (GTFOBins > 0)', async () => {
    const { cacheDir, config } = buildFixtureCache()
    const data = await buildArsenalData(
      { config, cacheDir, sourceCommit: 'x' },
      {
        fetchText: fixtureFetchText(
          new Map([['gtfobins.github.io', GTFO_INDEX_HTML]]),
        ),
      },
    )
    const row = data.collections.find(c => c.slug === 'gtfobins')
    assert.ok(row)
    assert.equal(row.entryCount, 2)
    assert.equal(row.fetchError, null)
    const names = data.entries.filter(e => e.collectionSlug === 'gtfobins').map(e => e.name)
    assert.deepEqual(names, ['7z', 'aa-exec'])
  })
})
