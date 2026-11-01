import type { ArsenalConfig } from './config.js';
import { type FetchTextResult } from './fetch-guard.js';
import type { ArsenalBuildData } from './index-store.js';
/** One Level 1 collection row (spec §4.2), in the store's column shape. */
export interface ArsenalCollectionRow {
    slug: string;
    name: string;
    url: string;
    description: string;
    topic: string;
}
/** One normalized entry (spec §4.3) — the Level 2 shape, collection added by the caller. */
export interface ArsenalEntry {
    name: string;
    url: string;
    description: string;
}
/** Counters shared by both parse levels; the arithmetic always reconciles:
 *  itemCount = entries + dupeCount + urllessCount + unparsedCount. */
export interface ArsenalParseCounts {
    itemCount: number;
    dupeCount: number;
    urllessCount: number;
    unparsedCount: number;
}
export interface Level1Parse extends ArsenalParseCounts {
    collections: ArsenalCollectionRow[];
}
export interface LinkedListParse extends ArsenalParseCounts {
    entries: ArsenalEntry[];
}
/**
 * Normalize a URL into its dedupe/storage identity (spec §4.3).
 * Returns null for anything that is not a credential-free http(s) URL.
 */
export declare function normalizeArsenalUrl(raw: string): string | null;
/** Lowercase kebab: non-alphanumeric runs become one `-`, edges trimmed. */
export declare function arsenalKebab(text: string): string;
/**
 * Slug for a collection (spec §4.2): lowercase kebab of the repo name — the
 * URL's last path segment — or of the display name when the URL has no repo
 * segment (a project-site root). A `*.github.io` repo segment names the
 * project by its prefix (`GTFOBins.github.io` → `gtfobins`).
 */
export declare function arsenalSlugFor(url: string, name: string): string;
type ItemOutcome = {
    kind: 'entry';
    entry: ArsenalEntry;
} | {
    kind: 'urlless';
} | {
    kind: 'unparsed';
};
/**
 * Resolve one list item's content (text after the bullet marker) through the
 * ladder. Pure; exported for the Level 2 path and unit tests.
 */
export declare function resolveItemEntry(content: string): ItemOutcome;
/**
 * Parse a README into normalized linked entries (the Level 2 core, also the
 * ladder's unit-test surface). Dedupes within the document, first wins.
 */
export declare function parseLinkedList(markdown: string): LinkedListParse;
/**
 * Level 1 census (spec §4.2): parse the Awesome Hacking README into
 * collection rows — `{slug, name, url, description, topic}` where topic is
 * the nearest preceding heading. Dedupes by normalized URL, then by slug.
 */
export declare function parseLevel1(markdown: string): Level1Parse;
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
export declare function parseHtmlIndexEntries(html: string, baseUrl: string): LinkedListParse;
/** Read a README file (UTF-8) and run the Level 1 census over it. */
export declare function parseLevel1File(path: string): Promise<Level1Parse>;
/** Read a README file (UTF-8) and parse its linked entries. */
export declare function parseLinkedListFile(path: string): Promise<LinkedListParse>;
/** The Level 2 fetch seam: fetch-guard's one function, injectable for tests. */
export type ArsenalFetchText = (url: string) => Promise<FetchTextResult>;
export interface BuildArsenalDataDeps {
    /** Defaults to {@link fetchTextChecked} — the guard is the only network path. */
    fetchText?: ArsenalFetchText;
    /** Build clock; the reading is stamped on every fetched collection. */
    now?: () => Date;
}
/**
 * The raw-markdown source URL for one collection (spec §4.1): a GitHub repo
 * serves its README from the raw host at the default-branch HEAD; any other
 * canonical URL (a project site — GTFOBins) is itself the Level 2 source,
 * the site index at that URL (ARS-1's FLAG 3 ruling).
 */
export declare function arsenalReadmeUrl(collectionUrl: string): string;
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
export declare function buildArsenalData(input: {
    config: ArsenalConfig;
    cacheDir: string;
    sourceCommit: string;
}, deps?: BuildArsenalDataDeps): Promise<ArsenalBuildData>;
export {};
