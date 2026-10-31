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
/** Minimal WebSocket surface the transport needs, and that tests can fake. */
export interface SocketLike {
    send(data: string): void;
    close(): void;
    onopen: (() => void) | null;
    onclose: ((event: unknown) => void) | null;
    onmessage: ((event: {
        data: unknown;
    }) => void) | null;
    onerror: ((event: unknown) => void) | null;
}
/** Creates the socket for a given CDP URL. Overridable so tests need no network. */
export type SocketFactory = (url: string) => SocketLike;
/** Minimal fetch surface, so target resolution is testable without a browser. */
export interface CdpFetchLike {
    (url: string): Promise<{
        ok: boolean;
        status: number;
        json(): Promise<unknown>;
    }>;
}
export interface CdpTransport {
    send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export interface CdpConnection extends CdpTransport {
    /** Close the WebSocket. Idempotent. */
    close(): void;
}
export interface CdpConnectOptions {
    /** Resolve `/json/list`; defaults to global fetch. */
    fetchImpl?: CdpFetchLike;
    /** Create the WebSocket; defaults to the global WebSocket constructor. */
    socketFactory?: SocketFactory;
    /** Per-command deadline; defaults to 10 s. */
    timeoutMs?: number;
}
/**
 * Resolve the WebSocket URL for a DevTools endpoint.
 * An explicit `ws://`/`wss://` endpoint is used as-is; an HTTP endpoint is queried at
 * `/json/list` and the first page target wins.
 */
export declare function resolveCdpWebSocketUrl(endpoint: string, fetchImpl?: CdpFetchLike): Promise<string>;
/**
 * Connect to a browser's DevTools endpoint and enable the runtime/page domains.
 * @param endpoint - `http(s)://host:port` or a `ws(s)://` browser/page URL.
 * @param options - Injectable fetch/socket and the per-command deadline.
 * @returns A transport for `createCdpDriver`, plus `close()`.
 */
export declare function connectCdp(endpoint: string, options?: CdpConnectOptions): Promise<CdpConnection>;
