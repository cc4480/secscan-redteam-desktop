/**
 * msfrpc wire protocol — MessagePack over HTTP(S), injectable transport.
 *
 * Metasploit Framework's RPC daemon (msfrpcd) speaks a simple protocol:
 * POST a MessagePack-encoded array [method, token, ...args] to /api/ and
 * read back a MessagePack-encoded map. The transport is a function so tests
 * run against a fake (no Metasploit needed) and production uses fetch.
 *
 * Reference: Metasploit Framework msfrpc (external service, not vendored).
 */
export declare const MSFRPC_DEFAULT_HOST = "127.0.0.1";
export declare const MSFRPC_DEFAULT_PORT = 55553;
export declare const MSFRPC_DEFAULT_TLS = true;
/** Raw request function: POST body → response body. Injectable for tests. */
export type MsfRequestFn = (body: Uint8Array) => Promise<Uint8Array>;
export declare class MsfTransportError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * One msfrpc call. Throws MsfTransportError when the daemon is unreachable
 * or the response is not MessagePack at all — both fail closed upstream.
 *
 * The response may legitimately be a MAP (`core.version`, `auth.login`,
 * `module.exploits`) or an ARRAY: `module.search` returns a bare array of
 * module records, not `{modules:[…]}`. Demanding a map here made every
 * module search throw "non-map response" against a real daemon, so the
 * caller decides which shape it expects.
 */
export declare function msfCall(request: MsfRequestFn, method: string, token: string | null, args: unknown[]): Promise<Record<string, unknown> | unknown[]>;
export interface MsfHttpOptions {
    host: string;
    port: number;
    useTls: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
}
/**
 * Production transport: HTTPS (or HTTP when explicitly configured) POST to
 * /api/ with a timeout. msfrpcd ships self-signed by default — the runner
 * connects to the OPERATOR's OWN daemon (usually 127.0.0.1), so we do not
 * do public-CA validation here; the credential (user/pass) is the auth.
 */
export declare function createHttpMsfRequest(opts: MsfHttpOptions): MsfRequestFn;
