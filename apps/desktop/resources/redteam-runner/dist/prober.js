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
const BURST_SIZE = 8;
const MAX_BODY_BYTES = 64 * 1024;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\]|::1$)/i;
/** True when `host` is a literal private-range or loopback address/name. */
/**
 * True when every host is private/loopback (and there is at least one).
 *
 * Local sandbox mode skips ownership verification for a private target, so it may only
 * widen the prober to private hosts when the WHOLE scope is private: a loopback target
 * combined with a public scope host must not inherit the sandbox bypass.
 */
export function allHostsPrivateOrLoopback(hosts) {
    return hosts.length > 0 && hosts.every((h) => isPrivateOrLoopbackHost(h));
}
export function isPrivateOrLoopbackHost(host) {
    return PRIVATE_HOST.test(host.toLowerCase());
}
export function validateProbeTarget(url, scopeHosts, opts = {}) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        return { ok: false, reason: `unparseable URL: ${url}` };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { ok: false, reason: `scheme not allowed: ${u.protocol}` };
    }
    const host = u.hostname.toLowerCase();
    if (isPrivateOrLoopbackHost(host) && !opts.allowPrivateHosts) {
        return { ok: false, reason: `private/loopback host rejected: ${host}` };
    }
    if (!scopeHosts.includes(host)) {
        return { ok: false, reason: `out of scope: ${host} (scope: ${scopeHosts.join(", ")})` };
    }
    return { ok: true };
}
function detectOpsecSignal(status, headers, body) {
    if (status === 429)
        return "rate-limited (429)";
    const server = (headers["server"] ?? "").toLowerCase();
    const bodyLow = body.toLowerCase();
    if (status === 403 && /cloudflare|akamai|incapsula|imperva|f5|awselb|distil|perimeterx/i.test(server + bodyLow)) {
        return "probable WAF/bot-wall block (403)";
    }
    if (/captcha|cf-chl|attention required|request blocked|access denied.*bot/i.test(bodyLow) && body.length < 20000) {
        return "challenge/block page served";
    }
    return undefined;
}
export class WebProber {
    scopeHosts;
    timeoutMs;
    minDelayMs;
    allowPrivateHosts;
    lastProbeAt = 0;
    constructor(opts) {
        this.scopeHosts = opts.scopeHosts.map((h) => h.toLowerCase());
        this.timeoutMs = opts.timeoutMs ?? 20_000;
        this.minDelayMs = opts.minDelayMs ?? 800;
        this.allowPrivateHosts = opts.allowPrivateHosts ?? false;
    }
    async probe(req) {
        const v = validateProbeTarget(req.url, this.scopeHosts, { allowPrivateHosts: this.allowPrivateHosts });
        if (!v.ok)
            throw new Error(`[prober] refused: ${v.reason}`);
        if (req.body && Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) {
            throw new Error(`[prober] refused: body exceeds ${MAX_BODY_BYTES} bytes`);
        }
        const method = (req.method || "GET").toUpperCase();
        if (!/^[A-Z]+$/.test(method) || method.length > 10) {
            throw new Error(`[prober] refused: bad method ${req.method}`);
        }
        // Global rate limit.
        const wait = this.minDelayMs - (Date.now() - this.lastProbeAt);
        if (wait > 0)
            await new Promise((r) => setTimeout(r, wait));
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        const started = Date.now();
        try {
            const res = await fetch(req.url, {
                method,
                headers: { "user-agent": "secscan-redteam-runner/0.4.0", ...(req.headers ?? {}) },
                body: req.body === undefined ? undefined : req.body,
                redirect: "manual",
                signal: ctrl.signal,
            });
            const text = await res.text().catch(() => "");
            const headers = {};
            res.headers.forEach((val, key) => {
                headers[key.toLowerCase()] = val;
            });
            const ms = Date.now() - started;
            this.lastProbeAt = Date.now();
            const bodySnippet = text.slice(0, 4096);
            return {
                status: res.status,
                headers,
                bodySnippet,
                ms,
                opsecSignal: detectOpsecSignal(res.status, headers, bodySnippet),
            };
        }
        finally {
            clearTimeout(timer);
        }
    }
    /**
     * One-shot resilience probe: fires a FIXED-size batch of concurrent
     * GET/HEAD requests to observe whether rate-limiting exists. Never a
     * flood primitive — BURST_SIZE is constant, not caller-controlled, and
     * the global rate-limit cooldown applies afterward exactly as it would
     * after a single probe() call.
     */
    async probeBurst(req) {
        const method = (req.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
            throw new Error(`[prober] refused: burst probe only allows GET/HEAD (idempotent), got ${method}`);
        }
        const v = validateProbeTarget(req.url, this.scopeHosts, { allowPrivateHosts: this.allowPrivateHosts });
        if (!v.ok)
            throw new Error(`[prober] refused: ${v.reason}`);
        const wait = this.minDelayMs - (Date.now() - this.lastProbeAt);
        if (wait > 0)
            await new Promise((r) => setTimeout(r, wait));
        const started = Date.now();
        const results = await Promise.all(Array.from({ length: BURST_SIZE }, async () => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
            try {
                const res = await fetch(req.url, {
                    method,
                    headers: { "user-agent": "secscan-redteam-runner/0.5.0" },
                    redirect: "manual",
                    signal: ctrl.signal,
                });
                return { status: res.status, ms: Date.now() - started };
            }
            catch {
                return { status: 0, ms: Date.now() - started };
            }
            finally {
                clearTimeout(timer);
            }
        }));
        this.lastProbeAt = Date.now();
        const statuses = results.map((r) => r.status);
        const rateLimited = statuses.includes(429);
        const distinct = [...new Set(statuses)].join(", ");
        return {
            count: BURST_SIZE,
            statuses,
            rateLimited,
            minMs: Math.min(...results.map((r) => r.ms)),
            maxMs: Math.max(...results.map((r) => r.ms)),
            note: rateLimited
                ? `${BURST_SIZE} concurrent requests: rate limiting IS present (429 observed in the batch).`
                : `${BURST_SIZE} concurrent requests: no rate limiting observed — status(es): ${distinct}.`,
        };
    }
}
//# sourceMappingURL=prober.js.map