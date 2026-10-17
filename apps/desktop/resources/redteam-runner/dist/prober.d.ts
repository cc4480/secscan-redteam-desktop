/**
 * Web prober — the exploiter's hands.
 *
 * Every probe is a single HTTP(S) request against an in-scope host. Guardrails
 * are mechanical, not advisory:
 *  - only http/https URLs, only exact in-scope hostnames
 *  - literal private IPs / localhost are rejected (the runner must never be
 *    usable as an SSRF pivot against internal infrastructure)
 *  - request bodies capped at 64KB; 20s timeout; global rate limit
 *  - detection signals (WAF block, 429, CAPTCHA markers) are surfaced as
 *    OPSEC events so black mode can back off
 *
 * Non-destructive by construction: the prober sends single requests, never
 * floods, and the payload discipline lives in the exploiter prompt (no data
 * writes/deletes, no resource exhaustion).
 */
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
/** True when `host` is a literal private-range or loopback address/name. */
export declare function isPrivateOrLoopbackHost(host: string): boolean;
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
}
export declare function validateProbeTarget(url: string, scopeHosts: string[], opts?: ValidateProbeTargetOptions): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export interface ProberOptions {
    scopeHosts: string[];
    timeoutMs?: number;
    /** Minimum ms between probes. Black mode adds jitter on top. Default 800. */
    minDelayMs?: number;
    /** LOCAL SANDBOX MODE ONLY — see ValidateProbeTargetOptions. Default false. */
    allowPrivateHosts?: boolean;
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
    private lastProbeAt;
    constructor(opts: ProberOptions);
    probe(req: ProbeRequest): Promise<ProbeResult>;
    /**
     * One-shot resilience probe: fires a FIXED-size batch of concurrent
     * GET/HEAD requests to observe whether rate-limiting exists. Never a
     * flood primitive — BURST_SIZE is constant, not caller-controlled, and
     * the global rate-limit cooldown applies afterward exactly as it would
     * after a single probe() call.
     */
    probeBurst(req: ProbeBurstRequest): Promise<ProbeBurstResult>;
}
