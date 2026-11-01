/**
 * SSL Labs API integration.
 * Uses the free Qualys SSL Labs API v3 (no key required).
 *
 * Strategy:
 *   Always trigger a fresh assessment (startNew=on, fromCache=off) so every
 *   scan reflects the current TLS configuration rather than 24h-old data.
 *   Poll for up to MAX_WAIT_MS. If still not READY, return null (graceful
 *   degradation — scan continues without TLS grade).
 *
 * Reference: https://github.com/ssllabs/ssllabs-scan/blob/master/ssllabs-api-docs-v3.md
 */
export interface SslLabsResult {
    grade: string | null;
    hasWarnings: boolean;
    isExceptional: boolean;
    issues: string[];
}
/**
 * Run an SSL Labs assessment for the given HTTPS hostname.
 * Returns null if the target is not HTTPS, the API times out, or an error occurs.
 */
export declare function checkSslLabs(targetUrl: string): Promise<SslLabsResult | null>;
