/**
 * Data module: subdomain wordlist and port/service definitions for recon.ts.
 * Extracted to reduce recon.ts from ~550 lines to ~340.
 */
export declare const COMMON_SUBDOMAINS: string[];
export interface PortSpec {
    port: number;
    service: string;
    dangerous?: {
        severity: "critical" | "high" | "medium";
        description: string;
        solution: string;
        cweId: string;
        cvssScore: number;
        wstgId?: string;
    };
}
export declare const TOP_PORTS: PortSpec[];
