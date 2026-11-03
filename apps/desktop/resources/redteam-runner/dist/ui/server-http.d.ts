/**
 * UI HTTP primitives — extracted from server.ts to keep the server module under
 * the 300-line budget: static serving, the login page, and the guarded body
 * reader. Routing stays in server.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export declare const HERE: string;
export declare const MIME: Record<string, string>;
export declare function servePublic(res: ServerResponse, name: string): void;
export declare function loginPage(): string;
/** Sentinel returned by readBodyOrReject when it has already answered. */
export declare const BODY_REJECTED: unique symbol;
/**
 * Read a JSON request body for a route that requires one. A malformed or
 * oversized body is the caller's error, not the server's: answer 400 (413
 * when the body exceeds the reader's cap) and return BODY_REJECTED so the
 * route stops there instead of surfacing the failure as a 500.
 */
export declare function readBodyOrReject(req: IncomingMessage, res: ServerResponse): Promise<unknown>;
