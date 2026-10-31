/**
 * Arsenal ingest — the tolerant parsing ladder (spec §4.2/§4.3, brief Step 3).
 *
 * A collection README is target-adjacent content: this module treats it as
 * inert text. It never executes, fetches, or follows anything in a document —
 * parsing is pure string work over a README handed in as a string (or read
 * from a local file by the two thin wrappers at the bottom). Fetching is
 * Step 4's seam (fetch-guard.ts): the parsers never fetch, and the one
 * assembly entry at the bottom ({@link buildArsenalData}) pulls Level 2
 * READMEs through the guard — the only network path this module may use
 * (spec §6.2).
 *
 * The ladder, per list item (spec §4.2: strict pattern → loose link
 * extraction → record-and-report the remainder):
 *
 *   1. Scan the item for inline markdown links `[name](url)`, skipping image
 *      links (`![..](..)`). The first candidate whose name is non-empty and
 *      whose URL normalizes (below) is the entry; any later links stay part
 *      of the description text, verbatim.
 *   2. Description = the text after that link, with the leading separator
 *      run (`-`, `–`, `:`, `*`, whitespace) stripped. May be "".
 *   3. An item with no usable entry is counted, never silently dropped:
 *      - urlless: no URL token at all (prose items, empty `[]()` targets) —
 *        Level 2 skips these (spec §4.3); at Level 1 they are usually topic
 *        scaffolding ("Privesc references:").
 *      - unparsed: the item carries a URL or a link attempt no rung can
 *        structure — an unclosed `[name](url`, a reference-style
 *        `[name][ref]`, a non-http(s) scheme, a credentialed URL, or a bare
 *        URL with no markdown link syntax. The brief's designated
 *        no-rung-can-parse line is asserted in this count.
 *
 * Lines inside fenced code blocks (``` or ~~~) and HTML comments are never
 * items. A list item is `-`/`*`/`+`/`1.` at up to 10 columns of indent.
 * Pathological lines are truncated at MAX_LINE_CHARS before scanning so a
 * hostile document cannot make the parser chew unbounded input; every regex
 * here is single-character-class and linear.
 *
 * Dedupe (spec §4.3, test T2): key = normalized URL — lowercase scheme/host,
 * strip trailing slash and `.git`; first occurrence wins, later duplicates
 * increment dupeCount and are dropped. Level 1 also dedupes by slug (the
 * collections table's primary key): a second collection deriving an
 * already-seen slug is a dupe, first wins.
 *
 * Stored URLs are the normalized form (the dedupe key is the identity).
 * Query strings and fragments are preserved verbatim — the spec's
 * normalization names exactly three rules and inventing a fourth would
 * merge rows the census counts separately (e.g. an anchored section link).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  collectionBySlug,
  inheritedFacetsForCollection,
  PRIORITY_COLLECTION_SLUGS,
} from './collections-map.js'
import type { ArsenalConfig } from './config.js'
import { fetchTextChecked, type FetchTextResult } from './fetch-guard.js'
import type {
  ArsenalBuildData,
  ArsenalCollectionRow as ArsenalStoreCollectionRow,
  ArsenalEntryRow,
} from './index-store.js'
import { deriveEntryFacets } from './tag-rules.js'

/** One Level 1 collection row (spec §4.2), in the store's column shape. */
export interface ArsenalCollectionRow {
  slug: string
  name: string
  url: string
  description: string
  topic: string
}

/** One normalized entry (spec §4.3) — the Level 2 shape, collection added by the caller. */
export interface ArsenalEntry {
  name: string
  url: string
  description: string
}

/** Counters shared by both parse levels; the arithmetic always reconciles:
 *  itemCount = entries + dupeCount + urllessCount + unparsedCount. */
export interface ArsenalParseCounts {
  itemCount: number
  dupeCount: number
  urllessCount: number
  unparsedCount: number
}

export interface Level1Parse extends ArsenalParseCounts {
  collections: ArsenalCollectionRow[]
}

