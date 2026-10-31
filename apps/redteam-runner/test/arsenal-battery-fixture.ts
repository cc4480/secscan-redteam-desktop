/**
 * ARS-9 acceptance battery — shared fixture corpus + index builder.
 *
 * Builds a synthetic Arsenal index DB to spec §5 schema VERBATIM (same DDL,
 * same index_meta keys) so the composition battery can run against the real
 * console read path before/after the production ingest exists. All data is
 * invented; URLs live on example.test. Generation is deliberately 7 (not 1):
 * the battery proves the read path serves the STORED generation stamp
 * instead of assuming one.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const FIXTURE_GENERATION = 7
export const FIXTURE_BUILT_AT = '2026-10-31T00:00:00.000Z'
export const FIXTURE_SOURCE_COMMIT = 'fixture000000000000000000000000000001'
export const FIXTURE_SOURCE_REPO = 'https://github.com/hack-with-github/awesome-hacking.git'
export const ARSENAL_EMPTY_FIX = 'Run: redteam-runner arsenal refresh'
export const ARSENAL_TOOL_NAMES = ['arsenal_search', 'arsenal_browse', 'arsenal_recommend'] as const

export interface FixtureCollection {
  slug: string
  name: string
  url: string
  description: string
  topic: string
  fetchedAt: string | null
  entryCount: number
}

export interface FixtureEntry {
  name: string
  url: string
  description: string
  collectionSlug: string
  tags: string[]
  targets: string[]
  battery: string[]
}

export const FIXTURE_COLLECTIONS: FixtureCollection[] = [
  {
    slug: 'seclists',
    name: 'SecLists',
    url: 'https://example.test/repos/seclists',
    description: 'Security tester companion list collection',
    topic: 'Wordlists',
    fetchedAt: FIXTURE_BUILT_AT,
    entryCount: 4,
  },
  {
    slug: 'payloadsallthethings',
    name: 'PayloadsAllTheThings',
    url: 'https://example.test/repos/payloadsallthethings',
    description: 'Payloads and bypasses for web vulnerabilities',
    topic: 'Web Hacking',
    fetchedAt: FIXTURE_BUILT_AT,
    entryCount: 3,
  },
  {
    slug: 'gtfobins',
    name: 'GTFOBins',
    url: 'https://example.test/sites/gtfobins',
    description: 'Unix binaries that bypass local security restrictions',
    topic: 'Privilege Escalation',
    fetchedAt: FIXTURE_BUILT_AT,
    entryCount: 2,
  },
  {
    slug: 'big-collection',
    name: 'Big Collection',
    url: 'https://example.test/repos/big-collection',
    description: 'A large synthetic collection used for limit testing',
    topic: 'Utilities',
    fetchedAt: FIXTURE_BUILT_AT,
    entryCount: 60,
  },
  {
    slug: 'awesome-osint',
    name: 'Awesome OSINT',
    url: 'https://example.test/repos/awesome-osint',
    description: 'OSINT resource list, Level 1 only in this fixture',
    topic: 'OSINT',
    fetchedAt: null,
    entryCount: 0,
  },
]

const LONG_DESCRIPTION =
  'Usernames gathered from public breaches and default account lists for every platform ' +
  'and service imaginable, including administrators, operators, guests, test accounts, ' +
  'service accounts, and legacy defaults across operating systems, network devices, ' +
  'databases, web applications, and embedded systems everywhere in the world today.'

export const FIXTURE_ENTRIES: FixtureEntry[] = [
  {
    name: 'JWT Wordlist',
    url: 'https://example.test/seclists/jwt-wordlist',
    description: 'Curated passwords and tokens for JSON Web Token brute force attacks',
    collectionSlug: 'seclists',
    tags: ['topic:wordlists', 'collection:seclists', 'wordlist'],
    targets: ['WA'],
    battery: ['functionality', 'F-10'],
  },
  {
    name: 'Password Collection',
    url: 'https://example.test/seclists/passwords',
    description: 'A wordlist of common passwords for credential testing',
    collectionSlug: 'seclists',
    tags: ['topic:wordlists', 'collection:seclists', 'wordlist'],
    targets: ['SS', 'WA'],
    battery: ['functionality'],
  },
  {
    name: 'Fuzzing Strings',
    url: 'https://example.test/seclists/fuzzing',
    description: 'Strings that break parsers or something else entirely',
    collectionSlug: 'seclists',
    tags: ['topic:wordlists', 'collection:seclists'],
    targets: ['WA'],
    battery: ['validation'],
  },
  {
    name: 'Comprehensive Username List',
    url: 'https://example.test/seclists/usernames',
    description: LONG_DESCRIPTION,
    collectionSlug: 'seclists',
    tags: ['topic:wordlists', 'collection:seclists', 'wordlist'],
    targets: ['SS', 'WA'],
    battery: [],
  },
  {
    name: 'SSRF Payloads',
    url: 'https://example.test/patt/ssrf',
    description: 'Server-side request forgery payloads targeting cloud metadata endpoints',
    collectionSlug: 'payloadsallthethings',
    tags: ['topic:web-hacking', 'collection:payloadsallthethings', 'payloads'],
    targets: ['WA'],
    battery: ['functionality', 'F-9'],
  },
  {
    name: 'IDOR Examples',
    url: 'https://example.test/patt/idor',
    description: 'Insecure direct object reference examples and bypass notes',
    collectionSlug: 'payloadsallthethings',
    tags: ['topic:web-hacking', 'collection:payloadsallthethings', 'payloads'],
    targets: ['WA'],
    battery: ['functionality', 'F-1'],
  },
  {
    name: 'Kubernetes Secrets',
    url: 'https://example.test/patt/kubernetes-secrets',
    description: 'Notes on attacking cluster workloads and stealing service account tokens',
    collectionSlug: 'payloadsallthethings',
    tags: ['topic:web-hacking', 'collection:payloadsallthethings'],
    targets: ['WA'],
    battery: [],
  },
  {
    name: 'sudo',
    url: 'https://example.test/gtfobins/sudo',
    description: 'The sudo binary can be used to break out of restricted shell environments',
    collectionSlug: 'gtfobins',
    tags: ['topic:privilege-escalation', 'collection:gtfobins'],
    targets: ['LX'],
    battery: [],
  },
  {
    name: 'Cluster Enumeration Notes',
    url: 'https://example.test/gtfobins/cluster-notes',
    description: 'Enumerating a kubernetes cluster from inside a compromised pod',
    collectionSlug: 'gtfobins',
    tags: ['topic:privilege-escalation', 'collection:gtfobins'],
    targets: ['LX'],
    battery: [],
  },
]

for (let i = 1; i <= 60; i++) {
  const nn = String(i).padStart(2, '0')
  FIXTURE_ENTRIES.push({
    name: `Bulk Entry ${nn}`,
    url: `https://example.test/bulk/${nn}`,
    description: `Bulk filler entry number ${nn} for limit testing`,
    collectionSlug: 'big-collection',
    tags: ['topic:utilities', 'collection:big-collection'],
    targets: [],
    battery: [],
  })
}

/** Spec §5 DDL, verbatim. */
const SCHEMA_SQL = `
CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE collections (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  topic       TEXT NOT NULL,
  fetched_at  TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0,
  fetch_error TEXT
);
CREATE TABLE entries (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL DEFAULT '',
  collection_slug TEXT NOT NULL REFERENCES collections(slug),
  tags            TEXT NOT NULL DEFAULT '[]',
  targets         TEXT NOT NULL DEFAULT '[]',
  battery         TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX entries_by_collection ON entries(collection_slug);
CREATE INDEX entries_by_target     ON entries(json_extract(targets, '$[0]'));
CREATE VIRTUAL TABLE entries_fts USING fts5(
  name, description, collection_slug, tags,
  content = 'entries', content_rowid = 'id',
  tokenize = 'unicode61'
);
`

