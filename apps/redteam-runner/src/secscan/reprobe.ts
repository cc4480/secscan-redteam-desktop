/**
 * Re-probe module for borderline confidence findings.
 *
 * After the main scan, findings with a confidence score in the
 * "borderline" window (50–70) are re-verified against the live target
 * using a 15-second parallel probe budget:
 *   1. Passive GET — re-checks all header-based findings
 *   2. Active OPTIONS — corroborates CORS wildcard findings
 *   3. DNS TXT query — corroborates SPF/DMARC/DKIM findings
 *
 * Confirmed findings get +10 confidence; disconfirmed findings are dropped.
 * Extracted from worker.ts to reduce that file's size.
 */

import type { ScanVulnerability } from "./scanner";
import { validatedFetch } from "./targetGuard";

const REPROBE_MIN = 50;
const REPROBE_MAX = 70;
const REPROBE_TIMEOUT_MS = 15_000;

interface ReprobeLog {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
}

export async function reprobe(
  targetUrl: string,
  vulns: ScanVulnerability[],
  log: ReprobeLog,
): Promise<ScanVulnerability[]> {
  const borderline = vulns.filter((v) => {
    const c = v.confidence ?? 100;
    return c >= REPROBE_MIN && c < REPROBE_MAX;
  });
  if (borderline.length === 0) return vulns;

  log.info({ borderlineCount: borderline.length }, "[reprobe] Re-probing borderline findings");

  // ── Single global 15s budget shared across all probes ───────────────────────
  const globalCtrl = new AbortController();
  const globalTimer = setTimeout(() => globalCtrl.abort(), REPROBE_TIMEOUT_MS);

  // Determine which probe types are needed
  const hasBorderlineCors = borderline.some(
    (v) => /cors/i.test(v.category) || /cors.*wildcard|access.control.allow.origin/i.test(v.name),
  );
  const hasBorderlineDns = borderline.some(
    (v) => /spf|dmarc|dkim|dnssec|email.*security|dns/i.test(v.name),
  );

  // Extract hostname for DNS probe
  let targetHostname = "";
  try { targetHostname = new URL(targetUrl).hostname; } catch { /* ignore */ }

  // ── Launch all probes in parallel under the shared 15s budget ────────────────

  // Probe 1: Passive GET — re-validates all header-based findings
  const getProbe = validatedFetch(targetUrl, {
    method: "GET",
    signal: globalCtrl.signal,
  }).then((res) => {
    const raw: Record<string, string> = {};
    res.headers.forEach((value, key) => { raw[key.toLowerCase()] = value; });
    return raw;
  }).catch(() => null as Record<string, string> | null);

  // Probe 2: Active OPTIONS — corroborates CORS wildcard findings
  const corsProbe = hasBorderlineCors
    ? validatedFetch(targetUrl, {
        method: "OPTIONS",
        headers: {
          "Origin": "https://cors-probe.vibescan.io",
          "Access-Control-Request-Method": "GET",
        },
        signal: globalCtrl.signal,
      }).then((res) => {
        const raw: Record<string, string> = {};
        res.headers.forEach((value, key) => { raw[key.toLowerCase()] = value; });
        return raw;
      }).catch(() => null as Record<string, string> | null)
    : Promise.resolve(null as Record<string, string> | null);

  // Probe 3: DNS TXT probe — corroborates SPF/DMARC/email-security findings
  const dnsProbe = (hasBorderlineDns && targetHostname)
    ? fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(targetHostname)}&type=TXT`,
        { headers: { Accept: "application/dns-json" }, signal: globalCtrl.signal },
      ).then((res) => res.json() as Promise<{ Answer?: Array<{ data: string }> }>)
       .then((data) => data.Answer?.map((a) => a.data.toLowerCase()) ?? [] as string[])
       .catch(() => null as string[] | null)
    : Promise.resolve(null as string[] | null);

  let freshHeaders: Record<string, string> | null;
  let corsProbeHeaders: Record<string, string> | null;
  let dnsTxtRecords: string[] | null;

  try {
    [freshHeaders, corsProbeHeaders, dnsTxtRecords] = await Promise.all([getProbe, corsProbe, dnsProbe]);
  } finally {
    clearTimeout(globalTimer);
  }

  if (!freshHeaders) {
    log.warn({}, "[reprobe] GET re-probe failed — keeping original confidences");
    return vulns;
  }

  let boosted = 0;
  let dropped = 0;

  const updated = vulns.flatMap((v) => {
    const c = v.confidence ?? 100;
    if (c < REPROBE_MIN || c >= REPROBE_MAX) return [v];

    const vName = v.name.toLowerCase();
    const vCat = v.category.toLowerCase();

    // DNS-based findings: use TXT record probe result
    if (/spf|dmarc|dkim|dnssec|email.*security/i.test(vName) && dnsTxtRecords !== null) {
      const confirmed = checkDnsFinding(vName, dnsTxtRecords);
      if (confirmed !== null) {
        if (confirmed) { boosted++; return [{ ...v, confidence: Math.min(95, c + 10) }]; }
        dropped++;
        return [];
      }
    }

    // For CORS findings, prefer the active OPTIONS probe result
    const isCors = /cors/i.test(vCat) || /cors.*wildcard|access.control.allow.origin/i.test(vName);
    const headersToCheck = (isCors && corsProbeHeaders) ? corsProbeHeaders : freshHeaders;
    if (!headersToCheck) return [v];

    const confirmed = checkHeaderFinding(v, headersToCheck);
    if (confirmed === null) return [v]; // finding class not verifiable by any current probe — keep as-is
    if (confirmed) { boosted++; return [{ ...v, confidence: Math.min(95, c + 10) }]; }
    dropped++; // disconfirmed — remove from report
    return [];
  });

  log.info({ boosted, dropped }, "[reprobe] Re-probe adjustments applied");
  return updated;
}

/**
 * Validates DNS-based security findings against live TXT record data from
 * a DNS-over-HTTPS probe. Returns true if the finding is confirmed (issue
 * still present), false if disconfirmed, or null if undecidable.
 */
function checkDnsFinding(nameLower: string, txtRecords: string[]): boolean | null {
  if (/spf|sender policy framework/.test(nameLower))
    return !txtRecords.some((r) => r.includes("v=spf1"));
  if (/dmarc/.test(nameLower))
    return !txtRecords.some((r) => r.includes("v=dmarc1"));
  if (/dkim/.test(nameLower))
    return !txtRecords.some((r) => r.includes("v=dkim1"));
  return null;
}

function checkHeaderFinding(
  vuln: ScanVulnerability,
  headers: Record<string, string>,
): boolean | null {
  const name = vuln.name.toLowerCase();
  const cat = vuln.category.toLowerCase();

  if (/hsts|strict-transport/.test(name))
    return !("strict-transport-security" in headers);
  if (/content.security.policy|(?<!\w)csp(?!\w)/.test(name) && /missing|absent/.test(name))
    return !("content-security-policy" in headers);
  if (/x-frame|clickjack/.test(name)) {
    if (/missing|absent/.test(name)) return !("x-frame-options" in headers);
    const val = headers["x-frame-options"] ?? "";
    return !val || !/^(deny|sameorigin)$/i.test(val.trim());
  }
  if (/x-content-type|content.type.sniff/.test(name)) {
    const val = (headers["x-content-type-options"] ?? "").toLowerCase().trim();
    return val !== "nosniff";
  }
  if (/referrer-policy/.test(name) && /missing|absent/.test(name))
    return !("referrer-policy" in headers);
  if (/permissions.policy|feature.policy/.test(name) && /missing|absent/.test(name))
    return !("permissions-policy" in headers) && !("feature-policy" in headers);
  if (cat.includes("cors") || /\bcors\b/.test(name))
    return headers["access-control-allow-origin"] === "*";
  if (/server version|server disclosure/.test(name)) {
    const srv = headers["server"] ?? "";
    return /[0-9]+\.[0-9]+/.test(srv);
  }
  if (/x-powered-by/.test(name))
    return "x-powered-by" in headers;
  // Cookie flag checks — best effort from Set-Cookie in the fresh response
  if (/cookie.*secure|secure.*cookie/.test(name)) {
    const sc = headers["set-cookie"] ?? "";
    return sc.length > 0 && !/;\s*secure/i.test(sc);
  }
  if (/cookie.*httponly|httponly/.test(name)) {
    const sc = headers["set-cookie"] ?? "";
    return sc.length > 0 && !/;\s*httponly/i.test(sc);
  }
  if (/cookie.*samesite|samesite/.test(name)) {
    const sc = headers["set-cookie"] ?? "";
    return sc.length > 0 && !/;\s*samesite/i.test(sc);
  }

  return null;
}
