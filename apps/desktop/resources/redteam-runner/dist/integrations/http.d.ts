/**
 * INTEGRATIONS — tiny injectable HTTP layer (v0.15.0).
 *
 * All integration traffic goes through this: global fetch by default,
 * a fake in tests. 15s timeout, abortable, and the response helper
 * surfaces non-2xx as typed errors (never throws raw bodies at callers).
 */
export type HttpFn = (url: string, init: RequestInit) => Promise<Response>;
export declare class IntegrationHttpError extends Error {
    readonly status: number;
    readonly body: string;
    constructor(message: string, status: number, body: string);
}
export declare function defaultHttp(): HttpFn;
/** POST/PUT JSON; throws IntegrationHttpError on non-2xx. Never logs bodies. */
export declare function requestJson(http: HttpFn, method: "POST" | "PUT" | "PATCH" | "GET", url: string, headers: Record<string, string>, body?: unknown): Promise<unknown>;
export declare function basicAuth(user: string, secret: string): string;
