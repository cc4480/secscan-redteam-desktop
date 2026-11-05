/**
 * HTML-index rung — the site-index counterpart of the markdown ladder
 * (GTFOBins). Extracted from `ingest.ts` so every module stays inside the
 * runner's 300-line file budget; `looksLikeHtml` is now exported because the
 * generation assembly needs it from here.
 */
import { cleanInlineText, emptyCounts, normalizeArsenalUrl } from './ingest-parse.js';
const ANCHOR_RE = /<a\b([^>]*)>([^<]*)<\/a>/gi;
const HREF_RE = /\bhref="([^"]*)"/;
const CLASS_RE = /\bclass="([^"]*)"/;
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
export function parseHtmlIndexEntries(html, baseUrl) {
    const counts = emptyCounts();
    const entries = [];
    const seenUrls = new Set();
    ANCHOR_RE.lastIndex = 0;
    let match;
    while ((match = ANCHOR_RE.exec(html)) !== null) {
        const attrs = match[1];
        const classes = CLASS_RE.exec(attrs)?.[1] ?? '';
        if (!classes.split(/\s+/).includes('bin-name'))
            continue;
        counts.itemCount += 1;
        const href = HREF_RE.exec(attrs)?.[1] ?? '';
        let resolved;
        try {
            resolved = new URL(href, baseUrl).href;
        }
        catch {
            counts.unparsedCount += 1;
            continue;
        }
        const url = normalizeArsenalUrl(resolved.split('#')[0]);
        const name = cleanInlineText(match[2]);
        if (url === null || name === '') {
            counts.unparsedCount += 1;
            continue;
        }
        if (seenUrls.has(url)) {
            counts.dupeCount += 1;
            continue;
        }
        seenUrls.add(url);
        entries.push({ name, url, description: '' });
    }
    return { entries, ...counts };
}
/** True when a fetched Level 2 document is an HTML page, not markdown. */
export function looksLikeHtml(text) {
    return /^\s*<(?:!doctype|html)/i.test(text.slice(0, 256)) || text.includes('class="bin-name"');
}
//# sourceMappingURL=ingest-html.js.map