/**
 * Data module: regex patterns used to detect secrets in JavaScript source.
 * Extracted from jsScanner.ts to reduce that file's line count.
 */
import type { ScanVulnerability } from "./scanner.js";
export interface SecretPattern {
    name: string;
    pattern: RegExp;
    severity: ScanVulnerability["severity"];
    cvssScore?: number;
    description: string;
    solution: string;
    cweId: string;
    validate?: (match: string) => boolean;
}
export declare const SECRET_PATTERNS: SecretPattern[];
