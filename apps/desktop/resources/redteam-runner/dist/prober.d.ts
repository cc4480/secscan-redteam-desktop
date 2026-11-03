/**
 * Web prober — the exploiter's hands.
 *
 * Every probe is a single HTTP(S) request against an in-scope host. Guardrails
 * are mechanical, not advisory:
 *  - only http/https URLs, only exact in-scope hostnames
 *  - literal private IPs rejected; every hostname is DNS-resolved with EVERY
 *    address classified pre-connect, and the connection is pinned to the
 *    validated set (prober-net.ts) — no SSRF pivot via attacker DNS
 *  - redirect (Location) targets get the same resolved-address validation
 *  - request bodies capped at 64KB; 20s timeout; global rate limit
 *  - detection signals (WAF block, 429, CAPTCHA markers) surfaced as OPSEC
 *    events so black mode can back off
 * Non-destructive by construction: single requests, never floods; payload
 * discipline lives in the exploiter prompt (no writes/deletes, no exhaustion).
 */
import { allHostsPrivateOrLoopback, isPrivateOrLoopbackHost, validateProbeTarget } from './prober-address.js';
import { type DnsResolver } from './prober-net.js';
export { allHostsPrivateOrLoopback, isPrivateOrLoopbackHost, validateProbeTarget };
export type { ValidateProbeTargetOptions } from './prober-address.js';
export interface ProbeRequest {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
}
export interface ProbeResult {
    status: number;
    headers: Record<string, string>;
    /** First 4KB of the response body. */
    bodySnippet: string;
    ms: number;
    /** Set when the response looks like a defender fired (WAF/rate-limit/CAPTCHA). */
    opsecSignal?: string;
}
/**
 * A fixed-size, one-shot resilience probe — NOT a flood/DoS primitive.
 * Observes whether rate-limiting exists at all by firing one small, capped
 * batch of concurrent idempotent requests. The batch size is fixed
 * (BURST_SIZE) and not caller-adjustable, so it cannot be scaled up into a
 * real load test; callers (phases.ts) additionally cap this to one call per
 * endpoint per engagement.
 */
export interface ProbeBurstRequest {
    /** GET or HEAD only — never a mutating method. */
    method: string;
    url: string;
}
export interface ProbeBurstResult {
    count: number;
    statuses: number[];
    /** True if any response in the batch was a 429. */
    rateLimited: boolean;
    minMs: number;
    maxMs: number;
    note: string;
}
export interface ProberOptions {
    scopeHosts: string[];
    timeoutMs?: number;
    /** Minimum ms between probes. Black mode adds jitter on top. Default 800. */
    minDelayMs?: number;
    /** LOCAL SANDBOX MODE ONLY — see ValidateProbeTargetOptions. Default false. */
    allowPrivateHosts?: boolean;
    /** The verified engagement record's per-host verdict — see ValidateProbeTargetOptions. */
    attestedHost?: (host: string) => boolean;
    /** Injectable DNS resolver (test seam); production uses the system resolver. */
    resolver?: DnsResolver;
}
/** Structural interface so tests can inject a fake prober (no network). */
export interface ProberLike {
    probe(req: ProbeRequest): Promise<ProbeResult>;
    /** Optional: fake probers in tests need not implement this. */
    probeBurst?(req: ProbeBurstRequest): Promise<ProbeBurstResult>;
}
export declare class WebProber implements ProberLike {
    private readonly scopeHosts;
    private readonly timeoutMs;
    private readonly minDelayMs;
    private readonly allowPrivateHosts;
    private readonly attestedHost?;
    private readonly resolver?;
    private lastProbeAt;
    constructor(opts: ProberOptions);
    /** Private-resolution allowance for one host: the sandbox flag, or the verified record's verdict for that host. */
    private allowPrivateFor;
    /**
     * Resolve the URL's hostname, validate every address (prober-net.ts), and
     * return the set the connection is pinned to. Throws `[prober] refused:`
     * before any socket opens when any address is out of policy.
     */
    private resolveFor;
    /**
     * Hops are never auto-followed, but the Location target gets the same
     * resolved-address validation: a 3xx into forbidden space refuses the
     * probe rather than handing out the hop. If the caller later probes that
     * URL itself, probe() re-resolves/re-validates/pins then — a check here
     * can never bless a stale answer.
     */
    private assertRedirectTargetAllowed;
    probe(req: ProbeRequest): Promise<ProbeResult>;
    /**
     * One-shot resilience probe: fires a FIXED-size batch of concurrent
     * GET/HEAD requests to observe whether rate-limiting exists. Never a flood
     * primitive — BURST_SIZE is constant, and the global cooldown applies after.
     */
    probeBurst(req: ProbeBurstRequest): Promise<ProbeBurstResult>;
}
