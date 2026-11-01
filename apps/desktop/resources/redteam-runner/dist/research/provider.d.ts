/** One citable search result, exactly as the provider reported it. */
export interface ResearchSearchHit {
    title: string;
    /** The result's real URL (redirect wrappers already unwrapped). */
    url: string;
    snippet: string;
    /** ISO date (yyyy-mm-dd) when the result itself carries one; absent = undated, never guessed. */
    publishedDate?: string;
    /** Publisher/display source as reported by the provider (e.g. a cite host), when available. */
    source?: string;
}
/** Options for one provider search. */
export interface ResearchSearchOptions {
    /** Only results published on/after this ISO date (yyyy-mm-dd), as far as the provider can date them. */
    since?: string;
    /** Maximum hits to return. */
    limit: number;
}
/** A web search backend. Implementations must throw {@link ResearchError} on any failure. */
export interface SearchProvider {
    /** Stable provider id stamped into tool output (e.g. "bing-html"). */
    readonly id: string;
    /**
     * Run one search.
     *
     * @param query - The query text (dates belong in `since`, not baked in).
     * @param opts - The `since` bound and result ceiling.
     * @returns The hits in provider rank order; an empty array is a genuine no-results answer.
     */
    search(query: string, opts: ResearchSearchOptions): Promise<ResearchSearchHit[]>;
}
/** Typed research failure. `code` is the machine-stable identity consumers key on. */
export declare class ResearchError extends Error {
    readonly code: string;
    /**
     * @param code - One of RESEARCH_TIMEOUT / RESEARCH_PROVIDER_ERROR /
     * RESEARCH_BLOCKED / RESEARCH_BAD_RESPONSE / RESEARCH_UNSUPPORTED_CONTENT.
     * @param message - The human-readable failure, surfaced to the model verbatim.
     */
    constructor(code: string, message: string);
}
/** Search request budget: a slow provider must surface as a typed timeout, never hang the loop. */
export declare const SEARCH_TIMEOUT_MS = 20000;
/** Page fetch budget. */
export declare const FETCH_TIMEOUT_MS = 30000;
/** Download ceiling for any single research HTTP response; bodies past it are cut and flagged. */
export declare const HTTP_MAX_BYTES = 2000000;
/** One completed research HTTP GET. */
export interface HttpTextResult {
    status: number;
    /** The URL after redirects. */
    finalUrl: string;
    contentType: string;
    text: string;
    /** Total bytes read (capped at the requested ceiling). */
    bytes: number;
    /** True when the body hit the byte ceiling and was cut. */
    truncated: boolean;
}
/**
 * GET a URL as text with a hard timeout and byte ceiling — the shared
 * transport for search providers and the page fetcher.
 *
 * @param url - The URL to fetch (http/https).
 * @param opts - Timeout, byte ceiling, and an error code prefix for
 * transport failures (`RESEARCH_TIMEOUT` is always used for timeouts).
 * @returns The response status, final URL, and body text.
 */
export declare function httpGetText(url: string, opts: {
    timeoutMs: number;
    maxBytes?: number;
    errorCode: string;
}): Promise<HttpTextResult>;
/**
 * Resolve the live search provider from the environment — the single
 * swap point for provider adoption.
 *
 * - `REDTEAM_RESEARCH_PROVIDER` unset or `bing` → the keyless Bing
 *   HTML provider (endpoint overridable via
 *   `REDTEAM_RESEARCH_SEARCH_URL`, e.g. a regional Bing host).
 * - `off` → a provider whose every search throws a typed error: the
 *   operator disabled web research; the tools stay listed and honest.
 * - Any other value is a misconfiguration and throws — fail loud,
 *   never silently fall back to a different provider.
 *
 * @param env - The environment to read (defaults to process.env).
 * @returns The provider for this process.
 */
export declare function resolveSearchProvider(env?: NodeJS.ProcessEnv): SearchProvider;
