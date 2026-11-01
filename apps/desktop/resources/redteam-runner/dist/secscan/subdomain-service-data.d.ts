/**
 * Data module: subdomain takeover fingerprints for known cloud services.
 * Extracted from subdomainTakeover.ts to reduce that file's line count.
 */
import type { ScanVulnerability } from "./scanner.js";
export interface ServiceFingerprint {
    name: string;
    cnamePattern: RegExp;
    /** Patterns found in the HTTP body that confirm the resource is unclaimed. */
    bodyFingerprints: RegExp[];
    severity: ScanVulnerability["severity"];
    cvssScore: number;
}
export declare const SERVICES: ServiceFingerprint[];
