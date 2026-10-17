/**
 * Engagement-level gating. Every check fails closed: uncertainty → deny.
 *
 * Layers (all must pass before aggressive work):
 *  1. Server-authoritative ownership verification (auth-gate's isServerVerified).
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
export declare function techniqueAllowed(attackId: string | undefined, mode: EngagementMode, roe: RulesOfEngagement): boolean;
export interface ServerGateConfig {
    mcpEndpoint: string;
    mcpToken: string;
}
export interface CheckAuthorizationOptions {
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
 * The authorization gate: the SecScan server must positively list the domain
 * as verified. Network errors, timeouts, missing token → denied (fail closed).
 * `verify` is injectable so unit tests never touch the network.
 */
export declare function checkAuthorization(domain: string, cfg: ServerGateConfig, verify?: (domain: string, cfg: {
    endpoint: string;
    token: string;
}) => Promise<boolean>, opts?: CheckAuthorizationOptions): Promise<GateVerdict>;
