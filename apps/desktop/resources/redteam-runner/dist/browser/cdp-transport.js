/**
 * Chrome DevTools Protocol transport (v0.34.0).
 *
 * The browser driver contract in `cdp.ts` takes an injected transport; this module
 * supplies the real one. It resolves a debuggable page from a DevTools HTTP endpoint
 * (`/json/list`), opens the page's WebSocket, and turns the JSON-RPC framing into the
 * `send(method, params)` call the driver expects.
 *
 * Why the transport lives apart from the driver: the driver owns *what* the runner may
 * do (navigate, read the page, fill a labeled field) and is unit-tested; the transport
 * owns *how* bytes travel and is exercised by the on-host smoke (`scripts/smoke-cdp.mjs`)
 * against a real browser. That split is what turned the browser backend from a design
 * document into something that can be verified and, later, replaced (e.g. by a remote
 * browser) without touching the driver.
 *
 * The Node runtime provides a global WebSocket (Node >= 22); the constructor is read off
 * `globalThis` so the module also type-checks where the WebSocket global is not declared.
 */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Default socket factory over the runtime's global WebSocket. */
function globalSocketFactory() {
    const ctor = globalThis.WebSocket;
    if (ctor === undefined)
        throw new Error("CDP: this Node runtime has no global WebSocket");
    return (url) => new ctor(url);
}
/** Default fetch over the runtime's global fetch. */
function globalFetch() {
    return async (url) => {
        const response = await fetch(url);
        return { ok: response.ok, status: response.status, json: () => response.json() };
    };
}
/**
 * Resolve the WebSocket URL for a DevTools endpoint.
 * An explicit `ws://`/`wss://` endpoint is used as-is; an HTTP endpoint is queried at
 * `/json/list` and the first page target wins.
 */
export async function resolveCdpWebSocketUrl(endpoint, fetchImpl = globalFetch()) {
    const trimmed = endpoint.trim();
    if (/^wss?:\/\//i.test(trimmed))
        return trimmed;
    const base = trimmed.replace(/\/+$/, "");
    let payload;
    try {
        const response = await fetchImpl(`${base}/json/list`);
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        payload = await response.json();
    }
    catch (error) {
        throw new Error(`CDP: cannot list targets at ${base}/json/list (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!Array.isArray(payload))
        throw new Error(`CDP: ${base}/json/list did not return a target list`);
    const targets = payload;
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ?? targets.find((t) => t.webSocketDebuggerUrl);
    if (page?.webSocketDebuggerUrl === undefined)
        throw new Error(`CDP: ${base}/json/list listed no debuggable page`);
    return page.webSocketDebuggerUrl;
}
/**
 * Connect to a browser's DevTools endpoint and enable the runtime/page domains.
 * @param endpoint - `http(s)://host:port` or a `ws(s)://` browser/page URL.
 * @param options - Injectable fetch/socket and the per-command deadline.
 * @returns A transport for `createCdpDriver`, plus `close()`.
 */
export async function connectCdp(endpoint, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const socketFactory = options.socketFactory ?? globalSocketFactory();
    const wsUrl = await resolveCdpWebSocketUrl(endpoint, options.fetchImpl);
    const socket = socketFactory(wsUrl);
    const pending = new Map();
    let nextId = 1;
    // The runtime's WebSocket (undici) throws "Sent before connected" if a frame is
    // written before the handshake completes, so the connection is established first.
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`CDP: socket did not open within ${String(timeoutMs)}ms`));
        }, timeoutMs);
        socket.onopen = () => { clearTimeout(timer); resolve(); };
        socket.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`CDP: socket failed to open ${wsUrl}`));
        };
        socket.onclose = () => {
            clearTimeout(timer);
            reject(new Error("CDP: socket closed before the handshake completed"));
        };
    });
    const failAll = (error) => {
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        pending.clear();
    };
    socket.onmessage = (event) => {
        let message;
        try {
            const text = typeof event.data === "string" ? event.data : String(event.data);
            message = JSON.parse(text);
        }
        catch {
            return; // a non-JSON frame is not part of the CDP protocol
        }
        if (typeof message.id !== "number")
            return; // an unsolicited event
        const entry = pending.get(message.id);
        if (entry === undefined)
            return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error !== undefined)
            entry.reject(new Error(`CDP: ${message.error.message ?? "command failed"}`));
        else
            entry.resolve((message.result ?? {}));
    };
    socket.onerror = () => { failAll(new Error(`CDP: socket error talking to ${wsUrl}`)); };
    socket.onclose = () => { failAll(new Error("CDP: socket closed")); };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP: ${method} timed out after ${String(timeoutMs)}ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
    let closed = false;
    const connection = {
        send,
        close: () => {
            if (closed)
                return;
            closed = true;
            failAll(new Error("CDP: connection closed"));
            socket.close();
        },
    };
    try {
        await send("Runtime.enable");
        await send("Page.enable");
    }
    catch (error) {
        connection.close();
        throw error;
    }
    return connection;
}
//# sourceMappingURL=cdp-transport.js.map