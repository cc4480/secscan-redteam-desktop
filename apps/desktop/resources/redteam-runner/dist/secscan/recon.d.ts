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
import type { ScanVulnerability } from "./scanner.js";
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
export declare function runRecon(targetUrl: string): Promise<ReconRunResult>;