export interface LinkedListParse extends ArsenalParseCounts {
  entries: ArsenalEntry[]
}

const MAX_LINE_CHARS = 8192

const HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/
const ITEM_RE = /^[ \t]{0,10}(?:[-*+]|\d{1,3}[.)])[ \t]+(.*)$/
const FENCE_RE = /^[ \t]{0,3}(```|~~~)/
const LINK_RE = /\[([^\]\n]*)\]\(([^)\s]*)(?:[ \t]+[^)]*)?\)/g
const BARE_URL_RE = /https?:\/\/\S+/i

/**
 * Normalize a URL into its dedupe/storage identity (spec §4.3).
 * Returns null for anything that is not a credential-free http(s) URL.
 */
export function normalizeArsenalUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  let path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('.git')) path = path.slice(0, -'.git'.length).replace(/\/+$/, '')
  const port = url.port === '' ? '' : `:${url.port}`
  return `${url.protocol}//${url.hostname}${port}${path}${url.search}${url.hash}`
}

/** Lowercase kebab: non-alphanumeric runs become one `-`, edges trimmed. */
export function arsenalKebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Slug for a collection (spec §4.2): lowercase kebab of the repo name — the
 * URL's last path segment — or of the display name when the URL has no repo
 * segment (a project-site root). A `*.github.io` repo segment names the
 * project by its prefix (`GTFOBins.github.io` → `gtfobins`).
 */
export function arsenalSlugFor(url: string, name: string): string {
  const normalized = normalizeArsenalUrl(url)
  let base = ''
  if (normalized !== null) {
    const segments = new URL(normalized).pathname.split('/').filter(s => s !== '')
    base = segments.length > 0 ? segments[segments.length - 1] : ''
    if (base.toLowerCase().endsWith('.github.io')) {
      base = base.slice(0, -'.github.io'.length)
    }
  }
  return arsenalKebab(base) || arsenalKebab(name)
}

/** Strip inline markdown dressing from a name or heading. */
function cleanInlineText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Description = text after the entry link, leading separator run stripped. */
function cleanDescription(after: string): string {
  return after.replace(/^[\s\-–—:*•]+/, '').trim()
}

type ItemOutcome =
  | { kind: 'entry'; entry: ArsenalEntry }
  | { kind: 'urlless' }
  | { kind: 'unparsed' }

/**
 * Resolve one list item's content (text after the bullet marker) through the
 * ladder. Pure; exported for the Level 2 path and unit tests.
 */
export function resolveItemEntry(content: string): ItemOutcome {
  // Attempt signals that survive even when no candidate matches: a bare URL
  // in the text, a reference-style `[name][ref]`, or a `](` that never
  // closes. An empty `[]()` target is NOT an attempt — the item simply has
  // no URL (urlless), matching the Level 2 "skipped + counted" semantics.
  let attempted =
    BARE_URL_RE.test(content) || content.includes('][') || /\]\([^)]*$/.test(content)
  LINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK_RE.exec(content)) !== null) {
    const target = match[2].trim()
    if (match.index > 0 && content[match.index - 1] === '!') {
      if (target !== '') attempted = true // an image URL we deliberately do not ingest
      continue
    }
    if (target === '') continue // empty anchor: no URL token
    attempted = true
    const name = cleanInlineText(match[1])
    const url = normalizeArsenalUrl(match[2])
    if (name === '' || url === null) continue
    const after = content.slice(match.index + match[0].length)
    return { kind: 'entry', entry: { name, url, description: cleanDescription(after) } }
  }
  return attempted ? { kind: 'unparsed' } : { kind: 'urlless' }
}

interface ScannedItem {
  topic: string
  content: string
}

