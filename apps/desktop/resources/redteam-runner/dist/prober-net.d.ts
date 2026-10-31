import { type LookupFunction } from 'node:net';
export interface DnsAddress {
    address: string;
    family: 4 | 6;
}
/** Injectable resolver seam — tests inject fakes; production uses node:dns. */
export type DnsResolver = (hostname: string) => Promise<DnsAddress[]>;
/** System resolver (handles names, IP literals, /etc/hosts entries). */
export declare const defaultDnsResolver: DnsResolver;
export type IpClass = 'public' | 'loopback' | 'private' | 'link-local';
export declare function classifyIpAddress(rawIp: string): IpClass;
export interface ResolveCheckedOptions {
    /** LOCAL SANDBOX MODE ONLY — permits loopback/private resolutions. */
    allowPrivateHosts?: boolean;
    resolver?: DnsResolver;
}
/**
 * Resolve `hostname` and validate EVERY resulting address against policy.
 * IP literals skip DNS and are classified directly. Returns the validated
 * address set for pinned connections.
 */
export declare function resolveCheckedAddresses(hostname: string, opts?: ResolveCheckedOptions): Promise<{
    ok: true;
    addresses: DnsAddress[];
} | {
    ok: false;
    reason: string;
}>;
/**
 * A dns.lookup replacement that can only ever yield `addresses` — the set
 * resolveCheckedAddresses already validated. The socket connects to the
 * checked addresses: no second resolution, no check/fetch TOCTOU window.
 */
export declare function makePinnedLookup(addresses: DnsAddress[]): LookupFunction;
export interface PinnedResponse {
    status: number;
    headers: Record<string, string>;
    text: string;
}
/**
 * One HTTP(S) request to `url`, connected to the pre-validated `addresses`
 * (pinning via lookup override). Redirects are never followed here — the
 * caller inspects and validates Location targets itself. When `readBody` is
 * false the promise resolves as soon as headers arrive (burst probe).
 */
export declare function pinnedHttpRequest(url: string, init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    addresses: DnsAddress[];
    signal?: AbortSignal;
    readBody?: boolean;
    /** Cap on buffered wire bytes; past it the response is cut short. */
    maxBodyBytes?: number;
}): Promise<PinnedResponse>;
