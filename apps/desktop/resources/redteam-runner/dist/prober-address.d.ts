/**
 * Address policy shared by the prober and its DNS-pinned transport.
 *
 * Kept apart from prober-net.ts so the resolver/pinning code stays within the
 * repository's per-file budget; the rules themselves are the same ones
 * validateProbeTarget has always applied before any packet is sent.
 */
/** True when `host` is a literal private-range or loopback address/name. */
export declare function isPrivateOrLoopbackHost(host: string): boolean;
/**
 * True when every host is private/loopback (and there is at least one).
 *
 * Local sandbox mode skips ownership verification for a private target, so it may only
 * widen the prober to private hosts when the WHOLE scope is private: a loopback target
 * combined with a public scope host must not inherit the sandbox bypass.
 */
export declare function allHostsPrivateOrLoopback(hosts: readonly string[]): boolean;
export interface ValidateProbeTargetOptions {
    /**
     * LOCAL SANDBOX MODE ONLY. When true, a private/loopback host that is also
     * an exact in-scope host is allowed. This never widens the scope check —
     * it only lifts the private-IP rejection for a host you explicitly put in
     * the ROE. Never set this for an engagement against a real domain: it has
     * no effect there (the host still has to resolve as private/loopback to
     * qualify), but it should never be on by default or implied by anything
     * other than an explicit, separate opt-in flag.
     */
    allowPrivateHosts?: boolean;
    /**
     * The verified engagement record's verdict for a host (see
     * safety/attested-host.ts). When it allows the host, the private/
     * loopback rejection is lifted for that host exactly as under
     * allowPrivateHosts — the attested record is the authorization, so a
     * lab or LAN target the owner verified is reachable without the
     * sandbox flag. Consulted per host, only for this rejection: the
     * scope-membership check below is unchanged, and link-local stays
     * refused unconditionally.
     */
    attestedHost?: (host: string) => boolean;
}
/**
 * The prober's pre-flight target validation: scheme, link-local,
 * private/loopback, and exact scope membership, in that order — every
 * refusal lands before any packet is sent.
 */
export declare function validateProbeTarget(url: string, scopeHosts: string[], opts?: ValidateProbeTargetOptions): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