/** Split a document into list items, tracking topic headings, fences, comments. */
function scanDocument(markdown: string): ScannedItem[] {
  const items: ScannedItem[] = []
  let topic = ''
  let fence: string | null = null
  let inComment = false
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.length > MAX_LINE_CHARS ? rawLine.slice(0, MAX_LINE_CHARS) : rawLine
    if (inComment) {
      if (line.includes('-->')) inComment = false
      continue
    }
    if (fence !== null) {
      const close = FENCE_RE.exec(line)
      if (close && close[1] === fence) fence = null
      continue
    }
    const fenceOpen = FENCE_RE.exec(line)
    if (fenceOpen) {
      fence = fenceOpen[1]
      continue
    }
    const commentStart = line.indexOf('<!--')
    if (commentStart !== -1) {
      if (line.indexOf('-->', commentStart + 4) === -1) inComment = true
      if (commentStart === 0 && line.includes('-->')) continue // whole-line comment
    }
    const heading = HEADING_RE.exec(line)
    if (heading) {
      topic = cleanInlineText(heading[1].replace(/[ \t]+#+$/, ''))
      continue
    }
    const item = ITEM_RE.exec(line)
    if (item) items.push({ topic, content: item[1] })
  }
  return items
}

function emptyCounts(): ArsenalParseCounts {
  return { itemCount: 0, dupeCount: 0, urllessCount: 0, unparsedCount: 0 }
}

/**
 * Parse a README into normalized linked entries (the Level 2 core, also the
 * ladder's unit-test surface). Dedupes within the document, first wins.
 */
export function parseLinkedList(markdown: string): LinkedListParse {
  const counts = emptyCounts()
  const entries: ArsenalEntry[] = []
  const seenUrls = new Set<string>()
  for (const item of scanDocument(markdown)) {
    counts.itemCount += 1
    const outcome = resolveItemEntry(item.content)
    if (outcome.kind === 'urlless') {
      counts.urllessCount += 1
    } else if (outcome.kind === 'unparsed') {
      counts.unparsedCount += 1
    } else if (seenUrls.has(outcome.entry.url)) {
      counts.dupeCount += 1
    } else {
      seenUrls.add(outcome.entry.url)
      entries.push(outcome.entry)
    }
  }
  return { entries, ...counts }
}

/**
 * Level 1 census (spec §4.2): parse the Awesome Hacking README into
 * collection rows — `{slug, name, url, description, topic}` where topic is
 * the nearest preceding heading. Dedupes by normalized URL, then by slug.
 */
export function parseLevel1(markdown: string): Level1Parse {
  const counts = emptyCounts()
  const collections: ArsenalCollectionRow[] = []
  const seenUrls = new Set<string>()
  const seenSlugs = new Set<string>()
  for (const item of scanDocument(markdown)) {
    counts.itemCount += 1
    const outcome = resolveItemEntry(item.content)
    if (outcome.kind === 'urlless') {
      counts.urllessCount += 1
      continue
    }
    if (outcome.kind === 'unparsed') {
      counts.unparsedCount += 1
      continue
    }
    const slug = arsenalSlugFor(outcome.entry.url, outcome.entry.name)
    if (slug === '') {
      counts.unparsedCount += 1
      continue
    }
    if (seenUrls.has(outcome.entry.url) || seenSlugs.has(slug)) {
      counts.dupeCount += 1
      continue
    }
    seenUrls.add(outcome.entry.url)
    seenSlugs.add(slug)
    collections.push({
      slug,
      name: outcome.entry.name,
      url: outcome.entry.url,
      description: outcome.entry.description,
      topic: item.topic,
    })
  }
  return { collections, ...counts }
}

const ANCHOR_RE = /<a\b([^>]*)>([^<]*)<\/a>/gi
const HREF_RE = /\bhref="([^"]*)"/
const CLASS_RE = /\bclass="([^"]*)"/

/**
 * HTML-index rung (coordinator-ruled addition, 2026-10-31): a priority
 * collection whose canonical URL is a project SITE (GTFOBins) serves an
 * HTML index, not a README — the markdown ladder parses zero entries from
 * it and priority validation would block every generation. This rung is
 * the minimal site-index counterpart of {@link parseLinkedList}: it reads
 * the index's per-item anchors (the `bin-name` anchors of the GTFOBins
 * index table), resolves each href against the index URL, and returns the
 * same parse shape. Anchors without the `bin-name` class (function
 * sub-links, navigation) are not items. Dedupes by normalized URL, first
 * wins; counts reconcile as entries + dupes = anchors seen.
 */
