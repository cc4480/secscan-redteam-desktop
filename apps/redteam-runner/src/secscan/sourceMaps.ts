/**
 * Source map exposure check.
 *
 * Bundlers (webpack, Vite, esbuild, Parcel) optionally emit .map files that
 * contain the full un-minified source — identical to shipping your source code.
 * These are frequently deployed to production by accident.
 *
 * Approach:
 *  1. Extract all <script src="…"> URLs from the page HTML.
 *  2. For each external JS file (up to 8), request <url>.map directly.
 *  3. Also scan the last 512 bytes of each JS file for a
 *     "//# sourceMappingURL=…" comment pointing to a named map file.
 *  4. Confirm a finding only when the response is valid source-map JSON
 *     (has "sources" array with ≥1 entry, or "sourcesContent" present).
 *
 * Runs on both tiers (only HEAD + small trailer fetches — fast).
 */

import { randomUUID } from "node:crypto";
import type { ScanVulnerability } from "./scanner";

const TIMEOUT_MS = 8_000;
const MAX_JS_FILES = 8;
const TRAILER_BYTES = 512;

function vuln(partial: Omit<ScanVulnerability, "id">): ScanVulnerability {
  return { id: randomUUID(), ...partial };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function tryFetch(
  url: string,
  rangeHeader?: string,
): Promise<{ ok: boolean; body: string; ct: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (rangeHeader) headers["Range"] = rangeHeader;
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok && res.status !== 206) return null;
    const body = await res.text().catch(() => "");
    const ct = res.headers.get("content-type") ?? "";
    return { ok: true, body, ct };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractJsUrls(html: string, baseUrl: string): string[] {
  const srcRx = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const urls: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = srcRx.exec(html)) !== null) {
    try {
      const abs = new URL(m[1]!, baseUrl).href;
      // Only external bundled scripts (skip CDN libs — they publish maps intentionally)
      const host = new URL(baseUrl).hostname;
      if (new URL(abs).hostname === host) urls.push(abs);
    } catch { /* skip */ }
  }
  return [...new Set(urls)].slice(0, MAX_JS_FILES);
}

function isValidSourceMap(body: string): boolean {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const sources = json["sources"];
    return (
      Array.isArray(sources) &&
      sources.length > 0 &&
      (typeof sources[0] === "string")
    );
  } catch {
    return false;
  }
}

function sourceCount(body: string): number {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const sources = json["sources"];
    return Array.isArray(sources) ? sources.length : 0;
  } catch {
    return 0;
  }
}

function hasSourceContent(body: string): boolean {
  return /"sourcesContent"/.test(body);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function checkSourceMaps(
  html: string,
  baseUrl: string,
): Promise<ScanVulnerability[]> {
  const jsUrls = extractJsUrls(html, baseUrl);
  if (jsUrls.length === 0) return [];

  const results = await Promise.allSettled(
    jsUrls.map(async (jsUrl): Promise<ScanVulnerability | null> => {
      // 1. Try the obvious <url>.map directly
      const directMapUrl = jsUrl + ".map";
      const direct = await tryFetch(directMapUrl);
      if (direct && isValidSourceMap(direct.body)) {
        const n = sourceCount(direct.body);
        const hasContent = hasSourceContent(direct.body);
        const mapPath = (() => { try { return new URL(directMapUrl).pathname; } catch { return directMapUrl; } })();
        return vuln({
          name: "JavaScript Source Map Exposed — Full Source Code Accessible",
          severity: "high",
          category: "Source Code Exposure",
          description: `A JavaScript source map file is publicly accessible at ${mapPath}. Source maps contain the complete original source code before minification or bundling — including comments, variable names, file paths, and any secrets that existed in the source at build time. Anyone can reconstruct your full application source code by downloading this file.`,
          evidence: `Source map URL: ${directMapUrl}\nSource files mapped: ${n}${hasContent ? "\nFull source content (sourcesContent) included." : ""}`,
          solution: "Disable source map generation in production builds. Webpack: set devtool: false or devtool: 'hidden-source-map' (generates maps but does not link them from the bundle). Vite: set build.sourcemap: false. If you need source maps for error tracking, upload them directly to your error tracker (Sentry, Datadog) and keep them off the public server.",
          cweId: "CWE-540",
          cvssScore: 7.5,
          wstgId: "WSTG-CONF-04",
        });
      }

      // 2. Fetch the last TRAILER_BYTES of the JS file to find sourceMappingURL comment
      const trailer = await tryFetch(jsUrl, `bytes=-${TRAILER_BYTES}`);
      if (!trailer) return null;

      const mappingMatch = /\/\/# sourceMappingURL=([^\s]+)/.exec(trailer.body);
      if (!mappingMatch) return null;

      const rawMapping = mappingMatch[1]!;
      // Skip data: URIs (inline maps — not a server exposure)
      if (rawMapping.startsWith("data:")) return null;

      let mapUrl: string;
      try {
        mapUrl = new URL(rawMapping, jsUrl).href;
        // Only check same-origin maps
        if (new URL(mapUrl).hostname !== new URL(baseUrl).hostname) return null;
      } catch {
        return null;
      }

      const linked = await tryFetch(mapUrl);
      if (!linked || !isValidSourceMap(linked.body)) return null;

      const n = sourceCount(linked.body);
      const hasContent = hasSourceContent(linked.body);
      const mapPath = (() => { try { return new URL(mapUrl).pathname; } catch { return mapUrl; } })();
      return vuln({
        name: "JavaScript Source Map Exposed — Full Source Code Accessible",
        severity: "high",
        category: "Source Code Exposure",
        description: `A JavaScript source map is linked from the production bundle and publicly accessible at ${mapPath}. Source maps reconstruct your complete original source code, including all business logic, internal endpoints, and any secrets present at build time.`,
        evidence: `Linked from: ${(() => { try { return new URL(jsUrl).pathname; } catch { return jsUrl; } })()}\nSource map URL: ${mapUrl}\nSource files mapped: ${n}${hasContent ? "\nFull sourcesContent included." : ""}`,
        solution: "Set devtool: false (webpack) or build.sourcemap: false (Vite) in production. Upload maps to your error tracker instead of serving them publicly.",
        cweId: "CWE-540",
        cvssScore: 7.5,
        wstgId: "WSTG-CONF-04",
      });
    }),
  );

  // Deduplicate — only report once even if multiple JS files have exposed maps
  const seen = new Set<string>();
  return results
    .filter((r): r is PromiseFulfilledResult<ScanVulnerability | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v): v is ScanVulnerability => {
      if (!v) return false;
      if (seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    });
}
