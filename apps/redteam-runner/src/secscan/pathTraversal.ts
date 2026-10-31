/**
 * Path traversal / Local File Inclusion (LFI) active probing.
 *
 * Strategy:
 *  1. Collect candidate (path, param) pairs from:
 *     a. File-related query params already on the target URL.
 *     b. File-related params found in in-page links (first 50 KB of HTML).
 *     c. Common file-serving endpoint patterns probed with known param names.
 *  2. For each candidate, send a small set of traversal payloads.
 *  3. Confirm a finding only when the response body contains definitive
 *     file content (e.g. /etc/passwd root entry or win.ini section markers).
 *
 * Only runs on deep-tier scans. Non-fatal — all errors return [].
 */

import { randomUUID } from "node:crypto";
import type { ScanVulnerability } from "./scanner";
import { PATH_TRAVERSAL_TEMPLATES, classifyTraversalBody } from "./payloads";
import { validatedFetch } from "./targetGuard";

const TIMEOUT_MS = 7_000;

function vuln(partial: Omit<ScanVulnerability, "id">): ScanVulnerability {
  return { id: randomUUID(), ...partial };
}

// ─── File-related parameter names ─────────────────────────────────────────────

const FILE_PARAMS = new Set([
  "file", "page", "path", "include", "template", "view", "doc",
  "document", "load", "read", "filename", "src", "data", "folder",
  "dir", "pg", "module", "conf", "cfg", "content", "layout",
  "resource", "section", "action", "name", "f", "p",
]);

// ─── Common probe endpoints ───────────────────────────────────────────────────

const PROBE_ENDPOINTS = [
  "/download", "/file", "/include", "/load", "/read",
  "/view", "/serve", "/assets", "/resource", "/template",
  "/content", "/page", "/render", "/fetch",
];

const PROBE_PARAMS = ["file", "path", "doc", "page", "name"];

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function safeGet(url: string): Promise<{ status: number; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await validatedFetch(url, { signal: controller.signal }, { timeoutMs: TIMEOUT_MS });
    if (!res.ok && res.status !== 200) return null;
    const body = await res.text().catch(() => "");
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function checkPathTraversal(
  targetUrl: string,
  html: string,
): Promise<ScanVulnerability[]> {
  let origin: string;
  let targetPath: string;

  try {
    const parsed = new URL(targetUrl);
    origin = parsed.origin;
    targetPath = parsed.pathname;
  } catch {
    return [];
  }

  // ── Collect (path, param) test cases ────────────────────────────────────────

  const seen = new Set<string>();
  const cases: Array<{ path: string; param: string }> = [];

  function addCase(path: string, param: string) {
    const key = `${path}::${param}`;
    if (seen.has(key)) return;
    seen.add(key);
    cases.push({ path, param });
  }

  // 1. File-related params already on the target URL
  try {
    for (const [k] of new URL(targetUrl).searchParams.entries()) {
      if (FILE_PARAMS.has(k.toLowerCase())) addCase(targetPath, k);
    }
  } catch { /* ignored */ }

  // 2. File-related params found in in-page links
  const linkRx = /href=["']([^"'#?]+\?[^"']+)["']/gi;
  const sample = html.slice(0, 60_000);
  let lm: RegExpExecArray | null;
  while ((lm = linkRx.exec(sample)) !== null && cases.length < 25) {
    try {
      const u = new URL(lm[1]!, origin);
      for (const [k] of u.searchParams.entries()) {
        if (FILE_PARAMS.has(k.toLowerCase())) addCase(u.pathname, k);
      }
    } catch { /* invalid */ }
  }

  // 3. Common probe endpoint + param combos
  for (const ep of PROBE_ENDPOINTS) {
    for (const param of PROBE_PARAMS) {
      addCase(ep, param);
      if (cases.length >= 40) break;
    }
    if (cases.length >= 40) break;
  }

  // ── Test payloads ────────────────────────────────────────────────────────────
  // Run all cases concurrently but resolve on the first confirmed hit.

  for (const { path, param } of cases.slice(0, 40)) {
    for (const payload of PATH_TRAVERSAL_TEMPLATES) {
      const testUrl = new URL(`${origin}${path}`);
      testUrl.searchParams.set(param, payload);

      const result = await safeGet(testUrl.toString());
      if (!result) continue;

      const os = classifyTraversalBody(result.body);
      if (!os) continue;

      const target = os === "linux" ? "/etc/passwd" : "windows/win.ini";
      return [
        vuln({
          name: "Path Traversal / Local File Inclusion (LFI)",
          severity: "critical",
          category: "Information Disclosure",
          description: `The '${param}' parameter on ${path} is vulnerable to directory traversal. By injecting sequences like '../../../${target}', an attacker can read arbitrary files from the server filesystem — including application source code, configuration files with credentials, SSH private keys, and system files.`,
          evidence: `Endpoint: ${path}?${param}=<payload>\nPayload used: ${payload}\nServer OS: ${os === "linux" ? "Linux/Unix" : "Windows"}\nResponse contained ${target} content patterns.`,
          solution:
            "Never construct file system paths from user input. If file selection is required: (1) Use an allowlist of permitted file names or IDs only, (2) Resolve the final path with path.resolve() or equivalent and assert it starts within the permitted directory, (3) Never pass user-controlled values directly to file-reading APIs. Block any path containing '..', encoded variants, or null bytes at the input validation layer.",
          cweId: "CWE-22",
          cvssScore: 9.8,
          wstgId: "WSTG-AUTHZ-01",
        }),
      ];
    }
  }

  return [];
}
