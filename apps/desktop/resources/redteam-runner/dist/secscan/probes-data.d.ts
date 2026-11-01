/**
 * Data module: sensitive file/path probes used by probes.ts active checks.
 * Keeping this separate reduces probes.ts from ~1500 lines to ~650.
 */
import type { ScanVulnerability } from "./scanner.js";
export interface SensitivePath {
    path: string;
    name: string;
    severity: ScanVulnerability["severity"];
    cweId: string;
    cvssScore?: number;
    category: string;
    description: string;
    solution: string;
    validate: (body: string, contentType: string) => boolean;
}
export declare const SENSITIVE_PATHS: SensitivePath[];
