/**
 * Address policy shared by the prober and its DNS-pinned transport.
 *
 * Kept apart from prober-net.ts so the resolver/pinning code stays within the
 * repository's per-file budget; the rules themselves are the same ones
 * validateProbeTarget has always applied before any packet is sent.
 */
/** Literal private-range / loopback host, by name or address (pre-resolution guard). */
export declare const PRIVATE_HOST: RegExp
/** True when `host` is a literal private-range or loopback address/name. */
export declare function isPrivateOrLoopbackHost(host: string): boolean
/**
 * True when every host is private/loopback (and there is at least one).
 *
 * Local sandbox mode skips ownership verification for a private target, so it may only
 * widen the prober to private hosts when the WHOLE scope is private: a loopback target
 * combined with a public scope host must not inherit the sandbox bypass.
 */
export declare function allHostsPrivateOrLoopback(hosts: readonly string[]): boolean
