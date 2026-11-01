/**
 * Target validation guard for scan intake and the scan worker.
 *
 * Every scan target goes through `assertTargetSafe` before a job is queued
 * (route) and again right before probing starts (worker, to close the
 * resolve→request TOCTOU window). `validatedFetch` applies the same checks to
 * every redirect hop.
 *
 * The rule is simple: the scanner only ever talks to public IP addresses over
 * http/https, on an allowlisted port, with no credentials in the URL.
 */
export declare class TargetValidationError extends Error {
    readonly code: "bad_url" | "bad_protocol" | "credentials_in_url" | "port_not_allowed" | "empty_hostname" | "ip_literal_not_allowed" | "private_ip" | "dns_failed" | "too_many_redirects" | "redirect_rejected" | "request_failed";
    constructor(code: TargetValidationError["code"], message: string);
}
/** Ports the scanner is willing to probe. Everything else is rejected. */
export declare const ALLOWED_TARGET_PORTS: Set<number>;
/**
 * True only when the address is a routable public IP. Anything unparseable,
 * non-public, or special-purpose returns false (fail closed).
 */
export declare function isPublicIpAddress(ip: string): boolean;
export interface ValidatedTarget {
    url: URL;
    hostname: string;
}
/** Structural checks only — no DNS. Throws TargetValidationError. */
export declare function parseTargetUrl(rawUrl: string): ValidatedTarget;
/**
 * Resolve the hostname and require every address to be public.
 * IP literals are checked directly. Fails closed on DNS errors.
 */
export declare function assertPublicResolution(hostname: string): Promise<string[]>;
/** Full check: structure + public DNS resolution. */
export declare function assertTargetSafe(rawUrl: string): Promise<ValidatedTarget>;
/**
 * Resolve a redirect `Location` against the current URL and run the full
 * target guard on the result. Exported for testing.
 */
export declare function resolveRedirectTarget(current: URL, location: string): Promise<URL>;
export interface ValidatedFetchOptions {
    maxRedirects?: number;
    timeoutMs?: number;
}
/**
 * fetch() that follows redirects manually and re-runs the target guard on
 * every hop, so a benign initial URL can't bounce the scan onto an internal
 * host. Non-redirect responses are returned as-is.
 */
export declare function validatedFetch(input: string, init?: RequestInit, opts?: ValidatedFetchOptions): Promise<Response>;
