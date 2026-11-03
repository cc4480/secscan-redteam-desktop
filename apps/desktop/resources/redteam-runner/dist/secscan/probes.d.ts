/**
 * Active security probes — HTTP-based checks run in parallel alongside the main header scan.
 * Each probe is independent and best-effort (failures are non-fatal).
 *
 * Covers: sensitive file exposure, HTTP methods, active CORS, open redirects,
 * robots.txt analysis, Subresource Integrity, error disclosure, HTTPS redirect,
 * rate limiting, directory listing, and clickjacking verification.
 */
import type { ScanVulnerability } from "./scanner.js";
import { type TargetGuardOptions } from "./targetGuard.js";
export declare function checkSensitiveFiles(baseUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkHttpMethods(targetUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkActiveCors(targetUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkOpenRedirect(targetUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkRobotsTxt(baseUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkSRI(html: string, baseUrl: string): Promise<ScanVulnerability[]>;
export declare function checkErrorDisclosure(baseUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkHttpsRedirect(targetUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkRateLimiting(targetUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkClickjacking(targetUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkDirectoryListing(targetUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function checkSecurityTxt(targetUrl: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
export declare function runAllProbes(targetUrl: string, html: string, guard?: TargetGuardOptions): Promise<ScanVulnerability[]>;
