/**
 * Phase 1 Reconnaissance — passive + active black-box intelligence gathering.
 *
 * Three concurrent tracks run in parallel:
 *   1. DNS enumeration  — A, AAAA, MX, NS, TXT (SPF/DMARC), SOA, CAA via Cloudflare DoH
 *   2. Subdomain enum   — crt.sh certificate transparency logs + wordlist DNS brute-force
 *   3. Port scanning    — TCP-connect scan of top 30 ports with banner grabbing
 *
 * SSRF protection: the target hostname is resolved to an IP before port scanning.
 * If the resolved IP falls in an RFC-1918/loopback/link-local range the port scan
 * is skipped entirely — we never probe internal infrastructure.
 *
 * All network operations run with hard timeouts so a slow/unresponsive target
 * cannot stall the wider scan pipeline.
 */

import * as net from "node:net";
import * as dns from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import type { ScanVulnerability } from "./scanner";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SubdomainEntry {
  subdomain: string;
  /** IPv4 address the subdomain resolves to, or null */
  ip: string | null;
  /** CNAME target if the subdomain is a canonical alias */
  cname: string | null;
  source: "crt.sh" | "wordlist";
}

export interface PortEntry {
  port: number;
  service: string;
  /** First ~256 bytes of banner received from the socket, or null */
  banner: string | null;
}

export interface DnsRecord {
  type: string;
  value: string;
  ttl?: number;
}

export interface ReconResult {
  subdomains: SubdomainEntry[];
  openPorts: PortEntry[];
  dnsRecords: DnsRecord[];
  reconDurationMs: number;
}

export interface ReconRunResult {
  recon: ReconResult;
  /** Vulnerabilities generated from dangerous open ports — merged into the main scan vuln list */
  vulns: ScanVulnerability[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_TIMEOUT_MS = 8_000;
const PORT_CONNECT_TIMEOUT_MS = 2_500;
const PORT_BANNER_WAIT_MS = 800;
const PORT_CONCURRENCY = 20;
const SUBDOMAIN_CONCURRENCY = 15;
const CRT_SH_TIMEOUT_MS = 12_000;
const SUBDOMAIN_CAP = 100; // max crt.sh results to resolve

import { COMMON_SUBDOMAINS, type PortSpec, TOP_PORTS } from "./recon-data";

// ─── SSRF guard ───────────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^127\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    ip === "::1" ||
    /^fc00:/i.test(ip) ||
    /^fd[0-9a-f]{2}:/i.test(ip) ||
    ip === "0.0.0.0"
  );
}

// ─── Port scanner ─────────────────────────────────────────────────────────────

async function scanPort(
  host: string,
  port: number,
): Promise<{ open: boolean; banner: string | null }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner = "";
    let resolved = false;
    let connected = false;
    let bannerTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (open: boolean) => {
      if (resolved) return;
      resolved = true;
      if (bannerTimer) clearTimeout(bannerTimer);
      socket.destroy();
      resolve({ open, banner: open && banner ? banner.slice(0, 256).trim() : null });
    };

    socket.setTimeout(PORT_CONNECT_TIMEOUT_MS);

    socket.on("connect", () => {
      connected = true;
      // Give the server a moment to send an unsolicited banner
      bannerTimer = setTimeout(() => finish(true), PORT_BANNER_WAIT_MS);
    });

    socket.on("data", (data) => {
      banner += data.toString("utf8", 0, 512);
      if (connected) finish(true);
    });

    socket.on("timeout", () => {
      if (connected) finish(true); // connected but no banner → port is still open
      else finish(false);
    });

    socket.on("error", () => finish(false));

    socket.connect(port, host);
  });
}

async function scanPorts(host: string): Promise<PortEntry[]> {
  const open: PortEntry[] = [];
  const specs = [...TOP_PORTS];

  for (let i = 0; i < specs.length; i += PORT_CONCURRENCY) {
    const batch = specs.slice(i, i + PORT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (spec) => {
        const { open: isOpen, banner } = await scanPort(host, spec.port);
        return isOpen ? { port: spec.port, service: spec.service, banner } : null;
      }),
    );
    for (const r of results) {
      if (r) open.push(r);
    }
  }

  return open;
}

// ─── DNS enumeration via Cloudflare DoH ──────────────────────────────────────

