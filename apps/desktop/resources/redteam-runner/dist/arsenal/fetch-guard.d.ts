/**
 * DestinationFilter-guarded fetcher — the arsenal module's ONLY network seam
 * (spec §6). Every outbound request from the ingest write path — README
 * fetches and every redirect hop — passes through {@link fetchTextChecked}.
 * No other file in `src/arsenal/` may import a network API (spec §12.12).
 *
 * Policy (spec §6.1, evaluated per request and per redirect hop):
 *   1. `https:` only; every other scheme is denied.
 *   2. No embedded URL credentials; no Authorization header is ever sent —
 *      only a descriptive User-Agent and `Accept: text/plain, text/markdown`.
 *   3. The host is resolved once; if ANY resulting address is loopback,
 *      private, link-local, unspecified, multicast, or otherwise
 *      non-global/reserved, the fetch is denied. The transport then connects
 *      to a PINNED address from that same checked answer (with the original
 *      host preserved for Host/SNI/certificate validation), so the address
 *      validated is the address used — no resolve-twice TOCTOU window.
 *   4. Redirects are followed manually, max 3 hops, each hop re-running the
 *      full policy. A redirect to a denied destination denies the whole fetch.
 *   5. Bounds: 15 s per request, 4 MiB body cap, text-ish content types only.
 *   6. Denials are data for the caller: typed errors, never a crash of the
 *      surrounding refresh (spec §6.1.6 is honored by `ingest.ts`, which
 *      records `{url, reason}` per collection and continues).
 *
 * The resolver and the transport are injected seams
 * (`fetchTextChecked(url, { resolve, transport })`) so tests never touch DNS
 * or the network. The defaults are the real DNS lookup and a `node:https`
 * transport whose `lookup` is pinned to the checked address.
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
/**
 * Fetch a public README over https, under the DestinationFilter policy.
 * The only network function the arsenal module exports (spec §6.2).
 *
 * @param url - the URL to fetch (first hop; redirects are followed manually).
 * @param opts - injected seams and bound overrides (tests inject both seams).
 * @returns the decoded body text, the final URL, and the redirect hop count.
 * @throws {DestinationDeniedError} when policy refuses any hop's destination.
 * @throws {FetchFailedError} when an allowed destination fails operationally.
 */
export declare function fetchTextChecked(url: string, opts?: FetchTextCheckedOptions): Promise<FetchTextResult>;
