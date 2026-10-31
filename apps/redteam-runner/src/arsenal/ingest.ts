/**
 * Arsenal ingest — the tolerant parsing ladder (spec §4.2/§4.3, brief Step 3).
 *
 * A collection README is target-adjacent content: this module treats it as
 * inert text. It never executes, fetches, or follows anything in a document —
 * parsing is pure string work over a README handed in as a string (or read
 * from a local file by the two thin wrappers at the bottom). Fetching is
 * Step 4's seam (fetch-guard.ts) and lives elsewhere.
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

/** Read a README file (UTF-8) and run the Level 1 census over it. */
export async function parseLevel1File(path: string): Promise<Level1Parse> {
  return parseLevel1(await readFile(path, 'utf8'))
}

/** Read a README file (UTF-8) and parse its linked entries. */
export async function parseLinkedListFile(path: string): Promise<LinkedListParse> {
  return parseLinkedList(await readFile(path, 'utf8'))
}
