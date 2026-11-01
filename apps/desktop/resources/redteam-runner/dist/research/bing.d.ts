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
import { type ResearchSearchHit, type ResearchSearchOptions, type SearchProvider } from "./provider.js";
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
export declare function buildBingSearchUrl(query: string, opts: ResearchSearchOptions, endpoint?: string, now?: Date): string;
/** Map a `since` date to Bing's freshness vocabulary by distance; undefined when too old to name. */
export declare function freshnessForSince(since: string | undefined, now: Date): string | undefined;
/** A publication date printed at the head of a result snippet, as ISO; undefined when none is printed. */
export declare function printedDate(snippet: string): string | undefined;
/** Unwrap a Bing `/ck/a` redirect href to the real result URL; direct hrefs pass through. */
export declare function unwrapBingHref(rawHref: string): string | undefined;
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
export declare function parseBingResults(html: string, limit: number): ResearchSearchHit[] | null;
/** The keyless Bing HTML provider. */
export declare class BingSearchProvider implements SearchProvider {
    readonly id = "bing-html";
    private readonly endpoint;
    /** @param endpoint - Search endpoint override (regional host / mirror); defaults to bing.com. */
    constructor(endpoint?: string);
    /**
     * Search via the Bing HTML endpoint.
     *
     * @param query - The query text.
     * @param opts - The `since` bound and result ceiling.
     * @returns The parsed hits.
     */
    search(query: string, opts: ResearchSearchOptions): Promise<ResearchSearchHit[]>;
}
