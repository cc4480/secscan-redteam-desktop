/**
 * Site crawler — follows same-domain links, then for each inner page:
 *   1. Checks security response headers (reports gaps vs. root page)
 *   2. Probes for sensitive files relative to the discovered path
 *   3. Checks cookie security flags on Set-Cookie headers
 *
 * The root URL is often served via a CDN that injects security headers, while
 * inner routes (especially /api/* paths) bypass the CDN and hit the origin
 * server directly — missing headers entirely. This catches those gaps.
 *
 * Findings include the specific affected paths in their evidence.
 */
import type { ScanVulnerability } from "./scanner.js";
/**
 * Curated high-value paths probed on every deep scan regardless of whether
 * they appear in the site's HTML — many sensitive endpoints are never linked
 * from the homepage but are reachable by direct URL.
 *
 * Exported so tests and the report UI can reference the canonical list.
 */
export declare const HIGH_VALUE_PROBE_PATHS: string[];
export declare function extractInternalLinks(html: string, baseUrl: string): string[];
export interface CrawlResult {
    vulnerabilities: ScanVulnerability[];
    /** URLs that were actually fetched (status < 400, not redirected off-domain) */
    pagesVisited: string[];
    /**
     * High-value probe paths (from HIGH_VALUE_PROBE_PATHS) that returned HTTP 404.
     * Only explicit probes are included — crawled links that 404'd are excluded.
     * Paths that failed with other status codes (401, 403, 5xx), timed out, or
     * were redirected off-domain are also excluded; they are not "not found", they
     * were actively blocked or unavailable.
     */
    probedNotFound: string[];
}
export declare function crawlAndCheck(rootUrl: string, rootHtml: string, rootHeaders: Record<string, string>, maxPages: number): Promise<CrawlResult>;
