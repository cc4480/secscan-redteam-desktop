/**
 * MCP server face for the RedTeam console (v0.29.0) — JSON-RPC transport.
 *
 * Why this exists: the runner was an MCP CLIENT only (see ../mcp.ts — it calls
 * SecScan's server). Nothing in the product offered an MCP SERVER, so a harness
 * like DeepSeek Harness had nothing to snap onto. This is that face: POST /mcp
 * on the console server, exposing the console's existing routes as MCP tools so
 * an external agent can drive and supervise an engagement.
 *
 * Stateless Streamable HTTP with JSON responses (no SSE) — the same shape the
 * runner's own McpClient and dsh-mcp-client both accept.
 *
 * Security: every tool delegates to the same handler the console UI calls, so
 * the safety core, launch validation, tier rules and approval logging apply
 * unchanged. This endpoint adds reach, not authority. Auth is the console
 * token, checked here because a JSON-RPC caller must receive a 401 it can
 * parse rather than the HTML login page the generic gate would serve.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { UiStore } from "./store.js";
/** POST /mcp — one JSON-RPC message per request, stateless. */
export declare function handleMcp(store: UiStore, token: string, reqIn: IncomingMessage, res: ServerResponse): Promise<void>;
