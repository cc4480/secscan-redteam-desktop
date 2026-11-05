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
export function cleanInlineText(text) {
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
export function emptyCounts() {
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
//# sourceMappingURL=ingest-parse.js.map