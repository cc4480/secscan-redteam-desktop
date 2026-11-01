import net from "node:net";
import { guardedFetch, firstBlockedAddress } from "./ssrf.js";
// Every headless-browser network request is proxied through guardedFetch, so
// Chromium never opens a connection of its own. A hostname-only check is not
// enough in a browser: `169.254.169.254.nip.io`, an attacker's A record
// pointing at 10.x, or a DNS-rebinding answer all pass a string test, and
// Playwright's route handler does not see redirect hops. guardedFetch resolves
// DNS itself and refuses any internal address at connect time (the same
// dispatcher the rest of the scanner uses).
//
// Redirects are followed HERE, every hop re-validated, and only the final
// response goes to the browser. Handing a 3xx back does not work: Chromium
// follows a fulfilled redirect itself, without passing the next hop back
// through the route handler, so the hop went out unchecked.
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
// Hop-by-hop and length headers: undici sets these itself, and forwarding a
// stale value would corrupt the proxied exchange.
const DROP_REQUEST_HEADERS = new Set([
    "host", "connection", "content-length", "transfer-encoding", "keep-alive",
    "upgrade", "proxy-connection", "proxy-authorization", "te", "trailer",
]);
// fetch() already decoded the body, so the original encoding/length no longer
// describe what we hand back to the browser.
const DROP_RESPONSE_HEADERS = new Set([
    "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive",
]);
// Performs one browser request through the SSRF-safe fetch. Returns null when
// the request must be aborted (non-http scheme, blocked address, network
// error, oversized body). Exported for tests.
export async function fetchForBrowser(req, fetchImpl = guardedFetch) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
        const key = k.toLowerCase();
        if (key.startsWith(":") || DROP_REQUEST_HEADERS.has(key))
            continue;
        headers[key] = v;
    }
    try {
        let url = req.url;
        let method = req.method.toUpperCase();
        let reqBody = method === "GET" || method === "HEAD" ? undefined : req.body ?? undefined;
        let res;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            if (!hopAllowed(url))
                return null;
            res = await fetchImpl(url, { method, headers, body: reqBody, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
            if (!loc)
                break;
            if (hop === MAX_REDIRECTS)
                return null;
            url = new URL(loc, url).toString();
            // Browser semantics: 303, and 301/302 after a POST, continue as GET.
            if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
                method = "GET";
                reqBody = undefined;
                delete headers["content-type"];
            }
            await res.body?.cancel().catch(() => { });
        }
        if (!res)
            return null;
        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
            return null;
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length > MAX_BODY_BYTES)
            return null;
        const out = {};
        res.headers.forEach((value, key) => {
            if (!DROP_RESPONSE_HEADERS.has(key) && key !== "set-cookie")
                out[key] = value;
        });
        // Playwright takes multiple Set-Cookie values newline-separated.
        const cookies = res.headers.getSetCookie?.() ?? [];
        if (cookies.length)
            out["set-cookie"] = cookies.join("\n");
        return { status: res.status, headers: out, body };
    }
    catch {
        return null;
    }
}
// Scheme + IP-literal check for one hop. guardedFetch validates addresses inside
// its DNS lookup, and an IP literal never goes through a lookup — so without
// this a redirect to http://169.254.169.254/ (or any internal IP) connected.
function hopAllowed(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:")
        return false;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    return !(net.isIP(host) && firstBlockedAddress(host, [host]));
}
// Installs the proxy on a Playwright page. Callers should also create the
// context with serviceWorkers: "block" — service-worker traffic bypasses
// page.route. WebSockets are refused outright; no scanner feature needs them.
export async function installEgressGuard(page) {
    await page.route("**/*", async (route) => {
        const r = route.request();
        let headers = {};
        try {
            headers = await r.allHeaders();
        }
        catch {
            headers = r.headers();
        }
        const res = await fetchForBrowser({
            url: r.url(),
            method: r.method(),
            headers,
            body: r.postDataBuffer(),
        });
        if (!res)
            return route.abort().catch(() => { });
        return route.fulfill(res).catch(() => { });
    });
    if (typeof page.routeWebSocket === "function") {
        await page.routeWebSocket(/.*/, (ws) => ws.close());
    }
}
