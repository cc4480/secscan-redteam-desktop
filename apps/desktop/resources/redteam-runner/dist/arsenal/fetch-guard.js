/**
 * DestinationFilter-guarded fetcher — the arsenal module's ONLY network seam
 * (spec §6). Every outbound request from the ingest write path — README
 * fetches and every redirect hop — passes through {@link fetchTextChecked}.
 * No other file in `src/arsenal/` may import a network API (spec §12.12).
 *
 * Policy (spec §6.1, evaluated per request and per redirect hop):
 *   1. `https:` only; every other scheme is denied.
 *   2. No embedded URL credentials; no Authorization header is ever sent —
 *      only a descriptive User-Agent and `Accept: text/plain, text/markdown`.
 *   3. The host is resolved once; if ANY resulting address is loopback,
 *      private, link-local, unspecified, multicast, or otherwise
 *      non-global/reserved, the fetch is denied. The transport then connects
 *      to a PINNED address from that same checked answer (with the original
 *      host preserved for Host/SNI/certificate validation), so the address
 *      validated is the address used — no resolve-twice TOCTOU window.
 *   4. Redirects are followed manually, max 3 hops, each hop re-running the
 *      full policy. A redirect to a denied destination denies the whole fetch.
 *   5. Bounds: 15 s per request, 4 MiB body cap, text-ish content types only.
 *   6. Denials are data for the caller: typed errors, never a crash of the
 *      surrounding refresh (spec §6.1.6 is honored by `ingest.ts`, which
 *      records `{url, reason}` per collection and continues).
 *
 * The resolver and the transport are injected seams
 * (`fetchTextChecked(url, { resolve, transport })`) so tests never touch DNS
 * or the network. The defaults are the real DNS lookup and a `node:https`
 * transport whose `lookup` is pinned to the checked address.
 */
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
/** The destination itself is refused by policy. Recorded against the collection. */
export class DestinationDeniedError extends Error {
    code = 'DESTINATION_DENIED';
    /** The URL being fetched at the hop that was denied. */
    url;
    reason;
    /** Redirect hop at which the denial occurred (0 = the original URL). */
    hop;
    /** Specifics safe to log: the offending address/range, scheme, or size. */
    detail;
    constructor(url, reason, hop, detail) {
        super(`destination denied (${reason}) at hop ${hop}: ${url}` +
            (detail === undefined ? '' : ` — ${detail}`));
        this.name = 'DestinationDeniedError';
        this.url = url;
        this.reason = reason;
        this.hop = hop;
        this.detail = detail;
    }
}
/** The destination was allowed but the fetch itself failed operationally. */
export class FetchFailedError extends Error {
    code = 'FETCH_FAILED';
    url;
    reason;
    hop;
    /** HTTP status, when the failure is a non-success response status. */
    status;
    constructor(url, reason, hop, status, cause) {
        super(`fetch failed (${reason}) at hop ${hop}: ${url}` +
            (status === undefined ? '' : ` — HTTP ${status}`), cause === undefined ? undefined : { cause });
        this.name = 'FetchFailedError';
        this.url = url;
        this.reason = reason;
        this.hop = hop;
        this.status = status;
    }
}
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
/** Descriptive UA — the runner's MCP client learned the normal-UA lesson (src/mcp.ts). */
const FETCH_USER_AGENT = 'secscan-redteam-runner/0.4.0';
const FETCH_ACCEPT = 'text/plain, text/markdown';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/**
 * Fetch a public README over https, under the DestinationFilter policy.
 * The only network function the arsenal module exports (spec §6.2).
 *
 * @param url - the URL to fetch (first hop; redirects are followed manually).
 * @param opts - injected seams and bound overrides (tests inject both seams).
 * @returns the decoded body text, the final URL, and the redirect hop count.
 * @throws {DestinationDeniedError} when policy refuses any hop's destination.
 * @throws {FetchFailedError} when an allowed destination fails operationally.
 */
