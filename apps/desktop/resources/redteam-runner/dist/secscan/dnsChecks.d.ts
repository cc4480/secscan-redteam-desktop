/**
 * DNS security checks — uses Cloudflare DNS-over-HTTPS (no key required).
 * Checks email authentication (SPF, DMARC, DKIM) and DNSSEC.
 *
 * Missing email security records allow attackers to send phishing emails
 * that appear to come from your domain — one of the most common attack vectors.
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function checkSpf(hostname: string): Promise<ScanVulnerability[]>;
export declare function checkDmarc(hostname: string): Promise<ScanVulnerability[]>;
export declare function checkDkim(hostname: string): Promise<ScanVulnerability[]>;
export declare function checkDnssec(hostname: string): Promise<ScanVulnerability[]>;
export declare function checkDnsSecurity(targetUrl: string): Promise<ScanVulnerability[]>;
