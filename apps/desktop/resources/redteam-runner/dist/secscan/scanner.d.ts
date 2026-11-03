/**
 * Black-box HTTP security scanner.
 *
 * Stage 1 (this file): Fetches the target URL, analyses response headers,
 * cookies, TLS, CORS, and page content — produces an initial vulnerability list.
 *
 * Stage 2 (parallel, via worker.ts): SSL Labs TLS assessment.
 *
 * Stage 3 (parallel probes): Active HTTP probes via probes.ts,
 * DNS security checks via dnsChecks.ts, and JavaScript secret scanning
 * via jsScanner.ts — all run concurrently with stage 2.
 */
import { type TargetGuardOptions } from './targetGuard.js';
export interface ScanVulnerability {
    id: string;
    name: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    category: string;
    description: string;
    evidence?: string | null;
    solution: string;
    cweId?: string | null;
    cvssScore?: number | null;
    wstgId?: string | null;
    /** Confidence score 0–100: how certain we are this is a real finding, not a false positive */
    confidence?: number | null;
    /** Direct link to the exposed page / endpoint (e.g. the Swagger UI, GraphQL endpoint, leaked source map) */
    url?: string | null;
    /** Primary CVE identifier for vulnerability findings (e.g. "CVE-2023-1234") */
    cveId?: string | null;
}
export interface ScanResult {
    targetUrl: string;
    finalUrl: string;
    statusCode: number;
    server: string | null;
    tlsGrade: string | null;
    technologies: string[];
    vulnerabilities: ScanVulnerability[];
    requestDurationMs: number;
    rawHeaders: Record<string, string>;
    /** URLs of inner pages actually fetched during the deep crawl (excludes the root URL) */
    pagesScanned: string[];
    /** High-value probe paths that returned HTTP 404 during the crawl (see CrawlResult.probedNotFound) */
    probedNotFound: string[];
}
export type StepCallback = (key: string, status: 'running' | 'done' | 'error', findings?: number) => void;
export declare function runScan(targetUrl: string, tier: string, onStep?: StepCallback, guard?: TargetGuardOptions): Promise<ScanResult>;
export declare function computeRiskScore(vulns: ScanVulnerability[]): number;
export declare function computeGrade(riskScore: number): string;
