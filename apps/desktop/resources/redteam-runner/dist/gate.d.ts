/**
 * Engagement-level gating. Every check fails closed: uncertainty → deny.
 *
 * Layers (all must pass before aggressive work):
 *  1. Ownership verification: domain ownership proven by the in-app DNS TXT
 *     challenge recorded in the local verified-domain store, or an explicit
 *     operator attestation when supplied by the caller. No external service.
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
export interface CheckAuthorizationOptions {
    /**
     * Explicit operator attestation recorded on the engagement. When provided it
     * is accepted as the verification basis without consulting the local DNS
     * challenge store. Use for test/sandbox flows that intentionally bypass DNS.
     */
    attestedProof?: string;
    /**
     * LOCAL SANDBOX MODE ONLY. When true, skips DNS/store ownership proof for a
     * target that itself resolves to a private/loopback host (e.g. localhost,
     * 127.0.0.1, RFC1918). For any non-private domain this flag has no effect.
     */
    allowLocalSandbox?: boolean;
    /** Path to the local verified-domains store. Defaults to the app store. */
    storeFile?: string;
}
/**
 * Authorization gate. Fail closed: only an explicit attestation, local-sandbox
 * private target, or a domain recorded as verified in the app-local DNS TXT
 * store is allowed. No external service is consulted.
 */
export declare function checkAuthorization(domain: string, opts?: CheckAuthorizationOptions): Promise<GateVerdict>;
export interface ScopeAuthorizationOptions {
    /**
     * Explicit operator attestation covering declared in-scope hosts. When set,
     * public domains in scope are accepted on that attestation basis.
     */
    attestedProof?: string;
    /**
     * LOCAL SANDBOX MODE ONLY. When true, every host in scope must be
     * private/loopback so a loopback target can never combine with public scope.
     */
    allowLocalSandbox?: boolean;
    /** The engagement target, already verified by {@link checkAuthorization}. */
    verifiedTarget?: string;
    /** Path to the local verified-domains store. Defaults to the app store. */
    storeFile?: string;
}
/**
 * Verify ownership for EVERY host the engagement may touch. Fail closed.
 * - empty scope: denied
 * - local sandbox: every host must be private/loopback
 * - otherwise: target needs no second check; IP-literal entries are ROE-authorized
 *   host-engagement targets; every other domain must be locally verified (DNS TXT
 *   store) unless covered by an explicit attestation.
 */
export declare function checkScopeAuthorization(hosts: readonly string[], opts?: ScopeAuthorizationOptions): Promise<GateVerdict>;
