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

import { parseLevel1, parseLinkedList } from './ingest-parse.js'
import type { Level1Parse, LinkedListParse } from './ingest-types.js'

export {
  arsenalKebab,
  arsenalSlugFor,
  normalizeArsenalUrl,
  parseLevel1,
  parseLinkedList,
  resolveItemEntry,
} from './ingest-parse.js'
export { parseHtmlIndexEntries } from './ingest-html.js'
export { arsenalReadmeUrl, buildArsenalData } from './ingest-build.js'
export type {
  ArsenalCollectionRow,
  ArsenalEntry,
  ArsenalParseCounts,
  Level1Parse,
  LinkedListParse,
} from './ingest-types.js'
export type { ArsenalFetchText, BuildArsenalDataDeps } from './ingest-build.js'

/** Read a README file (UTF-8) and run the Level 1 census over it. */
export async function parseLevel1File(path: string): Promise<Level1Parse> {
  return parseLevel1(await readFile(path, 'utf8'))
}

/** Read a README file (UTF-8) and parse its linked entries. */
export async function parseLinkedListFile(path: string): Promise<LinkedListParse> {
  return parseLinkedList(await readFile(path, 'utf8'))
}
