/**
 * Live operation feed (v0.22.0): Server-Sent Events over events.jsonl.
 *
 * GET /api/engagements/:id/events — tails the engagement's events.jsonl
 * (readEvents after `after` seq) and follows it until the engagement
 * reaches a terminal status. The dashboard reconnects with ?after=<lastSeq>
 * if the stream drops.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { UiStore } from "../store.js";
/** GET /api/engagements/:id/events — SSE stream. */
export declare function handleFeed(store: UiStore, req: IncomingMessage, res: ServerResponse, id: string, query: URLSearchParams): void;
