/**
 * Engagement-level gating. Every check fails closed: uncertainty → deny.
 *
 * Layers (all must pass before aggressive work):
 *  1. Ownership verification: by default the engagement record's operator
 *     attestation; server-authoritative (auth-gate's isServerVerified)
 *     only when the operator opts into service verification.
 *  2. Scope: every probed/scanned URL's hostname must be an exact in-scope host.
 *  3. Technique exclusions: always-excluded + mode defaults + ROE exclusions.
 *  4. Blackout windows: the runner pauses, it does not skip.
 *  5. Test window: the runner refuses to run outside the agreed window.
 */
import type { BlackoutWindow, EngagementMode, RulesOfEngagement } from "./types.js";
export interface GateVerdict {
    allowed: boolean;
    reason?: string;
}
/** Normalize ROE scope entries (URLs or bare hosts) to lowercase hostnames. */
export declare function scopeHosts(roe: RulesOfEngagement): string[];
/** True when the URL's hostname is exactly one of the in-scope hosts. */
export declare function urlInScope(url: string, hosts: string[]): boolean;
/**
 * True when `now` falls inside any blackout window. Windows are daily,
 * "HH:MM" 24h, and may cross midnight. Evaluated in the window's tz (or the
 * runner's local tz when unset).
 */
export declare function inBlackout(now: Date, windows: BlackoutWindow[] | undefined): BlackoutWindow | null;
/** True when `now` is inside the agreed test window (or no window was set). */
export declare function inTestWindow(now: Date, roe: RulesOfEngagement): boolean;
/** True when the ATT&CK technique may be used in this engagement. */
export declare function techniqueAllowed(attackId: string | undefined, mode: EngagementMode, roe: RulesOfEngagement, opts?: {
    testMode?: boolean;
}): boolean;
export interface ServerGateConfig {
    mcpEndpoint: string;
    mcpToken: string;
}
export interface CheckAuthorizationOptions {
    /**
     * The engagement record's ownership attestation (operator attestation /
     * proofMethod text), when verification is taken from the record — the
     * default basis. When set, the gate returns it as the verdict reason and
     * the server check is never consulted. Unset means the caller opted into
     * service verification and the server check decides.
     */
    attestedProof?: string;
    /**
     * LOCAL SANDBOX MODE ONLY. When true, skips the server verification call
     * — but ONLY when `domain` itself resolves to a private/loopback host
     * (e.g. localhost, 127.0.0.1, a RFC1918 address). For any real-looking
     * domain this flag has zero effect: the server check still runs and the
     * engagement still fails closed exactly as before. This exists so a
     * locally-hosted sandbox target (Juice Shop/DVWA on 127.0.0.1) can be
     * engaged without needing DNS TXT ownership proof, which can't exist for
     * a loopback address anyway. Default false; must be explicitly opted
     * into (CLI --local-sandbox / REDTEAM_LOCAL_SANDBOX=1), never implied.
     */
    allowLocalSandbox?: boolean;
}
/**
 * The authorization gate. Default basis: the engagement record's operator
 * attestation (opts.attestedProof) — allowed, with the attestation as the
 * recorded proof, and no service call. When no attestation is supplied the
 * caller opted into service verification: the SecScan server must positively
 * list the domain as verified, and network errors, timeouts, missing
 * token → denied (fail closed).
 * `verify` is injectable so unit tests never touch the network.
 */
export declare function checkAuthorization(domain: string, cfg: ServerGateConfig, verify?: (domain: string, cfg: {
    endpoint: string;
    token: string;
}) => Promise<boolean>, opts?: CheckAuthorizationOptions): Promise<GateVerdict>;
export interface ScopeAuthorizationOptions {
    /**
     * The engagement record's ownership attestation, as in
     * {@link CheckAuthorizationOptions.attestedProof}: when set, an in-scope
     * public host is covered by the attestation and the server check is never
     * consulted for it. The structural rules below (empty scope, private
     * hosts, sandbox containment) apply unchanged under either basis.
     */
    attestedProof?: string;
    /**
     * LOCAL SANDBOX MODE ONLY. When true, the whole engagement is restricted to
     * private/loopback hosts: every scope entry must be private too, because a
     * sandbox bypass for the target says nothing about ownership of anything else.
     */
    allowLocalSandbox?: boolean;
    /** The engagement target, already verified by {@link checkAuthorization}. */
    verifiedTarget?: string;
}
/**
 * Verify ownership for EVERY host the engagement may touch, not just its target.
 *
 * Members of the ROE scope list are checked for exact-hostname membership by the
 * prober, but membership only proves the operator listed them — it does not prove
 * the client owns them. Without this pass, an engagement against one verified
 * domain could probe any number of other public hosts, which is precisely the
 * authorization the product claims to enforce.
 *
 * Rules, all fail closed:
 *  - empty scope: denied (there is nothing an engagement may legitimately probe);
 *  - local sandbox: every host must be private/loopback, so a loopback target can
 *    never be combined with a public host in scope;
 *  - otherwise: the target needs no second call; an IP-literal scope entry is a
 *    host-engagement target authorized by the ROE (domain verification cannot
 *    apply to an address); every other host must be verified — by the
 *    engagement record's attestation on the default basis, or server-verified
 *    when the operator opted into service verification.
 *
 * `verify` is injectable so unit tests never touch the network.
 */
export declare function checkScopeAuthorization(hosts: readonly string[], cfg: ServerGateConfig, verify?: (domain: string, cfg: {
    endpoint: string;
    token: string;
}) => Promise<boolean>, opts?: ScopeAuthorizationOptions): Promise<GateVerdict>;
