/**
 * Tiny HTTP helpers for the UI API (v0.22.0).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export declare function json(res: ServerResponse, status: number, value: unknown): void;
export declare function badRequest(res: ServerResponse, message: string): void;
export declare function notFound(res: ServerResponse): void;
/** Read a JSON body with a 1MB cap. Rejects on bad JSON or overflow. */
export declare function readJsonBody(req: IncomingMessage): Promise<unknown>;