export function parseHtmlIndexEntries(html: string, baseUrl: string): LinkedListParse {
  const counts = emptyCounts()
  const entries: ArsenalEntry[] = []
  const seenUrls = new Set<string>()
  ANCHOR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ANCHOR_RE.exec(html)) !== null) {
    const attrs = match[1]
    const classes = CLASS_RE.exec(attrs)?.[1] ?? ''
    if (!classes.split(/\s+/).includes('bin-name')) continue
    counts.itemCount += 1
    const href = HREF_RE.exec(attrs)?.[1] ?? ''
    let resolved: string
    try {
      resolved = new URL(href, baseUrl).href
    } catch {
      counts.unparsedCount += 1
      continue
    }
    const url = normalizeArsenalUrl(resolved.split('#')[0])
    const name = cleanInlineText(match[2])
    if (url === null || name === '') {
      counts.unparsedCount += 1
      continue
    }
    if (seenUrls.has(url)) {
      counts.dupeCount += 1
      continue
    }
    seenUrls.add(url)
    entries.push({ name, url, description: '' })
  }
  return { entries, ...counts }
}

/** True when a fetched Level 2 document is an HTML page, not markdown. */
function looksLikeHtml(text: string): boolean {
  return /^\s*<(?:!doctype|html)/i.test(text.slice(0, 256)) || text.includes('class="bin-name"')
}

/** Read a README file (UTF-8) and run the Level 1 census over it. */
export async function parseLevel1File(path: string): Promise<Level1Parse> {
  return parseLevel1(await readFile(path, 'utf8'))
}

/** Read a README file (UTF-8) and parse its linked entries. */
export async function parseLinkedListFile(path: string): Promise<LinkedListParse> {
  return parseLinkedList(await readFile(path, 'utf8'))
}

// ---------------------------------------------------------------------------
// Generation assembly (brief Step 6): census + Level 2 → ArsenalBuildData
// ---------------------------------------------------------------------------

/** The Level 2 fetch seam: fetch-guard's one function, injectable for tests. */
export type ArsenalFetchText = (url: string) => Promise<FetchTextResult>

export interface BuildArsenalDataDeps {
  /** Defaults to {@link fetchTextChecked} — the guard is the only network path. */
  fetchText?: ArsenalFetchText
  /** Build clock; the reading is stamped on every fetched collection. */
  now?: () => Date
}

const defaultFetchText: ArsenalFetchText = async url => fetchTextChecked(url)

/**
 * The raw-markdown source URL for one collection (spec §4.1): a GitHub repo
 * serves its README from the raw host at the default-branch HEAD; any other
 * canonical URL (a project site — GTFOBins) is itself the Level 2 source,
 * the site index at that URL (ARS-1's FLAG 3 ruling).
 */
