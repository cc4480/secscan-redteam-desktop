/**
 * The markdown parsing ladder — URL normalization, the per-item rung, the
 * document scanner, and the Level 1/Level 2 parsers. Extracted from
 * `ingest.ts` so every module stays inside the runner's 300-line file
 * budget; behaviour and export names are unchanged (the parent re-exports
 * the public ones).
 */
import type { ArsenalEntry, ArsenalParseCounts, Level1Parse, LinkedListParse } from './ingest-types.js';
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
/** Strip inline markdown dressing from a name or heading. */
export declare function cleanInlineText(text: string): string;
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
export declare function emptyCounts(): ArsenalParseCounts;
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
export {};
