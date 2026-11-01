/**
 * Web research provider seam — the execution layer behind the fleet's
 * deep-research-osint skill.
 *
 * The skill's contract assumes a search tool with a date/`since`
 * parameter whose output carries citable results (index, title, exact
 * URL, publication date when one exists). This module is the seam that
 * obligation lands on: a {@link SearchProvider} turns a query into
 * dated, citable hits, and {@link httpGetText} is the one HTTP path
 * every provider and the page fetcher share — one place for timeouts,
 * byte caps, and typed failures. A failed lookup NEVER yields invented
 * results: every failure is a {@link ResearchError} with a stable code
 * the dispatcher surfaces verbatim, and the model is told to mark the
 * claim UNVERIFIED (the skill's silent-fallback reversal).
 *
 * Provider choice (2026-11-01 survey, no new credentials, no
 * purchases): the default provider is the keyless Bing HTML endpoint
 * (research/bing.ts) — the DuckDuckGo HTML/Lite endpoints answer this
 * network origin with bot-challenge pages carrying zero results, while
 * Bing serves real result markup. SWAP POINT: to adopt a keyed
 * provider (Brave Search, Tavily) implement {@link SearchProvider},
 * add one case to {@link resolveSearchProvider}, and read its key from
 * the environment — no handler, scope, or test changes. Provider
 * markup is an unofficial interface: when it changes, the provider
 * throws RESEARCH_BAD_RESPONSE instead of fabricating hits.
 */
import { BingSearchProvider } from "./bing.js";

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
export class ResearchError extends Error {
  readonly code: string;
  /**
   * @param code - One of RESEARCH_TIMEOUT / RESEARCH_PROVIDER_ERROR /
   * RESEARCH_BLOCKED / RESEARCH_BAD_RESPONSE / RESEARCH_UNSUPPORTED_CONTENT.
   * @param message - The human-readable failure, surfaced to the model verbatim.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "ResearchError";
    this.code = code;
  }
}

/** Search request budget: a slow provider must surface as a typed timeout, never hang the loop. */
export const SEARCH_TIMEOUT_MS = 20_000;
/** Page fetch budget. */
export const FETCH_TIMEOUT_MS = 30_000;
/** Download ceiling for any single research HTTP response; bodies past it are cut and flagged. */
export const HTTP_MAX_BYTES = 2_000_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

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
export async function httpGetText(
  url: string,
  opts: { timeoutMs: number; maxBytes?: number; errorCode: string },
): Promise<HttpTextResult> {
  const maxBytes = opts.maxBytes ?? HTTP_MAX_BYTES;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": BROWSER_UA, "accept-language": "en-US,en;q=0.9" },
    });
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return {
        status: res.status,
        finalUrl: res.url || url,
        contentType: res.headers.get("content-type") ?? "",
        text,
        bytes: Buffer.byteLength(text),
        truncated: false,
      };
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        chunks.push(Buffer.from(value.subarray(0, value.byteLength - (bytes - maxBytes))));
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(Buffer.from(value));
    }
    return {
      status: res.status,
      finalUrl: res.url || url,
      contentType: res.headers.get("content-type") ?? "",
      text: Buffer.concat(chunks).toString("utf8"),
      bytes,
      truncated,
    };
  } catch (e) {
    if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
      throw new ResearchError(
        "RESEARCH_TIMEOUT",
        `request to ${safeHost(url)} did not finish within ${opts.timeoutMs}ms`,
      );
    }
    throw new ResearchError(
      opts.errorCode,
      `request to ${safeHost(url)} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Host for error text: a full URL can carry query secrets; the host cannot. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable URL)";
  }
}

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
export function resolveSearchProvider(env: NodeJS.ProcessEnv = process.env): SearchProvider {
  const choice = (env["REDTEAM_RESEARCH_PROVIDER"] ?? "bing").trim().toLowerCase();
  if (choice === "bing") {
    return new BingSearchProvider(env["REDTEAM_RESEARCH_SEARCH_URL"] ?? undefined);
  }
  if (choice === "off") {
    return {
      id: "off",
      async search(): Promise<ResearchSearchHit[]> {
        throw new ResearchError(
          "RESEARCH_PROVIDER_ERROR",
          "web research is disabled by the operator (REDTEAM_RESEARCH_PROVIDER=off)",
        );
      },
    };
  }
  throw new ResearchError(
    "RESEARCH_PROVIDER_ERROR",
    `unknown REDTEAM_RESEARCH_PROVIDER ${JSON.stringify(choice)} — known values: bing, off. Refusing to guess a provider.`,
  );
}
