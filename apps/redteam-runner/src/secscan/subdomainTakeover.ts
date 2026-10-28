/**
 * Subdomain takeover detection.
 *
 * Resolves the target hostname's CNAME chain via Cloudflare DNS-over-HTTPS,
 * checks whether the final CNAME points to a known cloud service, then
 * fetches that target to verify it returns an "unclaimed resource" fingerprint.
 *
 * Covers: AWS S3, Heroku, GitHub Pages, Netlify, Vercel, Azure, Fastly,
 * Shopify, Ghost Pro, Surge.sh, Cargo, Readme.io, Pantheon, Squarespace,
 * Tumblr, WP Engine, Fly.io, Render, and Railway.
 */

import { randomUUID } from "node:crypto";
import type { ScanVulnerability } from "./scanner";

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const TIMEOUT_MS = 8_000;

function vuln(partial: Omit<ScanVulnerability, "id">): ScanVulnerability {
  return { id: randomUUID(), ...partial };
}

// ─── DNS helpers ──────────────────────────────────────────────────────────────

interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DnsAnswer[];
}

async function dohQuery(name: string, type: string): Promise<DnsAnswer[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}&ct=application/dns-json`;
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as DohResponse;
    return json.Answer ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Follow the CNAME chain up to 5 hops, return final target or null. */
async function resolveCnameChain(hostname: string): Promise<string | null> {
  let current = hostname;
  for (let hop = 0; hop < 5; hop++) {
    const answers = await dohQuery(current, "CNAME");
    const cname = answers.find((a) => a.type === 5); // 5 = CNAME
    if (!cname) return hop === 0 ? null : current; // no further CNAME
    current = cname.data.replace(/\.$/, "");
  }
  return current;
}

// ─── Service fingerprints ─────────────────────────────────────────────────────

import { type ServiceFingerprint, SERVICES } from "./subdomain-service-data";


// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function safeGet(url: string): Promise<{ status: number; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const body = await res.text().catch(() => "");
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function checkSubdomainTakeover(
  targetUrl: string,
): Promise<ScanVulnerability[]> {
  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    return [];
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === "localhost") {
    return [];
  }

  const cname = await resolveCnameChain(hostname);
  if (!cname) return [];

  const service = SERVICES.find((s) => s.cnamePattern.test(cname));
  if (!service) return [];

  // Verify the CNAME target itself is unclaimed — try HTTPS then HTTP
  const result =
    (await safeGet(`https://${cname}/`)) ??
    (await safeGet(`http://${cname}/`));

  if (!result) return [];

  const confirmed = service.bodyFingerprints.some((rx) => rx.test(result.body));
  if (!confirmed) return [];

  return [
    vuln({
      name: `Subdomain Takeover — ${service.name} (${hostname})`,
      severity: service.severity,
      category: "DNS Security",
      description: `The hostname ${hostname} has a CNAME pointing to ${cname} (${service.name}), but that ${service.name} resource is no longer provisioned. An attacker can register or reclaim it and serve arbitrary content — phishing pages, malware, or credential harvesters — under your trusted domain name. This is fully exploitable with no technical barrier.`,
      evidence: `CNAME chain: ${hostname} → ${cname}\nService: ${service.name}\nUnclaimed fingerprint confirmed in HTTP response.`,
      solution: `Immediately either: (1) Remove the dangling CNAME DNS record for ${hostname}, or (2) Reprovision the ${service.name} resource to reclaim ownership. Audit all DNS CNAME records regularly — especially after decommissioning cloud services — to catch dangling entries before attackers do.`,
      cweId: "CWE-350",
      cvssScore: service.cvssScore,
      wstgId: "WSTG-CONF-10",
    }),
  ];
}