export function arsenalReadmeUrl(collectionUrl: string): string {
  const normalized = normalizeArsenalUrl(collectionUrl) ?? collectionUrl
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return normalized
  }
  if (parsed.hostname === 'github.com') {
    const segments = parsed.pathname.split('/').filter(s => s !== '')
    if (segments.length >= 2) {
      return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/HEAD/README.md`
    }
  }
  return normalized
}

/**
 * Assemble one generation's build data (the refresh pipeline's single build
 * entry — refresh.ts imports this by name and fails loud while it is absent).
 *
 * Level 1 is the census parsed from the cached Awesome Hacking README at
 * `cacheDir/README.md`; a missing census is a hard failure (throw), because
 * a generation without its census is not a generation. Level 2 runs for the
 * canonical priority set (collections-map.ts), joined to census rows by
 * slug; a priority slug the census does not carry falls back to its curated
 * map row, so the priority set is never silently short. Each priority
 * README comes through fetch-guard and only fetch-guard; a fetch failure or
 * a zero-entry parse is recorded on the collection row (`fetchError`), never
 * thrown — the store's validation decides whether the swap may proceed
 * (spec §4.3).
 *
 * Entries are facet-enriched at assembly (spec §4.4: the map's inherited
 * facets unioned with the tag rules) and deduped across the whole
 * generation by normalized URL, first occurrence in priority order wins.
 * Count folding at this seam (the store's meta carries two counters):
 * URL-less items and per-collection cap overflow fold into `unparsedCount`
 * alongside true unparsed items, so stored + dupes + unparsed reconciles
 * against items seen at every level.
 */
export async function buildArsenalData(
  input: { config: ArsenalConfig; cacheDir: string; sourceCommit: string },
  deps?: BuildArsenalDataDeps,
): Promise<ArsenalBuildData> {
  const fetchText = deps?.fetchText ?? defaultFetchText
  const builtAt = (deps?.now?.() ?? new Date()).toISOString()
  const censusPath = join(input.cacheDir, 'README.md')
  let censusMarkdown: string
  try {
    censusMarkdown = await readFile(censusPath, 'utf8')
  } catch (err) {
    throw new Error(
      `arsenal build: cannot read the cached Awesome Hacking README at ${censusPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  const census = parseLevel1(censusMarkdown)
  let unparsedCount = census.unparsedCount + census.urllessCount
  let dupeCount = census.dupeCount

  const rows = new Map<string, ArsenalStoreCollectionRow>()
  for (const row of census.collections) {
    rows.set(row.slug, { ...row, fetchedAt: null, entryCount: 0, fetchError: null })
  }

  const entries: ArsenalEntryRow[] = []
  const seenEntryUrls = new Set<string>()
  const cap = input.config.maxEntriesPerCollection

  for (const slug of PRIORITY_COLLECTION_SLUGS) {
    let row = rows.get(slug)
    if (row === undefined) {
      const mapRow = collectionBySlug(slug)
      if (mapRow === undefined) continue // unreachable: the slugs come from the map
      row = {
        slug: mapRow.slug,
        name: mapRow.name,
        url: normalizeArsenalUrl(mapRow.url) ?? mapRow.url,
        description: '',
        topic: mapRow.topic,
        fetchedAt: null,
        entryCount: 0,
        fetchError: null,
      }
      rows.set(slug, row)
    }
    const sourceUrl = arsenalReadmeUrl(row.url)
    let markdown: string
    try {
      markdown = (await fetchText(sourceUrl)).text
    } catch (err) {
      row.fetchError = err instanceof Error ? err.message : String(err)
      continue
    }
    row.fetchedAt = builtAt
    const parsed = looksLikeHtml(markdown)
      ? parseHtmlIndexEntries(markdown, sourceUrl)
      : parseLinkedList(markdown)
    unparsedCount += parsed.unparsedCount + parsed.urllessCount
    dupeCount += parsed.dupeCount
    const inherited = inheritedFacetsForCollection(slug)
    let kept = 0
    for (const entry of parsed.entries) {
      if (seenEntryUrls.has(entry.url)) {
        dupeCount += 1 // generation-wide dedupe (spec §4.3), first wins
        continue
      }
      if (kept >= cap) {
        unparsedCount += 1 // cap overflow is counted in build meta, never silent
        continue
      }
      seenEntryUrls.add(entry.url)
      const facets = deriveEntryFacets(entry, inherited)
      entries.push({
        name: entry.name,
        url: entry.url,
        description: entry.description,
        collectionSlug: slug,
        tags: facets.tags,
        targets: facets.targets,
        battery: facets.battery,
      })
      kept += 1
    }
    row.entryCount = kept
    if (kept === 0 && row.fetchError === null) {
      row.fetchError = `zero entries parsed from ${sourceUrl}`
    }
  }

  return {
    sourceRepo: input.config.sourceRepo,
    sourceCommit: input.sourceCommit,
    builtAt,
    collections: [...rows.values()],
    entries,
    unparsedCount,
    dupeCount,
    prioritySlugs: PRIORITY_COLLECTION_SLUGS,
  }
}