/** The data home layout the console derives from (brief §1.4). */
export function fixtureLayout(dataHome: string): { engagementsDir: string; dbPath: string } {
  const engagementsDir = join(dataHome, 'engagements', 'live')
  const dbPath = join(dataHome, 'arsenal', 'arsenal.db')
  return { engagementsDir, dbPath }
}

/**
 * Write the fixture generation into `<dataHome>/arsenal/arsenal.db` and
 * create `<dataHome>/engagements/live` for the console store. Returns the
 * paths startUiServer needs.
 */
export function buildFixtureIndex(dataHome: string): { engagementsDir: string; dbPath: string } {
  const { engagementsDir, dbPath } = fixtureLayout(dataHome)
  mkdirSync(engagementsDir, { recursive: true })
  mkdirSync(join(dataHome, 'arsenal'), { recursive: true })

  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(SCHEMA_SQL)
    const meta = db.prepare('INSERT INTO index_meta (key, value) VALUES (?, ?)')
    const metaRows: Array<[string, string]> = [
      ['schema_version', '1'],
      ['generation', String(FIXTURE_GENERATION)],
      ['built_at', FIXTURE_BUILT_AT],
      ['source_repo', FIXTURE_SOURCE_REPO],
      ['source_commit', FIXTURE_SOURCE_COMMIT],
      ['entry_count', String(FIXTURE_ENTRIES.length)],
      ['collection_count', String(FIXTURE_COLLECTIONS.length)],
      ['unparsed_count', '0'],
      ['dupe_count', '0'],
    ]
    for (const [k, v] of metaRows) meta.run(k, v)

    const coll = db.prepare(
      'INSERT INTO collections (slug, name, url, description, topic, fetched_at, entry_count, fetch_error) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    )
    for (const c of FIXTURE_COLLECTIONS) {
      coll.run(c.slug, c.name, c.url, c.description, c.topic, c.fetchedAt, c.entryCount)
    }

    const entry = db.prepare(
      'INSERT INTO entries (name, url, description, collection_slug, tags, targets, battery) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    for (const e of FIXTURE_ENTRIES) {
      const tags = JSON.stringify(e.tags)
      const targets = JSON.stringify(e.targets)
      const battery = JSON.stringify(e.battery)
      entry.run(e.name, e.url, e.description, e.collectionSlug, tags, targets, battery)
    }

    db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')")
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  } finally {
    db.close()
  }
  return { engagementsDir, dbPath }
}
