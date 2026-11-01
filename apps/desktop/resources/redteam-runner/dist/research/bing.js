/**
 * Keyless Bing HTML search provider — the default {@link SearchProvider}.
 *
 * Why this provider (surveyed 2026-11-01 from the runner's network
 * origins): it needs no API key and no purchase, and it serves real
 * result markup where the DuckDuckGo HTML/Lite endpoints serve
 * bot-challenge pages with zero results. Its limits, stated plainly:
 * the HTML interface is unofficial — markup drift is expected over
 * time and surfaces as RESEARCH_BAD_RESPONSE, never as invented hits;
 * rate limiting surfaces as RESEARCH_BLOCKED; most web results carry
 * no publication date, so `publishedDate` is present only when the
 * result block itself prints one (the dispatcher separately drops
 * results KNOWN to predate `since`; undated results are kept and
 * stamped undated — see dispatch/research.ts).
 *
 * Result links are Bing redirect wrappers (`/ck/a?...&u=a1<base64url>`);
 * the wrapper is unwrapped here so the model cites the real URL,
 * exactly as the citation contract requires.
 */
import { httpGetText, ResearchError, SEARCH_TIMEOUT_MS, } from "./provider.js";
import { decodeEntities, fragmentText } from "./text.js";
const DEFAULT_ENDPOINT = "https://www.bing.com/search";
/**
 * Build the search URL for one query. `since` maps onto Bing's own
 * freshness filter (Day/Week/Month/Year by distance from today) — a
 * retrieval hint for the provider; the dispatcher's known-date filter
 * is the enforceable bound.
 *
 * @param query - The query text.
 * @param opts - The `since` bound and result ceiling.
 * @param endpoint - The search endpoint (operator-overridable).
 * @param now - The current time (injectable for tests).
 * @returns The full search URL.
 */
export function buildBingSearchUrl(query, opts, endpoint = DEFAULT_ENDPOINT, now = new Date()) {
    const u = new URL(endpoint);
    u.searchParams.set("q", query);
    u.searchParams.set("count", String(Math.max(opts.limit, 1)));
    u.searchParams.set("setlang", "en");
    const freshness = freshnessForSince(opts.since, now);
    if (freshness)
        u.searchParams.set("freshness", freshness);
    return u.toString();
}
/** Map a `since` date to Bing's freshness vocabulary by distance; undefined when too old to name. */
export function freshnessForSince(since, now) {
    if (!since)
        return undefined;
    const days = Math.floor((now.getTime() - Date.parse(`${since}T00:00:00Z`)) / 86_400_000);
    if (Number.isNaN(days) || days < 0)
        return undefined;
    if (days <= 1)
        return "Day";
    if (days <= 7)
        return "Week";
    if (days <= 31)
        return "Month";
    if (days <= 365)
        return "Year";
    return undefined;
}
const MONTHS = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
/** A publication date printed at the head of a result snippet, as ISO; undefined when none is printed. */
export function printedDate(snippet) {
    const head = snippet.slice(0, 48);
    const iso = /^(\d{4})-(\d{2})-(\d{2})\b/.exec(head);
    if (iso)
        return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const mdy = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})\b/.exec(head);
    if (mdy) {
        const mon = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
        if (mon)
            return `${mdy[3]}-${mon}-${mdy[2].padStart(2, "0")}`;
    }
    const dmy = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(head);
    if (dmy) {
        const mon = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
        if (mon)
            return `${dmy[3]}-${mon}-${dmy[1].padStart(2, "0")}`;
    }
    return undefined;
}
/** Unwrap a Bing `/ck/a` redirect href to the real result URL; direct hrefs pass through. */
export function unwrapBingHref(rawHref) {
    const href = decodeEntities(rawHref);
    let parsed;
    try {
        parsed = new URL(href);
    }
    catch {
        return undefined;
    }
    if (!/^https?:$/.test(parsed.protocol))
        return undefined;
    if (/(^|\.)bing\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith("/ck/a")) {
        const u = parsed.searchParams.get("u");
        if (u && u.startsWith("a1")) {
            try {
                const decoded = Buffer.from(u.slice(2), "base64url").toString("utf8");
                if (/^https?:\/\//i.test(decoded))
                    return decoded;
            }
            catch {
                /* fall through to the wrapper itself being unusable */
            }
        }
        return undefined;
    }
    if (/(^|\.)bing\.com$/i.test(parsed.hostname))
        return undefined;
    return parsed.toString();
}
/**
 * Parse one Bing results page into hits.
 *
 * @param html - The raw results page.
 * @param limit - The result ceiling.
 * @returns The hits in rank order; an empty array for a genuine
 * no-results page; null when the page carries neither results nor a
 * no-results marker (markup drift or a challenge page — the caller
 * turns that into RESEARCH_BAD_RESPONSE).
 */
export function parseBingResults(html, limit) {
    const blocks = html.split('<li class="b_algo"').slice(1);
    if (blocks.length === 0) {
        return html.includes("b_no") && /no results/i.test(html) ? [] : null;
    }
    const hits = [];
    const seen = new Set();
    for (const block of blocks) {
        const anchor = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
        if (!anchor)
            continue;
        const url = unwrapBingHref(anchor[1]);
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        const title = fragmentText(anchor[2]);
        if (!title)
            continue;
        const caption = /<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/.exec(block);
        const para = caption ? /<p[^>]*>([\s\S]*?)<\/p>/.exec(caption[1]) : /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
        const snippet = para ? fragmentText(para[1]) : "";
        const cite = /<cite[^>]*>([\s\S]*?)<\/cite>/.exec(block);
        const source = cite ? fragmentText(cite[1]) : undefined;
        const date = printedDate(snippet);
        hits.push({ title, url, snippet, ...(date ? { publishedDate: date } : {}), ...(source ? { source } : {}) });
        if (hits.length >= limit)
            break;
    }
    return hits;
}
/** The keyless Bing HTML provider. */
export class BingSearchProvider {
    id = "bing-html";
    endpoint;
    /** @param endpoint - Search endpoint override (regional host / mirror); defaults to bing.com. */
    constructor(endpoint) {
        this.endpoint = endpoint ?? DEFAULT_ENDPOINT;
    }
    /**
     * Search via the Bing HTML endpoint.
     *
     * @param query - The query text.
     * @param opts - The `since` bound and result ceiling.
     * @returns The parsed hits.
     */
    async search(query, opts) {
        const url = buildBingSearchUrl(query, opts, this.endpoint);
        const res = await httpGetText(url, { timeoutMs: SEARCH_TIMEOUT_MS, errorCode: "RESEARCH_PROVIDER_ERROR" });
        if (res.status === 429 || res.status === 403) {
            throw new ResearchError("RESEARCH_BLOCKED", `search provider refused the request (HTTP ${res.status}) — rate limit or bot challenge; no results were fabricated`);
        }
        if (res.status !== 200) {
            throw new ResearchError("RESEARCH_PROVIDER_ERROR", `search provider answered HTTP ${res.status}`);
        }
        const hits = parseBingResults(res.text, opts.limit);
        if (hits === null) {
            throw new ResearchError("RESEARCH_BAD_RESPONSE", "search provider returned a page with no parseable results (markup changed or a challenge page was served); no results were fabricated");
        }
        return hits;
    }
}
//# sourceMappingURL=bing.js.map