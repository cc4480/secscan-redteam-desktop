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

import { randomUUID } from "node:crypto";
import type { ScanVulnerability } from "./scanner";
import { validatedFetch } from "./targetGuard";

const PAGE_TIMEOUT_MS = 8_000;
const CRAWL_TIMEOUT_MS = 30_000;

// Paths that could trigger destructive actions — skip these
const DANGEROUS_PATH_PATTERNS = /logout|signout|delete|remove|destroy|unsubscribe|reset|drop/i;

/**
 * Curated high-value paths probed on every deep scan regardless of whether
 * they appear in the site's HTML — many sensitive endpoints are never linked
 * from the homepage but are reachable by direct URL.
 *
 * Exported so tests and the report UI can reference the canonical list.
 */
export const HIGH_VALUE_PROBE_PATHS: string[] = [
  // Admin / management interfaces
  "/admin", "/administrator", "/wp-admin",
  // API roots (versioned and unversioned)
  "/api", "/api/v1", "/api/v2", "/api/v3",
  // GraphQL
  "/graphql", "/gql",
  // Health / liveness / readiness probes (often unprotected)
  "/health", "/healthz", "/status", "/ping", "/ready", "/live",
  // Authentication entry points
  "/login", "/auth", "/signin",
  // Application dashboard
  "/dashboard",
  // Observability endpoints (often leaked in dev)
  "/metrics",
  // Debug surfaces
  "/debug", "/console",
];

function vuln(partial: Omit<ScanVulnerability, "id">): ScanVulnerability {
  return { id: randomUUID(), ...partial };
}

// ─────────────────────────────────────────────────────────────────────────────
// LINK EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

