import type { LinkedListParse } from './ingest-types.js';
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
/** True when a fetched Level 2 document is an HTML page, not markdown. */
export declare function looksLikeHtml(text: string): boolean;
