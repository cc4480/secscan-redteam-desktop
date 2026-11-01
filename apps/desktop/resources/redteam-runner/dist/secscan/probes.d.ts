/**
 * Active security probes — HTTP-based checks run in parallel alongside the main header scan.
 * Each probe is independent and best-effort (failures are non-fatal).
 *
 * Covers: sensitive file exposure, HTTP methods, active CORS, open redirects,
 * robots.txt analysis, Subresource Integrity, error disclosure, HTTPS redirect,
 * rate limiting, directory listing, and clickjacking verification.
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function checkSensitiveFiles(baseUrl: string): Promise<ScanVulnerability[]>;
export declare function checkHttpMethods(targetUrl: string): Promise<ScanVulnerability[]>;
export declare function checkActiveCors(targetUrl: string): Promise<ScanVulnerability[]>;
export declare function checkOpenRedirect(targetUrl: string): Promise<ScanVulnerability[]>;
export declare function checkRobotsTxt(baseUrl: string): Promise<ScanVulnerability[]>;
export declare function checkSRI(html: string, baseUrl: string): Promise<ScanVulnerability[]>;
export declare function checkErrorDisclosure(baseUrl: string): Promise<ScanVulnerability[]>;
export declare function checkHttpsRedirect(targetUrl: string): Promise<ScanVulnerability[]>;
export declare function checkRateLimiting(targetUrl: string): Promise<ScanVulnerability[]>;
export declare function checkClickjacking(targetUrl: string): Promise<ScanVulnerability[]>;
export declare function checkDirectoryListing(targetUrl: string): Promise<ScanVulnerability[]>;
export declare function checkSecurityTxt(targetUrl: string): Promise<ScanVulnerability[]>;
export declare function runAllProbes(targetUrl: string, html: string): Promise<ScanVulnerability[]>;
