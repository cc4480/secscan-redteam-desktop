/**
 * Generation assembly (brief Step 6): census + Level 2 → `ArsenalBuildData`.
 * Extracted from `ingest.ts` so every module stays inside the runner's
 * 300-line file budget; `buildArsenalData` and `arsenalReadmeUrl` keep their
 * exact signatures and behaviour, and the parent re-exports them.
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
import { looksLikeHtml, parseHtmlIndexEntries } from './ingest-html.js'
import { normalizeArsenalUrl, parseLevel1, parseLinkedList } from './ingest-parse.js'
import type {
  ArsenalBuildData,
  ArsenalCollectionRow as ArsenalStoreCollectionRow,
  ArsenalEntryRow,
} from './index-store.js'
import { deriveEntryFacets } from './tag-rules.js'
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
