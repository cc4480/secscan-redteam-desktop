import type { ExploitEvidence } from "../src/types.js";
export interface DeserializationFinding {
    testName: string;
    endpoint: string;
    severity: "high";
    description: string;
    fix: string;
    evidence: ExploitEvidence;
}
/**
 * Scan the RAW Set-Cookie lines (values intact) a server issued for a serialized
 * object. Pass the real values, not the redacted ones — the serialization header
 * is a format marker, not secret material, and only a short prefix is retained.
 */
export declare function scanCookiesForSerialized(setCookieLines: string[], source?: string): DeserializationFinding[];