export function extractInternalLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }

  const seen = new Set<string>();
  const hrefRegex = /href=["']([^"'#?]+)/gi;
  const srcRegex = /(?:src|action)=["']([^"'#?]+\.(?:php|asp|aspx|do|html|htm))/gi;

  const process = (raw: string) => {
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;
    try {
      const u = new URL(raw, baseUrl);
      if (u.hostname !== base.hostname) return;
      if (DANGEROUS_PATH_PATTERNS.test(u.pathname)) return;
      // Only keep paths (ignore hash, query string for dedup)
      const path = u.pathname;
      if (path === "/" || path === base.pathname) return;
      if (seen.has(path)) return;
      seen.add(path);
    } catch { /* skip invalid URLs */ }
  };

  let m: RegExpExecArray | null;
  while ((m = hrefRegex.exec(html)) !== null) process(m[1]);
  while ((m = srcRegex.exec(html)) !== null) process(m[1]);

  // Return as full URLs (high-value path probing is handled separately in crawlAndCheck)
  return [...seen].map((path) => `${base.origin}${path}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE FETCH (GET — needed for Set-Cookie, body, and full response headers)
// ─────────────────────────────────────────────────────────────────────────────

interface PageResult {
  status: number;
  headers: Record<string, string>;
  /** Each Set-Cookie header as a separate entry (avoids Expires= comma mis-parse). */
  setCookies: string[];
  body: string;
  finalUrl: string;
}

async function fetchPage(url: string, timeoutMs: number): Promise<PageResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await validatedFetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VibeScan-Security-Bot/1.0; +https://vibescan.app/bot)",
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
    }, { timeoutMs });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const body = await res.text().catch(() => "");

    // Use getSetCookie() to preserve each Set-Cookie header as a separate string,
    // avoiding mis-parsing cookies that contain commas (e.g. Expires=Thu, 01 Jan …).
    // Falls back to an empty array if the method is unavailable.
    const setCookies: string[] =
      typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
        : [];

    return { status: res.status, headers, setCookies, body, finalUrl: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Light probe — fetches a URL and returns status, headers, body, and final URL after redirects
async function probeUrl(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; headers: Record<string, string>; body: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await validatedFetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VibeScan-Security-Bot/1.0)" },
    }, { timeoutMs });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const body = await res.text().catch(() => "");
    return { status: res.status, headers, body, finalUrl: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-PAGE HEADER CHECKS
// ─────────────────────────────────────────────────────────────────────────────

interface HeaderSnapshot {
  hsts: boolean;
  csp: boolean;
  xfo: boolean;
  xcto: boolean;
  rp: boolean;
}

function snapshotHeaders(headers: Record<string, string>): HeaderSnapshot {
  const h = (name: string) => {
    const k = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return k ? headers[k] : undefined;
  };
  return {
    hsts: !!h("strict-transport-security"),
    csp:  !!h("content-security-policy"),
    xfo:  !!h("x-frame-options") || /frame-ancestors/i.test(h("content-security-policy") ?? ""),
    xcto: h("x-content-type-options")?.toLowerCase() === "nosniff",
    rp:   !!h("referrer-policy"),
  };
}


import { type PathProbe, PATH_PROBES } from "./crawler-data";


/**
 * Run sensitive file probes relative to a discovered path's directory prefix.
 * E.g. for page "/api/v1/users", probes are run under "/api/v1/".
 * timeoutMs caps each individual probe request to respect the overall crawl budget.
 */
async function probePathSensitiveFiles(
  pageUrl: string,
  origin: string,
  expectedHostname: string,
  timeoutMs: number,
): Promise<ScanVulnerability[]> {
  let pathname: string;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return [];
  }

  // Get the directory prefix (everything up to and including the last slash)
  const lastSlash = pathname.lastIndexOf("/");
  const dirPrefix = lastSlash > 0 ? pathname.slice(0, lastSlash + 1) : "/";

  // Skip probing root prefix — root-level probes are already handled by probes.ts
  if (dirPrefix === "/") return [];

  const findings: ScanVulnerability[] = [];

  await Promise.allSettled(
    PATH_PROBES.map(async (probe) => {
      const probeUrl = `${origin}${dirPrefix}${probe.suffix.replace(/^\//, "")}`;
      const result = await probeUrlFn(probeUrl, timeoutMs);
      if (!result || result.status !== 200) return;

      // Ensure we didn't get redirected off-domain (catch-all login pages, etc.)
      // Must check result.finalUrl (the URL after redirects), not the original probeUrl
      try {
        const finalHostname = new URL(result.finalUrl).hostname;
        if (finalHostname !== expectedHostname) return;
      } catch {
        return;
      }

      const ct = result.headers["content-type"] ?? "";
      if (!probe.validate(result.body, ct, result.status)) return;

      findings.push(vuln({
        name: probe.name,
        severity: probe.severity,
        category: probe.category,
        description: probe.description(dirPrefix),
        evidence: `GET ${origin}${dirPrefix}${probe.suffix.replace(/^\//, "")} → HTTP 200 (${result.body.length.toLocaleString()} bytes)\nContent-Type: ${ct || "not set"}`,
        solution: probe.solution,
        cweId: probe.cweId,
        cvssScore: probe.cvssScore,
        wstgId: probe.wstgId,
      }));
    }),
  );

  return findings;
}

// Named alias to avoid shadowing the import at module level
const probeUrlFn = probeUrl;

// ─────────────────────────────────────────────────────────────────────────────
// PER-PAGE COOKIE CHECKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check cookie security flags on a single inner page's Set-Cookie headers.
 *
 * @param seenCookieIssues - shared Set across the whole crawl; each entry is
 *   "issueName::cookieName". Prevents the same cookie problem from being filed
 *   once per crawled page (e.g. Replit's GAESA cookie on every response).
 */
// Cookies set by third-party infrastructure (CDN proxies, load balancers, etc.)
// that the site owner cannot control.  Must match the list in scanner.ts.
const INFRA_COOKIE_NAMES = new Set([
  "gaesa",        // Replit CDN / proxy
  "__cf_bm",      // Cloudflare Bot Management
  "__cflb",       // Cloudflare Load Balancing
  "_cfuvid",      // Cloudflare UVID
  "cf_clearance", // Cloudflare challenge clearance
  "__utmz",       // Google Analytics (legacy)
  "__utma",       // Google Analytics (legacy)
  "_ga",          // Google Analytics
  "_gid",         // Google Analytics
  "_gat",         // Google Analytics throttle
  "bm_sz",        // Akamai Bot Manager — set by CDN, not the site operator
  "bm_sv",        // Akamai Bot Manager session
  "ak_bmsc",      // Akamai Bot Manager session cookie
  "_abck",        // Akamai Bot Manager
]);

function checkPageCookies(
  setCookies: string[],
  pageUrl: string,
  isHttps: boolean,
  seenCookieIssues: Set<string>,
  discoveredBy: "crawl" | "probe",
): ScanVulnerability[] {
  if (setCookies.length === 0) return [];
  const path = (() => { try { return new URL(pageUrl).pathname; } catch { return pageUrl; } })();
  const findings: ScanVulnerability[] = [];
  // Prefix added to evidence lines so the report UI can distinguish how the page was found
  const sourcePrefix = discoveredBy === "probe" ? "[Direct probe] " : "";

  for (const cookie of setCookies) {
    if (!cookie.trim()) continue;
    // Skip malformed Set-Cookie fragments that have no name=value pair.
    // These arise from dates in expires= values that get mis-split upstream.
    const firstSegment = cookie.split(";")[0] ?? "";
    if (!firstSegment.includes("=")) continue;
    const namePart = firstSegment.split("=")[0]?.trim() ?? "cookie";

    // Skip infrastructure-owned cookies that the site operator cannot modify.
    if (INFRA_COOKIE_NAMES.has(namePart.toLowerCase())) continue;

    if (isHttps && !/secure/i.test(cookie)) {
      const key = `secure::${namePart}`;
      if (!seenCookieIssues.has(key)) {
        seenCookieIssues.add(key);
        findings.push(vuln({
          name: "Cookie Missing Secure Flag on Inner Page",
          severity: "high",
          category: "Session Management",
          description: `The page "${path}" sets the cookie "${namePart}" without the Secure flag, allowing it to be transmitted over unencrypted HTTP even on an HTTPS site.`,
          evidence: `${sourcePrefix}GET ${pageUrl}\nSet-Cookie: ${cookie.trim()}`,
          solution: "Add the Secure attribute to all cookies: Set-Cookie: name=value; Secure; HttpOnly; SameSite=Lax",
          cweId: "CWE-614",
          cvssScore: 6.5,
          wstgId: "WSTG-SESS-02",
        }));
      }
    }

    if (!/httponly/i.test(cookie)) {
      const key = `httponly::${namePart}`;
      if (!seenCookieIssues.has(key)) {
        seenCookieIssues.add(key);
        findings.push(vuln({
          name: "Cookie Missing HttpOnly Flag on Inner Page",
          severity: "medium",
          category: "Session Management",
          description: `The page "${path}" sets the cookie "${namePart}" without the HttpOnly flag, allowing client-side JavaScript to access it. This enables session theft via XSS.`,
          evidence: `${sourcePrefix}GET ${pageUrl}\nSet-Cookie: ${cookie.trim()}`,
          solution: "Add the HttpOnly attribute to all session cookies: Set-Cookie: name=value; HttpOnly; Secure; SameSite=Lax",
          cweId: "CWE-1004",
          cvssScore: 5.3,
          wstgId: "WSTG-SESS-02",
        }));
      }
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATE HEADER-GAP FINDINGS
// ─────────────────────────────────────────────────────────────────────────────

interface HeaderGapMeta {
  header: string;
  severity: ScanVulnerability["severity"];
  cweId: string;
  cvssScore: number;
  wstgId: string;
  description: string;
  solution: string;
}

const HEADER_GAP_META: Record<keyof HeaderSnapshot, HeaderGapMeta> = {
  hsts: {
    header: "Strict-Transport-Security",
    severity: "high",
    cweId: "CWE-523",
    cvssScore: 7.4,
    wstgId: "WSTG-CONF-07",
    description:
      "The root URL has HSTS configured, but the following internal routes respond without the header. Routes that bypass the CDN (e.g. API endpoints hitting origin directly) won't enforce HTTPS-only connections.",
    solution:
      "Ensure HSTS is set at the application layer, not just the CDN, so all responses include the header: Strict-Transport-Security: max-age=31536000; includeSubDomains",
  },
  csp: {
    header: "Content-Security-Policy",
    severity: "high",
    cweId: "CWE-79",
    cvssScore: 7.2,
    wstgId: "WSTG-CONF-12",
    description:
      "CSP is present on the root URL but absent on some internal routes. API endpoints and authenticated pages often need CSP too — injected content on those pages can steal tokens.",
    solution:
      "Apply CSP at the application/middleware layer for all routes, not just the homepage. Use a base policy that works across your entire app.",
  },
  xfo: {
    header: "X-Frame-Options / frame-ancestors",
    severity: "medium",
    cweId: "CWE-1021",
    cvssScore: 4.3,
    wstgId: "WSTG-CLNT-09",
    description:
      "Clickjacking protection is set on the root URL but missing on some internal pages. Those pages can be embedded in malicious iframes.",
    solution:
      "Apply X-Frame-Options: DENY (or SAMEORIGIN) globally via middleware, not per-route.",
  },
  xcto: {
    header: "X-Content-Type-Options",
    severity: "medium",
    cweId: "CWE-16",
    cvssScore: 4.3,
    wstgId: "WSTG-CONF-07",
    description:
      "X-Content-Type-Options: nosniff is on the root page but missing on some internal routes, leaving those routes open to MIME-sniffing attacks.",
    solution: "Set X-Content-Type-Options: nosniff globally in your server/middleware.",
  },
  rp: {
    header: "Referrer-Policy",
    severity: "low",
    cweId: "CWE-200",
    cvssScore: 3.1,
    wstgId: "WSTG-CONF-07",
    description:
      "Referrer-Policy is set on the root URL but absent on some internal routes.",
    solution: "Set Referrer-Policy globally: strict-origin-when-cross-origin",
  },
};

function buildHeaderGapVulns(
  rootSnapshot: HeaderSnapshot,
  gapMap: Map<keyof HeaderSnapshot, string[]>,
  probedSet: Set<string>,
): ScanVulnerability[] {
  const results: ScanVulnerability[] = [];

  for (const [key, paths] of gapMap.entries()) {
    if (paths.length === 0) continue;
    const meta = HEADER_GAP_META[key];
    if (!meta) continue;

    // Only flag if root page HAD the header (makes this a regression, not a new issue)
    if (!rootSnapshot[key]) continue;

    const displayPaths = paths.slice(0, 6).map((p) => {
      try {
        const pathname = new URL(p).pathname;
        const tag = probedSet.has(p) ? " (probed)" : " (crawled)";
        return pathname + tag;
      } catch { return p; }
    });

    results.push(vuln({
      name: `${meta.header} Missing on ${paths.length} Internal Route${paths.length > 1 ? "s" : ""}`,
      severity: meta.severity,
      category: "Security Header Inconsistency",
      description: meta.description,
      evidence: `Routes missing ${meta.header}:\n${displayPaths.map((p) => `  • ${p}`).join("\n")}${paths.length > 6 ? `\n  … and ${paths.length - 6} more` : ""}`,
      solution: meta.solution,
      cweId: meta.cweId,
      cvssScore: meta.cvssScore,
      wstgId: meta.wstgId,
    }));
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

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

export async function crawlAndCheck(
  rootUrl: string,
  rootHtml: string,
  rootHeaders: Record<string, string>,
  maxPages: number,
): Promise<CrawlResult> {
  let origin: string;
  let expectedHostname: string;
  try {
    const parsed = new URL(rootUrl);
    origin = parsed.origin;
    expectedHostname = parsed.hostname;
  } catch {
    return { vulnerabilities: [], pagesVisited: [], probedNotFound: [] };
  }

  // ── URL list construction ────────────────────────────────────────────────
  //
  // Two separate sources:
  //   1. linkedUrls  — URLs discovered in the root page HTML (capped by maxPages)
  //   2. probedUrls  — HIGH_VALUE_PROBE_PATHS always checked regardless of maxPages
  //
  // Probed paths skip any path that overlaps with a crawled link (same pathname)
  // and any path that matches the dangerous-action pattern.

  const linkedUrls: string[] = maxPages > 0
    ? extractInternalLinks(rootHtml, rootUrl).slice(0, maxPages)
    : [];

  const linkedPathnames = new Set(
    linkedUrls.map((u) => { try { return new URL(u).pathname; } catch { return u; } }),
  );

  const probedUrls: string[] = HIGH_VALUE_PROBE_PATHS
    .filter((p) => !DANGEROUS_PATH_PATTERNS.test(p))
    .filter((p) => !linkedPathnames.has(p))
    .map((p) => `${origin}${p}`);

  // Set of probed URLs for labelling findings — checked with full URL equality
  const probedSet = new Set<string>(probedUrls);

  // If there's nothing to check at all, bail early
  if (linkedUrls.length === 0 && probedUrls.length === 0) {
    return { vulnerabilities: [], pagesVisited: [], probedNotFound: [] };
  }

  const rootSnapshot = snapshotHeaders(rootHeaders);
  const isHttps = rootUrl.startsWith("https://");

  // Shared dedup set for cookie findings — prevents the same cookie issue
  // (e.g. GAESA missing Secure) from being filed once per crawled page.
  // Key format: "issueType::cookieName"
  const seenCookieIssues = new Set<string>();

  // Track which header is missing on which paths (for gap aggregation)
  const gapMap = new Map<keyof typeof rootSnapshot, string[]>([
    ["hsts", []],
    ["csp",  []],
    ["xfo",  []],
    ["xcto", []],
    ["rp",   []],
  ]);

  const crawlDeadline = Date.now() + CRAWL_TIMEOUT_MS;
  const perPageFindings: ScanVulnerability[] = [];
  const pagesVisited: string[] = [];

  // Minimum remaining budget required to start a new page fetch (avoids starting
  // a request that can never complete within the overall time bound)
  const MIN_BUDGET_MS = 1_000;

  /**
   * Fetch and analyse a single page.
   * @param url          Full URL to fetch
   * @param discoveredBy Whether this URL came from HTML crawling or direct probing
   * @returns The HTTP status code returned by the server, or null if the request
   *          was not attempted (budget exhausted) or resulted in a network error.
   *          Callers can check for 404 specifically to record "probed but not found".
   */
  const processPage = async (url: string, discoveredBy: "crawl" | "probe"): Promise<number | null> => {
    const remaining = crawlDeadline - Date.now();
    if (remaining < MIN_BUDGET_MS) return null;

    // Cap per-fetch timeout to whatever budget remains (hard deadline enforcement)
    const fetchTimeout = Math.min(PAGE_TIMEOUT_MS, remaining);

    const page = await fetchPage(url, fetchTimeout);
    if (!page || page.status === 0 || page.status >= 400) return page?.status ?? null;

    // Verify we didn't get redirected off-domain (catch-all login redirects, etc.)
    try {
      const finalHostname = new URL(page.finalUrl).hostname;
      if (finalHostname !== expectedHostname) return page.status;
    } catch {
      return page.status;
    }

    // Record this URL as successfully visited
    pagesVisited.push(url);

    // ── Header gap tracking ────────────────────────────────────────────────
    const snap = snapshotHeaders(page.headers);
    for (const key of Object.keys(rootSnapshot) as (keyof typeof rootSnapshot)[]) {
      if (rootSnapshot[key] && !snap[key]) {
        const list = gapMap.get(key) ?? [];
        list.push(url);
        gapMap.set(key, list);
      }
    }

    // ── Cookie checks ──────────────────────────────────────────────────────
    perPageFindings.push(
      ...checkPageCookies(page.setCookies, url, isHttps, seenCookieIssues, discoveredBy),
    );

    // ── Sensitive file probes under this path's directory ──────────────────
    const probeRemaining = crawlDeadline - Date.now();
    if (probeRemaining >= MIN_BUDGET_MS) {
      const probeTimeout = Math.min(PAGE_TIMEOUT_MS, probeRemaining);
      const pathFindings = await probePathSensitiveFiles(url, origin, expectedHostname, probeTimeout);
      perPageFindings.push(...pathFindings);
    }

    return page.status;
  };

  // Process linked pages first (sequential — respects time budget per iteration)
  for (const url of linkedUrls) {
    if (Date.now() + MIN_BUDGET_MS > crawlDeadline) break;
    await processPage(url, "crawl");
  }

  // Process directly-probed high-value paths (also sequential to respect budget).
  // Collect those that returned exactly HTTP 404 — "probed but not found" in the report.
  const probedNotFound: string[] = [];
  for (const url of probedUrls) {
    if (Date.now() + MIN_BUDGET_MS > crawlDeadline) break;
    const status = await processPage(url, "probe");
    if (status === 404) probedNotFound.push(url);
  }

  // Aggregate header gap findings (one finding per header type covering all affected paths)
  const headerGapFindings = buildHeaderGapVulns(rootSnapshot, gapMap, probedSet);

  // Deduplicate: sensitive file probes may return the same finding for different paths
  const seenSensitiveKeys = new Set<string>();
  const dedupedPerPage: ScanVulnerability[] = [];
  for (const finding of perPageFindings) {
    const key = `${finding.name}::${finding.evidence?.slice(0, 80) ?? ""}`;
    if (!seenSensitiveKeys.has(key)) {
      seenSensitiveKeys.add(key);
      dedupedPerPage.push(finding);
    }
  }

  return {
    vulnerabilities: [...headerGapFindings, ...dedupedPerPage],
    pagesVisited,
    probedNotFound,
  };
}
