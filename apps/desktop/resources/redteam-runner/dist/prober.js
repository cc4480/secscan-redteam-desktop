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
import { allHostsPrivateOrLoopback, isPrivateOrLoopbackHost, validateProbeTarget, } from './prober-address.js';
import { pinnedHttpRequest, resolveCheckedAddresses, } from './prober-net.js';
// Re-exported for callers (gate, sandbox) that import the address policy from this
// module: moving the implementation must not change their import path.
export { allHostsPrivateOrLoopback, isPrivateOrLoopbackHost, validateProbeTarget };
const BURST_SIZE = 8;
const MAX_BODY_BYTES = 64 * 1024;
function detectOpsecSignal(status, headers, body) {
    if (status === 429)
        return 'rate-limited (429)';
    const server = (headers['server'] ?? '').toLowerCase();
    const bodyLow = body.toLowerCase();
    if (status === 403 && /cloudflare|akamai|incapsula|imperva|f5|awselb|distil|perimeterx/i.test(server + bodyLow)) {
        return 'probable WAF/bot-wall block (403)';
    }
    if (/captcha|cf-chl|attention required|request blocked|access denied.*bot/i.test(bodyLow) && body.length < 20000) {
        return 'challenge/block page served';
    }
    return undefined;
}
export class WebProber {
    scopeHosts;
    timeoutMs;
    minDelayMs;
    allowPrivateHosts;
    attestedHost;
    resolver;
    lastProbeAt = 0;
    constructor(opts) {
        this.scopeHosts = opts.scopeHosts.map(h => h.toLowerCase());
        this.timeoutMs = opts.timeoutMs ?? 20_000;
        this.minDelayMs = opts.minDelayMs ?? 800;
        this.allowPrivateHosts = opts.allowPrivateHosts ?? false;
        this.attestedHost = opts.attestedHost;
        this.resolver = opts.resolver;
    }
    /** Private-resolution allowance for one host: the sandbox flag, or the verified record's verdict for that host. */
    allowPrivateFor(host) {
        return this.allowPrivateHosts || (this.attestedHost?.(host) ?? false);
    }
    /**
     * Resolve the URL's hostname, validate every address (prober-net.ts), and
     * return the set the connection is pinned to. Throws `[prober] refused:`
     * before any socket opens when any address is out of policy.
     */
    async resolveFor(url) {
        const host = new URL(url).hostname;
        const checked = await resolveCheckedAddresses(host, {
            allowPrivateHosts: this.allowPrivateFor(host),
            resolver: this.resolver,
        });
        if (!checked.ok)
            throw new Error(`[prober] refused: ${checked.reason}`);
        return checked.addresses;
    }
    /**
     * Hops are never auto-followed, but the Location target gets the same
     * resolved-address validation: a 3xx into forbidden space refuses the
     * probe rather than handing out the hop. If the caller later probes that
     * URL itself, probe() re-resolves/re-validates/pins then — a check here
     * can never bless a stale answer.
     */
    async assertRedirectTargetAllowed(location, baseUrl) {
        let target;
        try {
            target = new URL(location, baseUrl);
        }
        catch {
            return; // Unparseable Location — never followed by anyone; nothing to vet.
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            throw new Error(`[prober] refused: redirect to non-http(s) scheme ${target.protocol}`);
        }
        const checked = await resolveCheckedAddresses(target.hostname, {
            allowPrivateHosts: this.allowPrivateFor(target.hostname),
            resolver: this.resolver,
        });
        if (!checked.ok)
            throw new Error(`[prober] refused: redirect target ${target.hostname} rejected: ${checked.reason}`);
    }
    async probe(req) {
        const v = validateProbeTarget(req.url, this.scopeHosts, { allowPrivateHosts: this.allowPrivateHosts, attestedHost: this.attestedHost });
        if (!v.ok)
            throw new Error(`[prober] refused: ${v.reason}`);
        if (req.body && Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
            throw new Error(`[prober] refused: body exceeds ${MAX_BODY_BYTES} bytes`);
        }
        const method = (req.method || 'GET').toUpperCase();
        if (!/^[A-Z]+$/.test(method) || method.length > 10) {
            throw new Error(`[prober] refused: bad method ${req.method}`);
        }
        // Global rate limit.
        const wait = this.minDelayMs - (Date.now() - this.lastProbeAt);
        if (wait > 0)
            await new Promise(r => setTimeout(r, wait));
        // Resolve + validate + pin (audit 2026-10-09 security #5): the socket
        // only ever connects to addresses that passed classification.
        const addresses = await this.resolveFor(req.url);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        const started = Date.now();
        try {
            const res = await pinnedHttpRequest(req.url, {
                method,
                headers: { 'user-agent': 'secscan-redteam-runner/0.4.0', 'accept-encoding': 'gzip, deflate, br', ...(req.headers ?? {}) },
                body: req.body === undefined ? undefined : req.body,
                addresses,
                signal: ctrl.signal,
                maxBodyBytes: MAX_BODY_BYTES,
            });
            const ms = Date.now() - started;
            this.lastProbeAt = Date.now();
            if (res.status >= 300 && res.status < 400 && res.headers['location']) {
                await this.assertRedirectTargetAllowed(res.headers['location'], req.url);
            }
            const bodySnippet = res.text.slice(0, 4096);
            return { status: res.status, headers: res.headers, bodySnippet, ms, opsecSignal: detectOpsecSignal(res.status, res.headers, bodySnippet) };
        }
        finally {
            clearTimeout(timer);
        }
    }
    /**
     * One-shot resilience probe: fires a FIXED-size batch of concurrent
     * GET/HEAD requests to observe whether rate-limiting exists. Never a flood
     * primitive — BURST_SIZE is constant, and the global cooldown applies after.
     */
    async probeBurst(req) {
        const method = (req.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
            throw new Error(`[prober] refused: burst probe only allows GET/HEAD (idempotent), got ${method}`);
        }
        const v = validateProbeTarget(req.url, this.scopeHosts, { allowPrivateHosts: this.allowPrivateHosts, attestedHost: this.attestedHost });
        if (!v.ok)
            throw new Error(`[prober] refused: ${v.reason}`);
        const wait = this.minDelayMs - (Date.now() - this.lastProbeAt);
        if (wait > 0)
            await new Promise(r => setTimeout(r, wait));
        // Same resolve/validate/pin discipline as probe() — one validation for
        // the whole batch; a refusal here happens before any packet is sent.
        const addresses = await this.resolveFor(req.url);
        const started = Date.now();
        const results = await Promise.all(Array.from({ length: BURST_SIZE }, async () => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
            try {
                const res = await pinnedHttpRequest(req.url, {
                    method,
                    headers: { 'user-agent': 'secscan-redteam-runner/0.5.0' },
                    addresses,
                    signal: ctrl.signal,
                    readBody: false,
                });
                return { status: res.status, ms: Date.now() - started, location: res.headers['location'] };
            }
            catch {
                return { status: 0, ms: Date.now() - started, location: undefined };
            }
            finally {
                clearTimeout(timer);
            }
        }));
        this.lastProbeAt = Date.now();
        const redirect = results.find(r => r.status >= 300 && r.status < 400 && r.location);
        if (redirect?.location)
            await this.assertRedirectTargetAllowed(redirect.location, req.url);
        const statuses = results.map(r => r.status);
        const rateLimited = statuses.includes(429);
        const distinct = [...new Set(statuses)].join(', ');
        const note = rateLimited
            ? `${BURST_SIZE} concurrent requests: rate limiting IS present (429 observed in the batch).`
            : `${BURST_SIZE} concurrent requests: no rate limiting observed — status(es): ${distinct}.`;
        return { count: BURST_SIZE, statuses, rateLimited, minMs: Math.min(...results.map(r => r.ms)), maxMs: Math.max(...results.map(r => r.ms)), note };
    }
}
//# sourceMappingURL=prober.js.map