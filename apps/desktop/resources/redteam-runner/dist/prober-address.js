/**
 * Address policy shared by the prober and its DNS-pinned transport.
 *
 * Kept apart from prober-net.ts so the resolver/pinning code stays within the
 * repository's per-file budget; the rules themselves are the same ones
 * validateProbeTarget has always applied before any packet is sent.
 */
import { isIP } from 'node:net';
/** Parse alternate IP encodings into a canonical IPv4/IPv6 string when possible. */
function normalizeIp(host) {
    const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (isIP(h))
        return h;
    // IPv4-mapped IPv6
    const m = h.match(/^::ffff:(.+)$/);
    if (m && isIP(m[1]) === 4)
        return m[1];
    // decimal / hex single-integer IPv4 (e.g. 2130706433, 0x7f000001)
    if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) {
        const n = h.startsWith('0x') ? parseInt(h, 16) : Number(h);
        if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) {
            return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
        }
    }
    return null;
}
const PRIVATE_RANGES_V4 = [
    /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\.0\.0\.0$/, /^169\.254\./,
];
const PRIVATE_V6 = /^(::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i;
/** True when `host` is a literal private-range or loopback address/name. */
export function isPrivateOrLoopbackHost(host) {
    const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost'))
        return true;
    const ip = normalizeIp(h);
    if (ip) {
        if (isIP(ip) === 6)
            return PRIVATE_V6.test(ip);
        return PRIVATE_RANGES_V4.some(re => re.test(ip));
    }
    return false;
}
/**
 * True when every host is private/loopback (and there is at least one).
 *
 * Local sandbox mode skips ownership verification for a private target, so it may only
 * widen the prober to private hosts when the WHOLE scope is private: a loopback target
 * combined with a public scope host must not inherit the sandbox bypass.
 */
export function allHostsPrivateOrLoopback(hosts) {
    return hosts.length > 0 && hosts.every(h => isPrivateOrLoopbackHost(h));
}
/**
 * The prober's pre-flight target validation: scheme, link-local,
 * private/loopback, and exact scope membership, in that order — every
 * refusal lands before any packet is sent.
 */
export function validateProbeTarget(url, scopeHosts, opts = {}) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        return { ok: false, reason: `unparseable URL: ${url}` };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, reason: `scheme not allowed: ${u.protocol}` };
    }
    const host = u.hostname.toLowerCase();
    // Link-local literals (cloud metadata 169.254.169.254, fe80::/10) are
    // refused unconditionally — no allowance must ever open metadata.
    if (/^169\.254\.|^\[?fe[89ab][0-9a-f]:/i.test(host)) {
        return { ok: false, reason: `link-local host rejected (never allowed, incl. sandbox): ${host}` };
    }
    if (isPrivateOrLoopbackHost(host) && !opts.allowPrivateHosts && !opts.attestedHost?.(host)) {
        return { ok: false, reason: `private/loopback host rejected: ${host}` };
    }
    if (!scopeHosts.includes(host)) {
        return { ok: false, reason: `out of scope: ${host} (scope: ${scopeHosts.join(', ')})` };
    }
    return { ok: true };
}
//# sourceMappingURL=prober-address.js.map