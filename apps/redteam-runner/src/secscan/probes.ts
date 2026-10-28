/**
 * Active security probes — HTTP-based checks run in parallel alongside the main header scan.
 * Each probe is independent and best-effort (failures are non-fatal).
 *
 * Covers: sensitive file exposure, HTTP methods, active CORS, open redirects,
 * robots.txt analysis, Subresource Integrity, error disclosure, HTTPS redirect,
 * rate limiting, directory listing, and clickjacking verification.
 */

import { randomUUID } from "node:crypto";
import type { ScanVulnerability } from "./scanner";
import { OPEN_REDIRECT_PROBE, OPEN_REDIRECT_PARAMS } from "./payloads";
import { validatedFetch } from "./targetGuard";

const PROBE_TIMEOUT_MS = 8_000;

function vuln(partial: Omit<ScanVulnerability, "id">): ScanVulnerability {
  return { id: randomUUID(), ...partial };
}

async function safeGet(
  url: string,
  options: RequestInit = {},
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ status: number; body: string; headers: Record<string, string>; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await validatedFetch(url, { ...options, signal: controller.signal }, { timeoutMs });
    const body = await res.text().catch(() => "");
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { status: res.status, body, headers, finalUrl: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SENSITIVE FILE EXPOSURE
// ─────────────────────────────────────────────────────────────────────────────

import { type SensitivePath, SENSITIVE_PATHS } from "./probes-data";


export async function checkSensitiveFiles(baseUrl: string): Promise<ScanVulnerability[]> {
  let origin: string;
  let expectedHost: string;
  try {
    const parsed = new URL(baseUrl);
    origin = parsed.origin;
    expectedHost = parsed.hostname;
  } catch {
    return [];
  }

  const results = await Promise.allSettled(
    SENSITIVE_PATHS.map(async (p): Promise<ScanVulnerability | null> => {
      const url = `${origin}${p.path}`;
      const result = await safeGet(url, { redirect: "follow" });
      if (!result || result.status !== 200) return null;

      // Redirected to a different host = catch-all (login page etc.)
      try {
        const finalHost = new URL(result.finalUrl).hostname;
        if (finalHost !== expectedHost) return null;
      } catch {
        return null;
      }

      const ct = result.headers["content-type"] ?? "";
      if (!p.validate(result.body, ct)) return null;

      const wstgId = /phpmyadmin|adminer|admin\s+panel|admin\s+interface|management\s+interface/i.test(p.name)
        ? "WSTG-CONF-05"
        : "WSTG-CONF-04";
      return vuln({
        name: p.name,
        severity: p.severity,
        category: p.category,
        description: p.description,
        evidence: `GET ${origin}${p.path} → HTTP 200 (${result.body.length.toLocaleString()} bytes)\nContent-Type: ${ct || "not set"}`,
        solution: p.solution,
        cweId: p.cweId,
        cvssScore: p.cvssScore,
        wstgId,
      });
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<ScanVulnerability | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v): v is ScanVulnerability => v !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. HTTP METHODS PROBE
// ─────────────────────────────────────────────────────────────────────────────

export async function checkHttpMethods(targetUrl: string): Promise<ScanVulnerability[]> {
  const result = await safeGet(targetUrl, { method: "OPTIONS", redirect: "follow" });
  if (!result) return [];

  // Only read the standard HTTP Allow header — NOT Access-Control-Allow-Methods.
  // ACAM is a CORS preflight header that legitimately lists methods for cross-origin
  // requests; conflating it with Allow would flag all CORS-enabled API endpoints as
  // "dangerous methods" false positives.
  const allow = result.headers["allow"] ?? "";
  if (!allow) return [];

  const vulns: ScanVulnerability[] = [];

  if (/\bTRACE\b/i.test(allow)) {
    vulns.push(vuln({
      name: "HTTP TRACE Method Enabled (Cross-Site Tracing)",
      severity: "medium",
      category: "HTTP Security",
      description: "The HTTP TRACE method is enabled. It reflects the full request back to the client—including headers like Authorization and Cookie. Combined with XSS (Cross-Site Tracing / XST), an attacker can steal session tokens that are marked HttpOnly, bypassing that protection.",
      evidence: `OPTIONS ${targetUrl}\nAllow: ${allow}`,
      solution: "Disable TRACE server-wide. Apache: `TraceEnable Off`. Nginx: already off by default. IIS: Use URLScan or Request Filtering. This should be disabled regardless of whether XSS is present.",
      cweId: "CWE-16",
      cvssScore: 5.8,
      wstgId: "WSTG-CONF-06",
    }));
  }

  const dangerousMethods = ["PUT", "DELETE", "PATCH"].filter((m) =>
    new RegExp(`\\b${m}\\b`, "i").test(allow),
  );
  if (dangerousMethods.length > 0) {
    vulns.push(vuln({
      name: `Dangerous HTTP Methods Advertised (${dangerousMethods.join(", ")})`,
      severity: "high",
      category: "HTTP Security",
      description: `The server advertises ${dangerousMethods.join("/")} in the Allow header for the root path. If not properly guarded by application-level authorization, these methods can allow arbitrary file uploads or deletion of server resources.`,
      evidence: `OPTIONS ${targetUrl}\nAllow: ${allow}`,
      solution: "Restrict HTTP methods to only those genuinely required. Use application-level authorization on any write methods. Block unused methods at the web server or load balancer before requests reach application code.",
      cweId: "CWE-650",
      cvssScore: 7.5,
      wstgId: "WSTG-CONF-06",
    }));
  }

  if (/\bCONNECT\b/i.test(allow)) {
    vulns.push(vuln({
      name: "HTTP CONNECT Method Enabled",
      severity: "medium",
      category: "HTTP Security",
      description: "The CONNECT method is advertised. This method is used to establish tunnels and could allow the server to be used as a proxy to reach internal systems not otherwise accessible.",
      evidence: `OPTIONS ${targetUrl}\nAllow: ${allow}`,
      solution: "Disable the CONNECT method unless you are intentionally running a proxy server.",
      cweId: "CWE-441",
      cvssScore: 6.1,
      wstgId: "WSTG-CONF-06",
    }));
  }

  return vulns;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ACTIVE CORS TESTING
// ─────────────────────────────────────────────────────────────────────────────

export async function checkActiveCors(targetUrl: string): Promise<ScanVulnerability[]> {
  const testOrigins = [
    "https://evil-attacker.com",
    "null",
  ];

  for (const origin of testOrigins) {
    const result = await safeGet(targetUrl, {
      headers: { Origin: origin },
      redirect: "follow",
    });
    if (!result) continue;

    const acao = result.headers["access-control-allow-origin"];
    const acac = result.headers["access-control-allow-credentials"];
    if (!acao) continue;

    const reflectsOrigin = acao === origin;
    const withCredentials = /^true$/i.test(acac ?? "");

    if (reflectsOrigin && withCredentials) {
      return [vuln({
        name: "CORS Misconfiguration — Credentials Allowed from Arbitrary Origin",
        severity: "critical",
        category: "CORS Misconfiguration",
        description: `The server reflects any request Origin in Access-Control-Allow-Origin AND sets Access-Control-Allow-Credentials: true. This allows any malicious website to make authenticated cross-origin requests on behalf of a logged-in victim — reading their private data, performing actions as them, and effectively bypassing SameSite cookie protections.`,
        evidence: `GET ${targetUrl}\nRequest header: Origin: ${origin}\nResponse: Access-Control-Allow-Origin: ${acao}\nResponse: Access-Control-Allow-Credentials: ${acac}`,
        solution: "Maintain a strict server-side allowlist of trusted origins. Never dynamically reflect the incoming Origin header without validating it against the allowlist. Never combine a dynamic origin with credentials: true.",
        cweId: "CWE-942",
        cvssScore: 9.1,
        wstgId: "WSTG-CONF-07",
      })];
    }

    if (reflectsOrigin && !withCredentials) {
      return [vuln({
        name: "CORS Misconfiguration — Origin Reflected Without Allowlist",
        severity: "medium",
        category: "CORS Misconfiguration",
        description: `The server reflects any Origin value in Access-Control-Allow-Origin without validating it. While credentials are not currently sent, this enables cross-origin data theft from any public API endpoint your application exposes.`,
        evidence: `GET ${targetUrl}\nRequest header: Origin: ${origin}\nResponse: Access-Control-Allow-Origin: ${acao}`,
        solution: "Validate the Origin header against an explicit allowlist. Only reflect origins that are on the approved list. Never use a catch-all reflection.",
        cweId: "CWE-942",
        cvssScore: 6.5,
        wstgId: "WSTG-CONF-07",
      })];
    }
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. OPEN REDIRECT TESTING
// ─────────────────────────────────────────────────────────────────────────────

export async function checkOpenRedirect(targetUrl: string): Promise<ScanVulnerability[]> {
  const base = new URL(targetUrl);
  const probeTarget = OPEN_REDIRECT_PROBE.template;

  for (const param of OPEN_REDIRECT_PARAMS) {
    const testUrl = new URL(targetUrl);
    testUrl.searchParams.set(param, probeTarget);

    const result = await safeGet(testUrl.toString(), { redirect: "manual" });
    if (!result) continue;

    if (result.status >= 300 && result.status < 400) {
      const location = result.headers["location"] ?? "";
      if (OPEN_REDIRECT_PROBE.indicator!.test(location)) {
        return [vuln({
          name: "Open Redirect Vulnerability",
          severity: "medium",
          category: "Unvalidated Redirects",
          description: `The '${param}' parameter controls where users are sent after an action without validation. Attackers send victims a URL on ${base.hostname} (which they trust) that silently redirects them to a phishing site. This is widely used in credential harvesting campaigns because the initial URL appears legitimate.`,
          evidence: `GET ${testUrl.pathname}?${param}=${encodeURIComponent(probeTarget)}\nHTTP ${result.status}\nLocation: ${location}`,
          solution: "Validate all redirect targets against an allowlist of permitted paths or domains. Prefer relative paths. If external redirects are needed, use an intermediate confirmation page and never accept destination URLs from user input directly.",
          cweId: "CWE-601",
          cvssScore: 6.1,
          wstgId: "WSTG-CLNT-04",
        })];
      }
    }
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ROBOTS.TXT ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

export async function checkRobotsTxt(baseUrl: string): Promise<ScanVulnerability[]> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const result = await safeGet(`${origin}/robots.txt`);
  if (!result || result.status !== 200 || result.body.length < 10) return [];

  const lines = result.body.split("\n");
  const disallowedPaths = lines
    .filter((l) => /^Disallow:\s*/i.test(l))
    .map((l) => l.replace(/^Disallow:\s*/i, "").trim())
    .filter((p) => p && p !== "/" && p.length > 1);

  const sensitivePatterns = [
    /admin/i, /backup/i, /config/i, /private/i, /secret/i,
    /internal/i, /\/api\//i, /database/i, /\/db\//i, /\.sql/i,
    /staging/i, /\/dev\//i, /\/logs?\//i, /debug/i, /dashboard/i,
    /\/tmp\//i, /\/test\//i, /\.env/i, /credentials/i,
  ];

  const sensitivePaths = disallowedPaths.filter((p) =>
    sensitivePatterns.some((rx) => rx.test(p)),
  );

  if (sensitivePaths.length === 0) return [];

  return [vuln({
    name: "robots.txt Discloses Sensitive Application Paths",
    severity: "info",
    category: "Information Disclosure",
    description: `The robots.txt file contains ${sensitivePaths.length} path(s) that reveal sensitive areas of the application: ${sensitivePaths.slice(0, 5).join(", ")}${sensitivePaths.length > 5 ? "…" : ""}. Ironically, listing paths in robots.txt to hide them from search engines makes them more discoverable to attackers who always check this file first.`,
    evidence: `GET ${origin}/robots.txt → HTTP 200\n${sensitivePaths.slice(0, 8).map((p) => `Disallow: ${p}`).join("\n")}`,
    solution: "Do not use robots.txt to obscure sensitive paths — it achieves the opposite. Properly secure those endpoints with authentication. Consider using `Disallow: /` globally if you don't want any indexing, rather than listing individual sensitive paths.",
    cweId: "CWE-200",
    wstgId: "WSTG-INFO-01",
  })];
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SUBRESOURCE INTEGRITY (SRI) CHECK
// ─────────────────────────────────────────────────────────────────────────────

export async function checkSRI(html: string, baseUrl: string): Promise<ScanVulnerability[]> {
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).hostname;
  } catch {
    return [];
  }

  const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi;
  const missingIntegrity: string[] = [];

  const checkTag = (tag: string, src: string) => {
    try {
      const u = new URL(src, baseUrl);
      if (u.hostname !== baseHost && !tag.includes("integrity=")) {
        // Skip resources whose URL pathname contains a long hex content hash.
        // Content-addressed URLs (e.g. webpack chunks: "/chunk.a1b2c3d4e5f6a7b8.js")
        // are effectively pinned by the hash in the filename — SRI is redundant
        // because changing the file content would change the URL, not silently
        // serve a tampered version. Flagging these would be a false positive.
        const hasContentHash = /[a-f0-9]{16,}/i.test(u.pathname);
        if (!hasContentHash) {
          missingIntegrity.push(src);
        }
      }
    } catch { /* relative URL */ }
  };

  let m: RegExpExecArray | null;
  while ((m = scriptRegex.exec(html)) !== null) checkTag(m[0], m[1]);
  while ((m = linkRegex.exec(html)) !== null) checkTag(m[0], m[1]);

  if (missingIntegrity.length === 0) return [];

  return [vuln({
    name: "External Resources Missing Subresource Integrity (SRI)",
    severity: "medium",
    category: "Supply Chain Security",
    description: `${missingIntegrity.length} external script(s)/stylesheet(s) are loaded from third-party CDNs without Subresource Integrity hashes. If any of these CDNs are compromised (which has happened to major CDNs), attackers can inject arbitrary JavaScript that runs on your site for all visitors—stealing credentials, hijacking sessions, or installing skimmers.`,
    evidence: missingIntegrity.slice(0, 5).map((s) => `<script/link src="${s}" (no integrity= attribute)>`).join("\n"),
    solution: 'Add integrity and crossorigin to all external resources: `<script src="https://cdn.example.com/lib.js" integrity="sha384-..." crossorigin="anonymous">`. Generate hashes at https://www.srihash.org/ or using `openssl dgst -sha384 -binary FILE | openssl base64 -A`.',
    cweId: "CWE-353",
    cvssScore: 6.1,
    wstgId: "WSTG-CONF-04",
  })];
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. ERROR PAGE DISCLOSURE
// ─────────────────────────────────────────────────────────────────────────────

export async function checkErrorDisclosure(baseUrl: string): Promise<ScanVulnerability[]> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const testPath = `/_vibescan-${Date.now()}-not-a-real-path`;
  const result = await safeGet(`${origin}${testPath}`);
  if (!result) return [];

  const body = result.body;

  const leakPatterns: Array<{ rx: RegExp; name: string }> = [
    { rx: /at\s+\w[\w.]+\s+\((?:\/[\w./\\-]+|[A-Z]:\\[\w./\\-]+):\d+:\d+\)/m, name: "JavaScript/Node.js stack trace with file paths" },
    { rx: /Traceback \(most recent call last\)[\s\S]{0,200}File "\/[^"]+"/m, name: "Python traceback with system file paths" },
    { rx: /in \/[\w./\\-]+\.php on line \d+/m, name: "PHP error with file path" },
    { rx: /Parse error:|Fatal error:|Warning:|Notice:/m, name: "PHP error message" },
    { rx: /ActiveRecord::\w+|ActionController::\w+/m, name: "Ruby on Rails exception class" },
    { rx: /\bat [\w.$]+\([\w$.]+\.java:\d+\)/m, name: "Java stack trace" },
    { rx: /System\.(NullReference|InvalidOperation|Web\.Http)Exception/m, name: "ASP.NET exception" },
    { rx: /werkzeug\.debug|Debugger caught an exception/m, name: "Werkzeug/Flask debugger (CRITICAL — allows RCE via debug console)" },
    { rx: /Whoops\\|Symfony\\Component\\Debug\\Exception/m, name: "PHP Whoops/Symfony debug page" },
    { rx: /DebugException|Illuminate\\Foundation\\Exceptions/m, name: "Laravel debug page" },
    { rx: /Django.*DEBUG.*True|django\.core\.exceptions/m, name: "Django debug page (DEBUG=True in production)" },
  ];

  const matched = leakPatterns.find((p) => p.rx.test(body));
  if (!matched) return [];

  const isFlaskDebugger = /werkzeug\.debug|Debugger caught/.test(body);

  return [vuln({
    name: isFlaskDebugger
      ? "Flask/Werkzeug Interactive Debugger Exposed (Remote Code Execution)"
      : "Verbose Error Pages Expose Internal Application Details",
    severity: isFlaskDebugger ? "critical" : "medium",
    category: "Information Disclosure",
    description: isFlaskDebugger
      ? "The Flask/Werkzeug interactive debugger is enabled and publicly accessible. This allows ANYONE to execute arbitrary Python code on your server directly from their browser. This is a complete server compromise."
      : `Non-existent URLs trigger error pages containing ${matched.name}. These responses reveal internal file paths, framework/library versions, function call stacks, and application structure—dramatically reducing attacker effort to find exploitable weaknesses.`,
    evidence: `GET ${origin}${testPath} → HTTP ${result.status}\nLeak type: ${matched.name}`,
    solution: isFlaskDebugger
      ? "IMMEDIATELY disable the Werkzeug debugger: set DEBUG=False and FLASK_ENV=production. This is a critical emergency—your server can be fully compromised."
      : "Disable debug mode in production. Use a generic error page that reveals nothing. Log detailed errors server-side only. Framework guides: Express.js — use a production error handler middleware. Django — DEBUG = False. PHP — display_errors = Off in php.ini. Rails — config.consider_all_requests_local = false.",
    cweId: isFlaskDebugger ? "CWE-94" : "CWE-209",
    cvssScore: isFlaskDebugger ? 10.0 : 5.3,
    wstgId: "WSTG-CONF-02",
  })];
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. HTTP → HTTPS REDIRECT CHECK
// ─────────────────────────────────────────────────────────────────────────────

export async function checkHttpsRedirect(targetUrl: string): Promise<ScanVulnerability[]> {
  let hostname: string;
  try {
    const parsed = new URL(targetUrl);
    // This check only runs when the scan target is already HTTPS, meaning HTTPS
    // is available and working. A missing redirect is therefore MEDIUM (not HIGH):
    // the site has HTTPS, it just doesn't force HTTP visitors over to it.
    // HIGH ("no HTTPS at all") is handled in scanner.ts.
    if (parsed.protocol !== "https:") return [];
    hostname = parsed.hostname;
  } catch {
    return [];
  }

  // Follow redirects automatically. Node.js fetch with redirect:"manual" returns
  // an opaque redirect (status 0, no headers) so we can't read the Location header.
  // Using redirect:"follow" and inspecting the final URL is simpler and reliable.
  const result = await safeGet(`http://${hostname}/`, { redirect: "follow" }, 8_000);
  if (!result) return []; // network error — don't false-positive

  // If the final URL landed on HTTPS, the redirect chain is in place — all good.
  if (result.finalUrl.startsWith("https://")) return [];

  // We know HTTPS is accessible (the scan target IS https://) but HTTP doesn't
  // Before filing a finding, verify the domain is not on the HSTS preload list.
  // Preloaded domains rely on browsers enforcing HTTPS natively — they intentionally
  // omit HTTP-level redirects and this is NOT a vulnerability.
  try {
    const apex = hostname.replace(/^www\./, "");
    const preloadRes = await safeGet(
      `https://hstspreload.org/api/v2/status?domain=${encodeURIComponent(apex)}`,
      {},
      5_000,
    );
    if (preloadRes && /"status"\s*:\s*"preloaded"/.test(preloadRes.body)) {
      return []; // domain is HSTS-preloaded — not a vulnerability
    }
  } catch { /* fail open — don't suppress on network error */ }

  return [vuln({
    name: "HTTP Traffic Not Redirected to HTTPS",
    severity: "medium",
    category: "Transport Security",
    description: `The HTTP version of the site does not issue a redirect to HTTPS. Users arriving via plain HTTP (old bookmarks, typed URLs, email links) may communicate in plaintext.`,
    evidence: `GET http://${hostname}/ (followed up to 5 redirect hops)\nResult: request chain never reached https://${hostname}/\nHSTS preload list: not preloaded`,
    solution: "Add a permanent 301 redirect from HTTP to HTTPS at the web server or load balancer:\n  Nginx: return 301 https://$host$request_uri;\n  Apache: Redirect permanent / https://yourdomain.com/\nAlternatively, submit your domain to the HSTS preload list (https://hstspreload.org) so browsers enforce HTTPS natively.",
    cweId: "CWE-319",
    cvssScore: 5.3,
    wstgId: "WSTG-CONF-07",
  })];
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. RATE LIMITING DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export async function checkRateLimiting(targetUrl: string): Promise<ScanVulnerability[]> {
  const result = await safeGet(targetUrl, {}, 6_000);
  if (!result) return [];

  const h = result.headers;
  const hasRateLimit =
    // Standard rate-limit response headers (RFC 6585 / IETF draft)
    h["x-ratelimit-limit"] ||
    h["x-rate-limit-limit"] ||
    h["ratelimit-limit"] ||
    h["retry-after"] ||
    h["x-ratelimit-remaining"] ||
    h["ratelimit-remaining"] ||
    // API gateway / proxy headers
    h["x-kong-limit"] ||
    h["x-envoy-ratelimited"] ||
    // Enterprise CDN / infrastructure — these platforms enforce rate limiting
    // at the infrastructure level and don't always expose headers for it.
    h["cf-ray"] ||                                          // Cloudflare
    h["x-akamai-request-id"] || h["akamai-grn"] ||         // Akamai WAF
    h["x-amz-cf-id"] ||                                    // AWS CloudFront
    /gfe|google-cloud|google-edge|google frontend/i.test(h["server"] ?? "") || // GFE
    /google/i.test(h["via"] ?? "") ||                       // Google infra
    /cloudfront/i.test(h["x-cache"] ?? "") ||               // CloudFront cache
    h["x-azure-ref"] || h["x-ms-ref"] ||                   // Azure Front Door / CDN
    /akamai/i.test(h["x-check-cacheable"] ?? "");           // Akamai edge

  if (!hasRateLimit) {
    return [vuln({
      name: "No Rate Limiting Detected",
      severity: "low",
      category: "Brute Force Protection",
      description: "No rate limiting or throttling signals were detected in the response headers. Without rate limiting, attackers can run automated brute-force attacks against login endpoints, enumerate valid user accounts through credential stuffing, abuse API endpoints at scale, or perform denial-of-service attacks by flooding your server. Note: many load balancers and reverse proxies enforce rate limiting without exposing headers — verify your infrastructure configuration before treating this as confirmed.",
      evidence: `GET ${targetUrl}\nNo rate-limit headers found (checked: X-RateLimit-Limit, RateLimit-Limit, Retry-After, and common CDN/WAF infrastructure signals)`,
      solution: "Implement rate limiting on all sensitive endpoints (login, registration, password reset, API). Node.js: express-rate-limit. Django: DRF throttling. Also implement: account lockout after N failures, CAPTCHA on login, and IP-based throttling at the CDN/load balancer level. Return standard headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After.",
      cweId: "CWE-307",
      cvssScore: 5.3,
      wstgId: "WSTG-ATHN-03",
      // Header-absence check only; infra-level rate limiting leaves no HTTP evidence.
      // Manually set confidence below the verification threshold so users know to confirm.
      confidence: 52,
    })];
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. CLICKJACKING VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

export async function checkClickjacking(targetUrl: string): Promise<ScanVulnerability[]> {
  // Only run if main scanner didn't already flag this via headers
  // This does a direct page fetch and checks the actual response headers
  const result = await safeGet(targetUrl, {}, 6_000);
  if (!result) return [];

  const xfo = result.headers["x-frame-options"];
  const csp = result.headers["content-security-policy"] ?? "";
  const hasFrameAncestors = /frame-ancestors/i.test(csp);

  // If both protections are missing, this is handled by the main scanner
  // But if X-Frame-Options is present but misconfigured:
  if (xfo && !/^(DENY|SAMEORIGIN)$/i.test(xfo.trim())) {
    return [vuln({
      name: "X-Frame-Options Header Misconfigured",
      severity: "medium",
      category: "UI Security",
      description: `X-Frame-Options is set to an invalid or non-standard value: "${xfo}". Browsers may ignore unrecognized values, leaving the application vulnerable to clickjacking attacks where attackers embed your page in an invisible iframe.`,
      evidence: `GET ${targetUrl}\nX-Frame-Options: ${xfo}\n(valid values: DENY or SAMEORIGIN)`,
      solution: 'Set X-Frame-Options to either "DENY" (blocks all framing) or "SAMEORIGIN" (allows framing by same origin). Alternatively, use CSP: Content-Security-Policy: frame-ancestors \'none\'',
      cweId: "CWE-1021",
      cvssScore: 4.3,
      wstgId: "WSTG-CLNT-09",
    })];
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTORY_LISTING_DIRS = [
  "/uploads/", "/images/", "/files/", "/backup/", "/backups/",
  "/logs/", "/static/", "/assets/", "/media/", "/data/",
  "/tmp/", "/cache/", "/downloads/", "/export/", "/exports/",
];

const DIRECTORY_LISTING_PATTERNS = [
  /Index of \//i,
  /<title>Directory listing/i,
  /\[To Parent Directory\]/i,
  /httpd\s+Directory\s+Listing/i,
  /<hr>\s*<pre>/i,
  /\?C=N&amp;O=D/,
];

export async function checkDirectoryListing(
  targetUrl: string,
): Promise<ScanVulnerability[]> {
  let origin: string;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return [];
  }

  const results = await Promise.allSettled(
    DIRECTORY_LISTING_DIRS.map(async (dir) => {
      const url = origin + dir;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6_000);
      try {
        const res = await validatedFetch(url, { signal: controller.signal }, { timeoutMs: 6_000 });
        if (!res.ok) return null;
        const body = await res.text();
        const matched = DIRECTORY_LISTING_PATTERNS.some((rx) => rx.test(body));
        if (!matched) return null;
        return vuln({
          name: "Directory Listing Enabled",
          severity: "medium",
          category: "Information Disclosure",
          description: `Directory listing is enabled at ${dir}. This exposes the complete file structure of that directory, allowing attackers to enumerate all files — including backup archives, configuration files, log files, and uploaded content that should not be public.`,
          evidence: `GET ${url} → HTTP 200\nDirectory index page returned (autoindex enabled)`,
          solution: "Disable directory listing at the web server. Nginx: remove the 'autoindex on' directive. Apache: add 'Options -Indexes' to the relevant directory block or .htaccess.",
          cweId: "CWE-548",
          cvssScore: 5.3,
          wstgId: "WSTG-CONF-04",
        });
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<ScanVulnerability | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v): v is ScanVulnerability => v !== null)
    .slice(0, 3);
}

export async function checkSecurityTxt(
  targetUrl: string,
): Promise<ScanVulnerability[]> {
  let origin: string;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return [];
  }

  const paths = ["/.well-known/security.txt", "/security.txt"];
  for (const p of paths) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    try {
      const res = await validatedFetch(origin + p, { signal: controller.signal }, { timeoutMs: 6_000 });
      if (res.ok) {
        const body = await res.text();
        if (/Contact:|Expires:|Policy:/i.test(body)) return [];
      }
    } catch { /* network error = not present */ } finally {
      clearTimeout(timer);
    }
  }

  return [vuln({
    name: "Missing security.txt (RFC 9116)",
    severity: "info",
    category: "Information Disclosure",
    description: "No security.txt file was found at /.well-known/security.txt or /security.txt. RFC 9116 defines this as the standard way for security researchers to report vulnerabilities to your organisation. Without it, researchers may not know how to contact you responsibly, leading to public disclosure before you can patch.",
    evidence: `GET ${origin}/.well-known/security.txt → not found\nGET ${origin}/security.txt → not found`,
    solution: "Create /.well-known/security.txt with at minimum: Contact (email or form URL), Expires (date after which the file is stale), and optionally Policy (URL of your vulnerability disclosure policy). Generator: https://securitytxt.org/",
    cweId: "CWE-205",
    cvssScore: 0,
  })];
}

// ─────────────────────────────────────────────────────────────────────────────

export async function runAllProbes(
  targetUrl: string,
  html: string,
): Promise<ScanVulnerability[]> {
  const settled = await Promise.allSettled([
    checkSensitiveFiles(targetUrl),
    checkHttpMethods(targetUrl),
    checkActiveCors(targetUrl),
    checkOpenRedirect(targetUrl),
    checkRobotsTxt(targetUrl),
    checkSRI(html, targetUrl),
    checkErrorDisclosure(targetUrl),
    checkHttpsRedirect(targetUrl),
    checkRateLimiting(targetUrl),
    checkClickjacking(targetUrl),
    checkDirectoryListing(targetUrl),
    checkSecurityTxt(targetUrl),
  ]);

  return settled
    .filter((r): r is PromiseFulfilledResult<ScanVulnerability[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}
