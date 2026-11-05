/**
 * Fetch-guard types and typed errors — extracted from `fetch-guard.ts` so
 * the parent module stays inside the runner's 300-line file budget. Same
 * public names, re-exported from the parent unchanged.
 */
/** Why a destination was refused. Stable strings — callers record them. */
export type DenyReason = 'invalid-url' | 'invalid-redirect' | 'scheme-not-https' | 'credentials-in-url' | 'no-addresses' | 'unparseable-address' | 'blocked-address' | 'too-many-redirects' | 'content-type-not-text' | 'body-too-large';
/** The destination itself is refused by policy. Recorded against the collection. */
export declare class DestinationDeniedError extends Error {
    readonly code: "DESTINATION_DENIED";
    /** The URL being fetched at the hop that was denied. */
    readonly url: string;
    readonly reason: DenyReason;
    /** Redirect hop at which the denial occurred (0 = the original URL). */
    readonly hop: number;
    /** Specifics safe to log: the offending address/range, scheme, or size. */
    readonly detail: string | undefined;
    constructor(url: string, reason: DenyReason, hop: number, detail?: string);
}
/** The destination was allowed but the fetch itself failed operationally. */
export declare class FetchFailedError extends Error {
    readonly code: "FETCH_FAILED";
    readonly url: string;
    readonly reason: string;
    readonly hop: number;
    /** HTTP status, when the failure is a non-success response status. */
    readonly status: number | undefined;
    constructor(url: string, reason: string, hop: number, status?: number, cause?: unknown);
}
/** DNS seam: hostname → every address it resolves to. */
export type ArsenalResolveFn = (hostname: string) => Promise<string[]>;
/** What the transport is asked to do for one hop. */
export interface ArsenalTransportRequest {
    /** The exact URL of this hop (original string form). */
    url: string;
    /** The pinned, policy-checked address to connect to. */
    address: string;
    family: 4 | 6;
    /** The original hostname — for the Host header, SNI, and cert validation. */
    hostname: string;
    /** Exactly the headers the guard permits: User-Agent + Accept. */
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
}
/** One hop's raw response, body as a byte stream (the guard enforces the cap). */
export interface ArsenalTransportResponse {
    status: number;
    contentType: string | null;
    location: string | null;
    body: AsyncIterable<Uint8Array>;
}
/** Transport seam: connect to the pinned address, return the raw response. */
export type ArsenalTransportFn = (req: ArsenalTransportRequest) => Promise<ArsenalTransportResponse>;
export interface FetchTextCheckedOptions {
    resolve?: ArsenalResolveFn;
    transport?: ArsenalTransportFn;
    /** Per-request (per-hop) timeout. Default 15 s (spec §6.1.5). */
    timeoutMs?: number;
    /** Response body cap in bytes. Default 4 MiB (spec §6.1.5). */
    maxBodyBytes?: number;
    /** Redirects followed before denying. Default 3 (spec §6.1.4). */
    maxRedirects?: number;
}
export interface FetchTextResult {
    text: string;
    /** The URL that ultimately served the body (after redirects). */
    finalUrl: string;
    /** Redirects followed to reach it. */
    hops: number;
}
