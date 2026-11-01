/**
 * Per-target rate limiting (v0.13.0) — the production safety case.
 *
 * Buyers demand stated, mechanical rate limits — not "the agents are told to
 * be gentle". This is a per-host token bucket the RUNNER enforces: every
 * probe/exec tool acquires a slot before any packet leaves. Black-mode
 * jitter already exists; this is the hard ceiling underneath it.
 *
 * Defaults: 5 requests/sec per host in staging, 2 in production (the
 * production cap is applied mechanically even if the operator configures
 * higher). Overridable via REDTEAM_MAX_RPS / resolveConfig maxRpsPerHost.
 */
export interface RateLimitConfig {
    /** Max sustained requests per second, per host. */
    rpsPerHost: number;
    /** Burst allowance (tokens available immediately). Defaults to rpsPerHost. */
    burst?: number;
    /**
     * TEST MODE (REDTEAM_TEST_MODE): the limiter admits every acquire
     * immediately — no tokens, no waiting. Set from the resolved runner
     * config in phases/run.ts; the bypass is recorded by the engagement's
     * test_mode_active event. Default false.
     */
    disabled?: boolean;
}
export declare const DEFAULT_STAGING_RPS = 5;
export declare const DEFAULT_PRODUCTION_RPS = 2;
export declare const PRODUCTION_RPS_CAP = 2;
/**
 * Per-host token bucket. `acquire(host)` resolves once a token is available
 * (sleeping as needed); `tryAcquire` is the non-blocking check for tests.
 * Time source is injectable so tests don't sleep.
 */
export declare class TargetRateLimiter {
    readonly rpsPerHost: number;
    readonly burst: number;
    /** TEST MODE: admits immediately, never waits (see RateLimitConfig.disabled). */
    readonly disabled: boolean;
    private buckets;
    private now;
    /** Total ms agents spent waiting on the limiter this engagement (manifest). */
    throttledMs: number;
    /** Total acquires granted (manifest). */
    acquires: number;
    constructor(cfg: RateLimitConfig, now?: () => number);
    private bucket;
    private refill;
    /** Non-blocking: true when a token is available right now. */
    tryAcquire(host: string): boolean;
    /** Blocking: waits until a token is available, then takes it. */
    acquire(host: string): Promise<number>;
    /** For the manifest: hosts currently tracked. */
    trackedHosts(): string[];
}
/**
 * Resolve the effective per-host RPS: operator config, with the production
 * cap applied mechanically (production never exceeds PRODUCTION_RPS_CAP,
 * even if configured higher — the manifest records when the cap bites).
 */
export declare function resolveEffectiveRps(environment: "staging" | "production", configuredRps?: number): {
    rps: number;
    productionCapApplied: boolean;
};
