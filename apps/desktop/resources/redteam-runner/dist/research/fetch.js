/**
 * Page fetcher for the research tools: one URL in, readable text out,
 * stamped with its source and retrieval time.
 *
 * The stamp is part of the citation contract — a fetched page's claims
 * are only citable with the URL they came from and the date they were
 * retrieved (the skill's currency gate). Caps are explicit and
 * flagged, never silent: the download stops at HTTP_MAX_BYTES
 * (provider.ts) and the extracted text is cut at MAX_TEXT_CHARS with a
 * marker in the text itself. The dispatch result then flows through
 * the loop's existing spill seam (tool-spill.ts), so a capped page is
 * still readable back in full via read_spill up to the retained cap.
 */
import { extractReadableText } from "./text.js";
import { httpGetText, ResearchError, FETCH_TIMEOUT_MS } from "./provider.js";
/** Extracted-text ceiling retained per fetch; the cut is marked in the text. */
export const MAX_TEXT_CHARS = 100_000;
/**
 * Fetch one page and extract its readable text.
 *
 * @param url - The page URL (http/https; the dispatcher validates and
 * scope-checks it before this runs).
 * @returns The stamped page.
 */
export async function fetchPage(url) {
    const res = await httpGetText(url, { timeoutMs: FETCH_TIMEOUT_MS, errorCode: "RESEARCH_PROVIDER_ERROR" });
    if (res.status === 429 || res.status === 403) {
        throw new ResearchError("RESEARCH_BLOCKED", `the source refused the fetch (HTTP ${res.status}) — rate limit or bot challenge; no content was fabricated`);
    }
    if (res.status < 200 || res.status >= 300) {
        throw new ResearchError("RESEARCH_PROVIDER_ERROR", `the source answered HTTP ${res.status} for ${url}`);
    }
    const type = res.contentType.toLowerCase();
    const isHtml = type.includes("text/html") || type.includes("application/xhtml+xml");
    const isText = isHtml || type.startsWith("text/") || type.includes("application/json") || type.includes("application/xml") || type.includes("+xml");
    if (!isText) {
        throw new ResearchError("RESEARCH_UNSUPPORTED_CONTENT", `${url} served ${res.contentType || "an unknown content type"} — research_fetch returns readable text only`);
    }
    const raw = isHtml ? extractReadableText(res.text) : res.text;
    let truncated = res.truncated;
    let text = raw;
    if (raw.length > MAX_TEXT_CHARS) {
        text =
            raw.slice(0, MAX_TEXT_CHARS) +
                `\n[research_fetch: page text capped at ${MAX_TEXT_CHARS} chars of ${raw.length}; the remainder was not retained]`;
        truncated = true;
    }
    return {
        requestedUrl: url,
        finalUrl: res.finalUrl,
        retrievedAt: new Date().toISOString(),
        contentType: res.contentType,
        bytes: res.bytes,
        truncated,
        text,
    };
}
//# sourceMappingURL=fetch.js.map