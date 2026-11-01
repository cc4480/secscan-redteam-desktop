/**
 * Payload catalog — structured library of active probe payloads used by the scanner.
 *
 * Each entry carries metadata so callers can:
 *   - Filter by type or safety level (safe_by_default / requires_consent)
 *   - Reference the payload by stable ID in evidence strings (reproducible reports)
 *   - Gate aggressive payloads behind explicit consent
 *
 * Design principles (from the VibeScan safety policy):
 *   - All payloads shipped in this file are NON-DESTRUCTIVE by default.
 *   - Payloads that write data, execute code, or trigger external callbacks are
 *     marked requires_consent=true and will not run in default scans.
 *   - Filesystem read payloads target well-known read-only files (/etc/passwd,
 *     win.ini) that have no write side-effects.
 */
export type PayloadType = "path-traversal" | "open-redirect" | "xss-reflected" | "sqli-boolean" | "ssrf-canary";
export type PayloadEncoding = "plain" | "url-encoded" | "double-url-encoded" | "filter-bypass";
export interface Payload {
    /** Stable identifier referenced in evidence strings for reproducibility */
    id: string;
    type: PayloadType;
    /** Raw template — substituted directly into query params, headers, or body */
    template: string;
    description: string;
    /** True when safe to send to any target without explicit written consent */
    safe_by_default: boolean;
    /** True when target owner must explicitly opt in before this payload runs */
    requires_consent: boolean;
    /** Target OS for filesystem traversal payloads */
    os?: "linux" | "windows" | "any";
    encoding?: PayloadEncoding;
    /** Regex confirming a response body indicates a real finding */
    indicator?: RegExp;
}
export declare const PATH_TRAVERSAL_PAYLOADS: Payload[];
/** All path traversal payload templates in insertion order (for loop compat) */
export declare const PATH_TRAVERSAL_TEMPLATES: string[];
/** All success indicators in insertion order — parallel to PATH_TRAVERSAL_PAYLOADS */
export declare function classifyTraversalBody(body: string): "linux" | "windows" | null;
export declare const OPEN_REDIRECT_PROBE: Payload;
/** Common redirect parameter names tested by the open redirect probe */
export declare const OPEN_REDIRECT_PARAMS: string[];
