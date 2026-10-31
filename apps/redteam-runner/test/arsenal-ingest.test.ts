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
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  arsenalSlugFor,
  normalizeArsenalUrl,
  parseLevel1,
  parseLinkedList,
  resolveItemEntry,
} from '../src/arsenal/ingest.js'

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
