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
import type { ScanVulnerability } from "./scanner.js";
interface ReprobeLog {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: unknown, msg: string) => void;
}
export declare function reprobe(targetUrl: string, vulns: ScanVulnerability[], log: ReprobeLog): Promise<ScanVulnerability[]>;
export {};
