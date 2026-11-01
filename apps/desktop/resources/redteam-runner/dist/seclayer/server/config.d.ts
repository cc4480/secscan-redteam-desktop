/**
 * The scanner's outbound User-Agent — one string, used by every fetch path.
 *
 * The `Mozilla/5.0 (compatible; <bot>; +<url>)` form is the convention every
 * legitimate crawler uses (Googlebot, Bingbot). It still identifies honestly as
 * the Seclayer scanner and is NOT browser-spoofing — it does not claim to be
 * Chrome or any real browser. It replaced a bare `Seclayer-Security-Scanner/2.0`
 * token that Cloudflare's bot management scored as an obvious non-browser bot
 * and 403'd from a cloud egress IP, blocking scans of sites (e.g. lovable.dev)
 * that return 200 to any conventional request. The `SCANNER_USER_AGENT` env var
 * overrides it for self-hosted operators.
 *
 * Eight call sites had drifted to slightly different literals; they now share
 * this one, so the identity a target sees is consistent everywhere.
 */
export declare const SCANNER_USER_AGENT: string;
export declare function parseRole(raw?: string | undefined): 'web' | 'worker' | 'all';
/**
 * The exact build running in this process, for OPERATORS ONLY.
 *
 * Deliberately separate from config.appVersion, which is public (see there).
 * This is logged once at boot, so it reaches the platform's log stream — which
 * requires project access to read — and never an HTTP response body.
 *
 * It exists because "is my change actually live?" had no answer from inside the
 * app: the public health endpoint reported `dev`, and the only way to tell was
 * to query the deploy platform's API from a developer machine.
 *
 * The git SHA is supplied by the platform on a deploy (Railway and Vercel both
 * inject their own name for it); `local` is the honest answer when none is —
 * a developer run, or a `docker build` that passed no build metadata.
 */
export declare function buildId(env?: NodeJS.ProcessEnv): string;
export declare const config: {
    port: number;
    isProd: boolean;
    role: "web" | "worker" | "all";
    maxConcurrentScans: number;
    maxInFlightScansPerUser: number;
    appVersion: string;
    healthDetailToken: string | undefined;
    appUrl: string | undefined;
    deepseekConfigured: boolean;
    googleClientId: string | undefined;
    emailConfigured: boolean;
    stripeConfigured: boolean;
    freeMode: boolean;
    devSkipAuth: boolean;
    devSkipDomainVerification: boolean;
    disableRateLimits: boolean;
    allowUnverifiedActiveProbes: boolean;
    allowMissingEmailProvider: boolean;
};
/**
 * Production settings that fail QUIETLY when absent, which is why they are checked at boot.
 *
 *  - ENCRYPTION_KEY seals every credential the app stores for a user (their DeepSeek key, the
 *    credentials they give a scan). Without it the first save returns a 500 long after deploy.
 *    Critical: refusing to start is better than discovering it from a user.
 *  - ORIGIN_AUTH_SECRET turns the origin lock on. Unset, the app serves anyone who dials the
 *    platform's address directly and skips Cloudflare entirely, and nothing says so. A warning, not
 *    a refusal, because the lock is deliberately off until the Cloudflare rule exists.
 */
export declare function productionSecretProblems(env?: NodeJS.ProcessEnv): {
    warnings: string[];
    critical: boolean;
};
export declare function validateConfigOnBoot(): boolean;
