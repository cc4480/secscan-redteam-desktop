/**
 * MCP tool surface for the RedTeam console (v0.29.0).
 *
 * Each tool delegates to the SAME route handler the console UI calls, so the
 * safety core, launch validation, tier rules and approval logging all apply
 * unchanged. This file adds reach, not authority.
 *
 * The handlers write to a ServerResponse, so `capture()` stands in for one and
 * collects what they wrote — that is the entire adapter, and it is why no
 * existing handler had to change.
 */
import type { ServerResponse } from "node:http";
import { type UiStore } from "./store.js";
/** What a handler produced, instead of writing it to a socket. */
export interface Captured {
    status: number;
    body: unknown;
}
/** Stand in for ServerResponse. Handlers only ever call writeHead and end. */
export declare function capture(): {
    res: ServerResponse;
    result: () => Captured;
};
export interface ToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    run: (store: UiStore, args: Record<string, unknown>) => Promise<Captured>;
}
/**
 * The full cockpit surface: the CLI-shaped tools above plus the
 * chat-shaped engagement trio (engagement-tools.ts). One list, so the
 * console chat and the desktop host's chat — both fed by mcp-endpoint.ts —
 * see the same registry.
 */
export declare const TOOLS: ToolDef[];
export declare const TOOLS_BY_NAME: Map<string, ToolDef>;
