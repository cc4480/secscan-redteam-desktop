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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionBySlug, inheritedFacetsForCollection, PRIORITY_COLLECTION_SLUGS, } from './collections-map.js';
import { fetchTextChecked } from './fetch-guard.js';
import { deriveEntryFacets } from './tag-rules.js';
const MAX_LINE_CHARS = 8192;
const HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/;
const ITEM_RE = /^[ \t]{0,10}(?:[-*+]|\d{1,3}[.)])[ \t]+(.*)$/;
const TABLE_ROW_RE = /^[ \t]{0,3}\[([^\]\n]+)\]\(([^)\s]+)\)[ \t]*\|[ \t]?(.*)$/;
const PIPE_TABLE_ROW_RE = /^[ \t]{0,3}\|(.*)\|[ \t]*$/;
const FENCE_RE = /^[ \t]{0,3}(```|~~~)/;
const LINK_RE = /\[([^\]\n]*)\]\(([^)\s]*)(?:[ \t]+[^)]*)?\)/g;
const BARE_URL_RE = /https?:\/\/\S+/i;
/**
 * Normalize a URL into its dedupe/storage identity (spec §4.3).
 * Returns null for anything that is not a credential-free http(s) URL.
 */
export function normalizeArsenalUrl(raw) {
    const trimmed = raw.trim();
    if (trimmed === '')
        return null;
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return null;
    if (url.username !== '' || url.password !== '')
        return null;
    let path = url.pathname.replace(/\/+$/, '');
    if (path.endsWith('.git'))
        path = path.slice(0, -'.git'.length).replace(/\/+$/, '');
    const port = url.port === '' ? '' : `:${url.port}`;
    return `${url.protocol}//${url.hostname}${port}${path}${url.search}${url.hash}`;
}
/** Lowercase kebab: non-alphanumeric runs become one `-`, edges trimmed. */
export function arsenalKebab(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
/**
 * Slug for a collection (spec §4.2): lowercase kebab of the repo name — the
 * URL's last path segment — or of the display name when the URL has no repo
 * segment (a project-site root). A `*.github.io` repo segment names the
 * project by its prefix (`GTFOBins.github.io` → `gtfobins`).
 */
export function arsenalSlugFor(url, name) {
    const normalized = normalizeArsenalUrl(url);
    let base = '';
    if (normalized !== null) {
        const segments = new URL(normalized).pathname.split('/').filter(s => s !== '');
        base = segments.length > 0 ? segments[segments.length - 1] : '';
        if (base.toLowerCase().endsWith('.github.io')) {
            base = base.slice(0, -'.github.io'.length);
        }
    }
    return arsenalKebab(base) || arsenalKebab(name);
}
/** Strip inline markdown dressing from a name or heading. */
function cleanInlineText(text) {
    return text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Description = text after the entry link, leading separator run stripped. */
function cleanDescription(after) {
    return after.replace(/^[\s\-–—:*•]+/, '').trim();
}
/**
 * Resolve one list item's content (text after the bullet marker) through the
 * ladder. Pure; exported for the Level 2 path and unit tests.
 */
export function resolveItemEntry(content) {
    // Attempt signals that survive even when no candidate matches: a bare URL
    // in the text, a reference-style `[name][ref]`, or a `](` that never
    // closes. An empty `[]()` target is NOT an attempt — the item simply has
    // no URL (urlless), matching the Level 2 "skipped + counted" semantics.
    let attempted = BARE_URL_RE.test(content) || content.includes('][') || /\]\([^)]*$/.test(content);
    LINK_RE.lastIndex = 0;
    let match;
    while ((match = LINK_RE.exec(content)) !== null) {
        const target = match[2].trim();
        if (match.index > 0 && content[match.index - 1] === '!') {
            if (target !== '')
                attempted = true; // an image URL we deliberately do not ingest
            continue;
        }
        if (target === '')
            continue; // empty anchor: no URL token
        attempted = true;
        const name = cleanInlineText(match[1]);
        const url = normalizeArsenalUrl(match[2]);
        if (name === '' || url === null)
            continue;
        const after = content.slice(match.index + match[0].length);
        return { kind: 'entry', entry: { name, url, description: cleanDescription(after) } };
    }
    return attempted ? { kind: 'unparsed' } : { kind: 'urlless' };
}
/** Split a document into list items, tracking topic headings, fences, comments. */
function scanDocument(markdown) {
    const items = [];
    let topic = '';
    let fence = null;
    let inComment = false;
    for (const rawLine of markdown.split(/\r?\n/)) {
        const line = rawLine.length > MAX_LINE_CHARS ? rawLine.slice(0, MAX_LINE_CHARS) : rawLine;
        if (inComment) {
            if (line.includes('-->'))
                inComment = false;
            continue;
        }
        if (fence !== null) {
            const close = FENCE_RE.exec(line);
            if (close && close[1] === fence)
                fence = null;
            continue;
        }
        const fenceOpen = FENCE_RE.exec(line);
        if (fenceOpen) {
            fence = fenceOpen[1];
            continue;
        }
        const commentStart = line.indexOf('<!--');
        if (commentStart !== -1) {
            if (line.indexOf('-->', commentStart + 4) === -1)
                inComment = true;
            if (commentStart === 0 && line.includes('-->'))
                continue; // whole-line comment
        }
        const heading = HEADING_RE.exec(line);
        if (heading) {
            topic = cleanInlineText(heading[1].replace(/[ \t]+#+$/, ''));
            continue;
        }
        // Table rung (production-census addition, 2026-10-31): the real
        // Awesome Hacking README \u2014 and several priority READMEs \u2014 publish
        // their entries as markdown TABLE rows, not list items; the list-only
        // ladder parsed 1 of the census's 81 rows. Two forms:
        //  (a) `[Name](url) | description` \u2014 the row is re-expressed in the
        //      list form the ladder already resolves. Header/separator rows
        //      carry no link and never match.
        //  (b) pipe tables `|Name|Description|https://\u2026|` \u2014 a row whose cells
        //      include exactly one bare http(s) URL cell; the first non-URL
        //      cell is the name, the rest the description. Header rows (no
        //      URL cell) and separator rows (dash cells) never match.
        const tableRow = TABLE_ROW_RE.exec(line);
        if (tableRow) {
            items.push({ topic, content: `[${tableRow[1]}](${tableRow[2]}) - ${tableRow[3]}` });
            continue;
        }
        const pipeRow = PIPE_TABLE_ROW_RE.exec(line);
        if (pipeRow) {
            const cells = pipeRow[1].split('|').map(x => x.trim());
            const urlCells = cells.filter(x => normalizeArsenalUrl(x) !== null);
            if (urlCells.length === 1) {
                const url = urlCells[0];
                const rest = cells.filter(x => x !== '' && x !== url);
                if (rest.length > 0) {
                    items.push({ topic, content: `[${rest[0]}](${url}) - ${rest.slice(1).join(' | ')}` });
                    continue;
                }
            }
        }
        const item = ITEM_RE.exec(line);
        if (item)
            items.push({ topic, content: item[1] });
    }
    return items;
}
function emptyCounts() {
    return { itemCount: 0, dupeCount: 0, urllessCount: 0, unparsedCount: 0 };
}
/**
 * Parse a README into normalized linked entries (the Level 2 core, also the
 * ladder's unit-test surface). Dedupes within the document, first wins.
 */
export function parseLinkedList(markdown) {
    const counts = emptyCounts();
    const entries = [];
    const seenUrls = new Set();
    for (const item of scanDocument(markdown)) {
        counts.itemCount += 1;
        const outcome = resolveItemEntry(item.content);
        if (outcome.kind === 'urlless') {
            counts.urllessCount += 1;
        }
        else if (outcome.kind === 'unparsed') {
            counts.unparsedCount += 1;
        }
        else if (seenUrls.has(outcome.entry.url)) {
            counts.dupeCount += 1;
        }
        else {
            seenUrls.add(outcome.entry.url);
            entries.push(outcome.entry);
        }
    }
    return { entries, ...counts };
}
/**
 * Level 1 census (spec §4.2): parse the Awesome Hacking README into
 * collection rows — `{slug, name, url, description, topic}` where topic is
 * the nearest preceding heading. Dedupes by normalized URL, then by slug.
 */
export function parseLevel1(markdown) {
    const counts = emptyCounts();
    const collections = [];
    const seenUrls = new Set();
    const seenSlugs = new Set();
    for (const item of scanDocument(markdown)) {
        counts.itemCount += 1;
        const outcome = resolveItemEntry(item.content);
        if (outcome.kind === 'urlless') {
            counts.urllessCount += 1;
            continue;
        }
        if (outcome.kind === 'unparsed') {
            counts.unparsedCount += 1;
            continue;
        }
        const slug = arsenalSlugFor(outcome.entry.url, outcome.entry.name);
        if (slug === '') {
            counts.unparsedCount += 1;
            continue;
        }
        if (seenUrls.has(outcome.entry.url) || seenSlugs.has(slug)) {
            counts.dupeCount += 1;
            continue;
        }
        seenUrls.add(outcome.entry.url);
        seenSlugs.add(slug);
        collections.push({
            slug,
            name: outcome.entry.name,
            url: outcome.entry.url,
            description: outcome.entry.description,
            topic: item.topic,
        });
    }
    return { collections, ...counts };
}
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
function looksLikeHtml(text) {
    return /^\s*<(?:!doctype|html)/i.test(text.slice(0, 256)) || text.includes('class="bin-name"');
}
/** Read a README file (UTF-8) and run the Level 1 census over it. */
export async function parseLevel1File(path) {
    return parseLevel1(await readFile(path, 'utf8'));
}
/** Read a README file (UTF-8) and parse its linked entries. */
export async function parseLinkedListFile(path) {
    return parseLinkedList(await readFile(path, 'utf8'));
}
const defaultFetchText = async (url) => fetchTextChecked(url);
/**
 * The raw-markdown source URL for one collection (spec §4.1): a GitHub repo
 * serves its README from the raw host at the default-branch HEAD; any other
 * canonical URL (a project site — GTFOBins) is itself the Level 2 source,
 * the site index at that URL (ARS-1's FLAG 3 ruling).
 */
export function arsenalReadmeUrl(collectionUrl) {
    const normalized = normalizeArsenalUrl(collectionUrl) ?? collectionUrl;
    let parsed;
    try {
        parsed = new URL(normalized);
    }
    catch {
        return normalized;
    }
    if (parsed.hostname === 'github.com') {
        const segments = parsed.pathname.split('/').filter(s => s !== '');
        if (segments.length >= 2) {
            return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/HEAD/README.md`;
        }
    }
    return normalized;
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
export async function buildArsenalData(input, deps) {
    const fetchText = deps?.fetchText ?? defaultFetchText;
    const builtAt = (deps?.now?.() ?? new Date()).toISOString();
    const censusPath = join(input.cacheDir, 'README.md');
    let censusMarkdown;
    try {
        censusMarkdown = await readFile(censusPath, 'utf8');
    }
    catch (err) {
        throw new Error(`arsenal build: cannot read the cached Awesome Hacking README at ${censusPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const census = parseLevel1(censusMarkdown);
    let unparsedCount = census.unparsedCount + census.urllessCount;
    let dupeCount = census.dupeCount;
    const rows = new Map();
    for (const row of census.collections) {
        rows.set(row.slug, { ...row, fetchedAt: null, entryCount: 0, fetchError: null });
    }
    const entries = [];
    const seenEntryUrls = new Set();
    const cap = input.config.maxEntriesPerCollection;
    for (const slug of PRIORITY_COLLECTION_SLUGS) {
        let row = rows.get(slug);
        if (row === undefined) {
            const mapRow = collectionBySlug(slug);
            if (mapRow === undefined)
                continue; // unreachable: the slugs come from the map
            row = {
                slug: mapRow.slug,
                name: mapRow.name,
                url: normalizeArsenalUrl(mapRow.url) ?? mapRow.url,
                description: '',
                topic: mapRow.topic,
                fetchedAt: null,
                entryCount: 0,
                fetchError: null,
            };
            rows.set(slug, row);
        }
        const sourceUrl = arsenalReadmeUrl(row.url);
        let markdown;
        try {
            markdown = (await fetchText(sourceUrl)).text;
        }
        catch (err) {
            row.fetchError = err instanceof Error ? err.message : String(err);
            continue;
        }
        row.fetchedAt = builtAt;
        const parsed = looksLikeHtml(markdown)
            ? parseHtmlIndexEntries(markdown, sourceUrl)
            : parseLinkedList(markdown);
        unparsedCount += parsed.unparsedCount + parsed.urllessCount;
        dupeCount += parsed.dupeCount;
        const inherited = inheritedFacetsForCollection(slug);
        let kept = 0;
        for (const entry of parsed.entries) {
            if (seenEntryUrls.has(entry.url)) {
                dupeCount += 1; // generation-wide dedupe (spec §4.3), first wins
                continue;
            }
            if (kept >= cap) {
                unparsedCount += 1; // cap overflow is counted in build meta, never silent
                continue;
            }
            seenEntryUrls.add(entry.url);
            const facets = deriveEntryFacets(entry, inherited);
            entries.push({
                name: entry.name,
                url: entry.url,
                description: entry.description,
                collectionSlug: slug,
                tags: facets.tags,
                targets: facets.targets,
                battery: facets.battery,
            });
            kept += 1;
        }
        row.entryCount = kept;
        if (kept === 0 && row.fetchError === null) {
            row.fetchError = `zero entries parsed from ${sourceUrl}`;
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
    };
}
//# sourceMappingURL=ingest.js.map