async function dohQuery(
  name: string,
  type: string,
): Promise<Array<{ value: string; ttl: number }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
  try {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}&ct=application/dns-json`;
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      Answer?: Array<{ data: string; TTL: number }>;
    };
    return (json.Answer ?? []).map((a) => ({
      value: a.data.replace(/\.$/, ""),
      ttl: a.TTL,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function enumerateDns(domain: string): Promise<DnsRecord[]> {
  const queries: Array<{ type: string; name: string }> = [
    { type: "A",    name: domain },
    { type: "AAAA", name: domain },
    { type: "MX",   name: domain },
    { type: "NS",   name: domain },
    { type: "TXT",  name: domain },
    { type: "SOA",  name: domain },
    { type: "CAA",  name: domain },
    { type: "TXT",  name: `_dmarc.${domain}` },
  ];

  const results = await Promise.all(
    queries.map(async ({ type, name }) => {
      const answers = await dohQuery(name, type);
      return answers.map((a) => ({
        type,
        value: name !== domain ? `[${name}] ${a.value}` : a.value,
        ttl: a.ttl,
      }));
    }),
  );

  return results.flat();
}

// ─── Subdomain enumeration ────────────────────────────────────────────────────

async function fetchSubdomainsFromCrtSh(domain: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRT_SH_TIMEOUT_MS);
  try {
    const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{ name_value: string }>;
    const seen = new Set<string>();
    for (const entry of json) {
      for (const raw of entry.name_value.split("\n")) {
        const sub = raw.trim().toLowerCase().replace(/^\*\./, "");
        if (sub && sub.endsWith(`.${domain}`) && !seen.has(sub)) {
          seen.add(sub);
        }
      }
    }
    return [...seen];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function resolveSubdomain(
  sub: string,
): Promise<{ ip: string | null; cname: string | null }> {
  try {
    const addresses = await dns.lookup(sub, { all: true, family: 4 });
    return { ip: (addresses as Array<{ address: string }>)[0]?.address ?? null, cname: null };
  } catch {
    try {
      const result = await dns.resolveCname(sub);
      return { ip: null, cname: (result as string[])[0] ?? null };
    } catch {
      return { ip: null, cname: null };
    }
  }
}

async function enumerateSubdomains(domain: string): Promise<SubdomainEntry[]> {
  const seen = new Set<string>();
  const entries: SubdomainEntry[] = [];

  const crtShSubs = await fetchSubdomainsFromCrtSh(domain);

  // Build deduplicated task list: crt.sh first, then wordlist for any not already found
  const allTasks: Array<{ sub: string; source: "crt.sh" | "wordlist" }> = [];

  for (const s of crtShSubs.slice(0, SUBDOMAIN_CAP)) {
    if (!seen.has(s)) { seen.add(s); allTasks.push({ sub: s, source: "crt.sh" }); }
  }
  for (const w of COMMON_SUBDOMAINS) {
    const s = `${w}.${domain}`;
    if (!seen.has(s)) { seen.add(s); allTasks.push({ sub: s, source: "wordlist" }); }
  }

  for (let i = 0; i < allTasks.length; i += SUBDOMAIN_CONCURRENCY) {
    const batch = allTasks.slice(i, i + SUBDOMAIN_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async ({ sub, source }) => {
        const { ip, cname } = await resolveSubdomain(sub);
        if (!ip && !cname) return null;
        return { subdomain: sub, ip, cname, source } satisfies SubdomainEntry;
      }),
    );
    for (const r of resolved) {
      if (r) entries.push(r);
    }
  }

  return entries;
}

// ─── Dangerous port → vulnerability ──────────────────────────────────────────

function portVulns(openPorts: PortEntry[]): ScanVulnerability[] {
  return openPorts.flatMap((p) => {
    const spec = TOP_PORTS.find((s) => s.port === p.port);
    if (!spec?.dangerous) return [];
    const d = spec.dangerous;
    return [{
      id: randomUUID(),
      name: `Exposed ${spec.service} Service (port ${p.port})`,
      severity: d.severity,
      category: "Network Exposure",
      description: d.description,
      evidence: [
        `Port ${p.port}/tcp is open (${spec.service})`,
        p.banner ? `Banner: ${p.banner}` : null,
      ].filter(Boolean).join("\n"),
      solution: d.solution,
      cweId: d.cweId,
      cvssScore: d.cvssScore,
      wstgId: d.wstgId ?? null,
      confidence: 95,
    } satisfies ScanVulnerability];
  });
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function runRecon(targetUrl: string): Promise<ReconRunResult> {
  const startedAt = Date.now();
  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    throw new Error(`[recon] Invalid target URL: ${targetUrl}`);
  }

  const log = logger.child({ hostname });
  log.info("[recon] Starting reconnaissance");

  // Resolve IP and apply SSRF guard before port scanning
  let resolvedIp: string | null = null;
  let skipPortScan = false;

  try {
    const result = await dns.lookup(hostname, { family: 4 }) as { address: string };
    resolvedIp = result.address;
    if (isPrivateIp(resolvedIp)) {
      log.warn({ ip: resolvedIp }, "[recon] Target resolves to private IP — port scan skipped (SSRF guard)");
      skipPortScan = true;
    }
  } catch {
    log.warn("[recon] Could not resolve target hostname — port scan skipped");
    skipPortScan = true;
  }

  const domain = hostname.replace(/^www\./, "");

  const [dnsRecords, subdomains, openPorts] = await Promise.all([
    enumerateDns(domain).catch((err) => {
      log.warn({ err }, "[recon] DNS enumeration failed");
      return [] as DnsRecord[];
    }),
    enumerateSubdomains(domain).catch((err) => {
      log.warn({ err }, "[recon] Subdomain enumeration failed");
      return [] as SubdomainEntry[];
    }),
    skipPortScan
      ? Promise.resolve([] as PortEntry[])
      : scanPorts(resolvedIp!).catch((err) => {
          log.warn({ err }, "[recon] Port scan failed");
          return [] as PortEntry[];
        }),
  ]);

  const reconDurationMs = Date.now() - startedAt;

  log.info(
    { dnsRecords: dnsRecords.length, subdomains: subdomains.length, openPorts: openPorts.length, reconDurationMs },
    "[recon] Reconnaissance complete",
  );

  return {
    recon: { subdomains, openPorts, dnsRecords, reconDurationMs },
    vulns: portVulns(openPorts),
  };
}