export async function fetchTextChecked(url, opts = {}) {
    const resolve = opts.resolve ?? defaultResolve;
    const transport = opts.transport ?? defaultTransport;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    let current = url;
    let hops = 0;
    for (;;) {
        const outcome = await fetchOneHop(current, hops, {
            resolve,
            transport,
            timeoutMs,
            maxBodyBytes,
        });
        if (outcome.kind === 'final') {
            return { text: outcome.text, finalUrl: current, hops };
        }
        if (hops >= maxRedirects) {
            throw new DestinationDeniedError(current, 'too-many-redirects', hops, `redirect #${hops + 1} exceeds the ${maxRedirects}-hop limit`);
        }
        hops += 1;
        current = outcome.location;
    }
}
async function fetchOneHop(urlString, hop, cfg) {
    let url;
    try {
        url = new URL(urlString);
    }
    catch {
        throw new DestinationDeniedError(urlString, 'invalid-url', hop);
    }
    if (url.protocol !== 'https:') {
        throw new DestinationDeniedError(urlString, 'scheme-not-https', hop, url.protocol);
    }
    if (url.username !== '' || url.password !== '') {
        throw new DestinationDeniedError(urlString, 'credentials-in-url', hop);
    }
    const hostname = stripBrackets(url.hostname);
    if (hostname === '') {
        throw new DestinationDeniedError(urlString, 'invalid-url', hop, 'empty host');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
        // Resolution: a literal IP host IS its own resolution — no DNS involved.
        let addresses;
        if (parseIpAddress(hostname) !== null) {
            addresses = [hostname];
        }
        else {
            try {
                addresses = await raceAbort(cfg.resolve(hostname), controller.signal, urlString, hop);
            }
            catch (error) {
                if (error instanceof FetchFailedError)
                    throw error;
                throw new FetchFailedError(urlString, 'dns-error', hop, undefined, error);
            }
        }
        if (addresses.length === 0) {
            throw new DestinationDeniedError(urlString, 'no-addresses', hop, hostname);
        }
        // Deny if ANY checked address is non-global; pin the first answer.
        let pinned;
        for (const raw of addresses) {
            const checked = parseIpAddress(raw.trim());
            if (checked === null) {
                throw new DestinationDeniedError(urlString, 'unparseable-address', hop, raw);
            }
            if (checked.blocked !== null) {
                throw new DestinationDeniedError(urlString, 'blocked-address', hop, `${raw} is ${checked.blocked}`);
            }
            pinned ??= checked;
        }
        // `pinned` is always set: addresses.length > 0 and the loop cannot
        // complete without assigning it (every iteration either throws or sets it).
        const target = pinned;
        let response;
        try {
            response = await raceAbort(cfg.transport({
                url: urlString,
                address: target.canonical,
                family: target.family,
                hostname,
                headers: {
                    'user-agent': FETCH_USER_AGENT,
                    accept: FETCH_ACCEPT,
                },
                signal: controller.signal,
            }), controller.signal, urlString, hop);
        }
        catch (error) {
            if (error instanceof FetchFailedError)
                throw error;
            if (controller.signal.aborted) {
                throw new FetchFailedError(urlString, 'timeout', hop, undefined, error);
            }
            throw new FetchFailedError(urlString, 'transport-error', hop, undefined, error);
        }
        if (REDIRECT_STATUSES.has(response.status)) {
            if (response.location === null || response.location === '') {
                throw new FetchFailedError(urlString, 'redirect-without-location', hop, response.status);
            }
            let next;
            try {
                next = new URL(response.location, url);
            }
            catch {
                throw new DestinationDeniedError(urlString, 'invalid-redirect', hop, response.location);
            }
            return { kind: 'redirect', location: next.href };
        }
        if (response.status < 200 || response.status > 299) {
            throw new FetchFailedError(urlString, 'http-status', hop, response.status);
        }
        const contentType = (response.contentType ?? '').split(';')[0].trim().toLowerCase();
        if (!(contentType.startsWith('text/') || contentType === 'application/octet-stream')) {
            throw new DestinationDeniedError(urlString, 'content-type-not-text', hop, contentType === '' ? '(missing)' : contentType);
        }
        const chunks = [];
        let total = 0;
        const iterator = response.body[Symbol.asyncIterator]();
        for (;;) {
            let step;
            try {
                step = await raceAbort(iterator.next(), controller.signal, urlString, hop);
            }
            catch (error) {
                if (error instanceof FetchFailedError)
                    throw error;
                throw new FetchFailedError(urlString, 'body-read-error', hop, undefined, error);
            }
            if (step.done)
                break;
            total += step.value.byteLength;
            if (total > cfg.maxBodyBytes) {
                controller.abort();
                throw new DestinationDeniedError(urlString, 'body-too-large', hop, `exceeds ${cfg.maxBodyBytes} bytes`);
            }
            chunks.push(Buffer.from(step.value));
        }
        return { kind: 'final', text: Buffer.concat(chunks).toString('utf8') };
    }
    finally {
        clearTimeout(timer);
    }
}
/** Reject `promise` with a timeout FetchFailedError as soon as `signal` aborts. */
async function raceAbort(promise, signal, url, hop) {
    if (signal.aborted) {
        throw new FetchFailedError(url, 'timeout', hop);
    }
    let onAbort;
    const abortPromise = new Promise((_resolve, reject) => {
        onAbort = () => reject(new FetchFailedError(url, 'timeout', hop));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([promise, abortPromise]);
    }
    finally {
        if (onAbort !== undefined)
            signal.removeEventListener('abort', onAbort);
    }
}
function stripBrackets(hostname) {
    return hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
}
function parseIpAddress(raw) {
    const v4 = parseIPv4(raw);
    if (v4 !== null) {
        return { family: 4, canonical: v4.join('.'), blocked: classifyIPv4(v4) };
    }
    const v6 = parseIPv6(raw);
    if (v6 !== null) {
        return { family: 6, canonical: raw.toLowerCase(), blocked: classifyIPv6(v6) };
    }
    return null;
}
/** Strict dotted-quad: decimal octets, no leading zeros (octal ambiguity). */
function parseIPv4(raw) {
    const parts = raw.split('.');
    if (parts.length !== 4)
        return null;
    const octets = [];
    for (const part of parts) {
        if (!/^(0|[1-9][0-9]{0,2})$/.test(part))
            return null;
        const value = Number(part);
        if (value > 255)
            return null;
        octets.push(value);
    }
    return [octets[0], octets[1], octets[2], octets[3]];
}
/** Full IPv6 parser: `::` compression at most once, optional trailing embedded IPv4. */
function parseIPv6(raw) {
    if (raw === '' || raw.includes('%'))
        return null; // zone ids are never acceptable
    let input = raw;
    if (input.includes('.')) {
        // Embedded dotted-quad in the low 32 bits: rewrite it as two hex groups.
        const lastColon = input.lastIndexOf(':');
        if (lastColon < 0)
            return null;
        const embedded = parseIPv4(input.slice(lastColon + 1));
        if (embedded === null)
            return null;
        const hi = ((embedded[0] << 8) | embedded[1]).toString(16);
        const lo = ((embedded[2] << 8) | embedded[3]).toString(16);
        input = `${input.slice(0, lastColon)}:${hi}:${lo}`;
    }
    return parseIPv6Groups(input);
}
function parseIPv6Groups(input) {
    const halves = input.split('::');
    if (halves.length > 2)
        return null;
    const parseSide = (side) => {
        if (side === '')
            return [];
        const groups = [];
        for (const part of side.split(':')) {
            if (!/^[0-9a-fA-F]{1,4}$/.test(part))
                return null;
            groups.push(parseInt(part, 16));
        }
        return groups;
    };
    const left = parseSide(halves[0]);
    if (left === null)
        return null;
    if (halves.length === 1) {
        return left.length === 8 ? left : null;
    }
    const right = parseSide(halves[1]);
    if (right === null)
        return null;
    const missing = 8 - left.length - right.length;
    if (missing < 1)
        return null; // "::" must compress at least one group
    return [...left, ...new Array(missing).fill(0), ...right];
}
function classifyIPv4([a, b, c]) {
    if (a === 0)
        return 'unspecified (0.0.0.0/8)';
    if (a === 10)
        return 'private (10.0.0.0/8)';
    if (a === 100 && b >= 64 && b <= 127)
        return 'shared address space (100.64.0.0/10)';
    if (a === 127)
        return 'loopback (127.0.0.0/8)';
    if (a === 169 && b === 254)
        return 'link-local (169.254.0.0/16)';
    if (a === 172 && b >= 16 && b <= 31)
        return 'private (172.16.0.0/12)';
    if (a === 192 && b === 0 && c === 0)
        return 'reserved (192.0.0.0/24)';
    if (a === 192 && b === 0 && c === 2)
        return 'documentation (192.0.2.0/24)';
    if (a === 192 && b === 88 && c === 99)
        return 'reserved (192.88.99.0/24)';
    if (a === 192 && b === 168)
        return 'private (192.168.0.0/16)';
    if (a === 198 && (b === 18 || b === 19))
        return 'benchmarking (198.18.0.0/15)';
    if (a === 198 && b === 51 && c === 100)
        return 'documentation (198.51.100.0/24)';
    if (a === 203 && b === 0 && c === 113)
        return 'documentation (203.0.113.0/24)';
    if (a >= 224 && a <= 239)
        return 'multicast (224.0.0.0/4)';
    if (a >= 240)
        return 'reserved (240.0.0.0/4)';
    return null;
}
function classifyIPv6(h) {
    const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0) {
        if (h7 === 0)
            return 'unspecified (::/128)';
        if (h7 === 1)
            return 'loopback (::1/128)';
    }
    // IPv4-embedded forms are judged by the address they actually reach.
    const embeddedBlocked = () => classifyIPv4([
        (h6 >> 8) & 0xff,
        h6 & 0xff,
        (h7 >> 8) & 0xff,
        h7 & 0xff,
    ]);
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0) {
        if (h5 === 0xffff) {
            // ::ffff:0:0/96 — IPv4-mapped.
            return embeddedBlocked();
        }
        if (h5 === 0) {
            // ::/96 — deprecated IPv4-compatible (covers :: and ::1 as embedded v4).
            return embeddedBlocked();
        }
    }
    if (h0 === 0x0064 && h1 === 0xff9b) {
        if (h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
            // 64:ff9b::/96 — NAT64 well-known prefix; judge the embedded IPv4.
            return embeddedBlocked();
        }
        return 'reserved (64:ff9b:1::/48 NAT64 local-use)';
    }
    if ((h0 & 0xfe00) === 0xfc00)
        return 'private (fc00::/7)';
    if ((h0 & 0xffc0) === 0xfe80)
        return 'link-local (fe80::/10)';
    if ((h0 & 0xffc0) === 0xfec0)
        return 'reserved (fec0::/10 site-local, deprecated)';
    if ((h0 & 0xff00) === 0xff00)
        return 'multicast (ff00::/8)';
    if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) {
        return 'reserved (100::/64 discard-only)';
    }
    if (h0 === 0x2001 && h1 === 0x0000)
        return 'reserved (2001::/32 Teredo)';
    if (h0 === 0x2001 && h1 === 0x0002)
        return 'benchmarking (2001:2::/48)';
    if (h0 === 0x2001 && h1 === 0x0db8)
        return 'documentation (2001:db8::/32)';
    if (h0 === 0x2001 && (h1 & 0xfff0) === 0x0010)
        return 'reserved (2001:10::/28 ORCHID)';
    if (h0 === 0x2002)
        return 'reserved (2002::/16 6to4)';
    // Backstop: global unicast is 2000::/3. Anything outside it that was not
    // already judged above (embedded forms, ULA, link-local, multicast) is
    // IETF-reserved or unallocated — not a public destination.
    if ((h0 & 0xe000) !== 0x2000)
        return 'reserved (outside 2000::/3 global unicast)';
    return null;
}
/* ------------------------------------------------------------------ */
/* Default seams — the real network. Tests always inject stubs.        */
/* ------------------------------------------------------------------ */
const defaultResolve = async (hostname) => {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.map(answer => answer.address);
};
const defaultTransport = req => new Promise((resolvePromise, reject) => {
    const url = new URL(req.url);
    const request = httpsRequest({
        protocol: 'https:',
        hostname: req.hostname,
        port: url.port === '' ? 443 : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { ...req.headers },
        // SNI + certificate validation run against the original hostname;
        // an IP-literal host has no SNI name to send.
        servername: req.hostname.includes(':') || /^[0-9.]+$/.test(req.hostname)
            ? undefined
            : req.hostname,
        // The pin: DNS inside the transport is replaced by the one address
        // the guard already resolved and checked. The address validated is
        // the address connected — there is no second resolution to race.
        lookup: ((_hostname, options, callback) => {
            const cb = callback;
            if (options !== null &&
                typeof options === 'object' &&
                options.all === true) {
                cb(null, [{ address: req.address, family: req.family }]);
            }
            else {
                cb(null, req.address, req.family);
            }
        }),
        signal: req.signal,
    }, (res) => {
        resolvePromise({
            status: res.statusCode ?? 0,
            contentType: res.headers['content-type'] ?? null,
            location: res.headers.location ?? null,
            body: res,
        });
    });
    request.on('error', reject);
    request.end();
});
//# sourceMappingURL=fetch-guard.js.map