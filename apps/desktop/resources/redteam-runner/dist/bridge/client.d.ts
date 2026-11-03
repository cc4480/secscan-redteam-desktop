/**
 * AlterEgo bridge client — MCP Streamable HTTP against the operator's own PC.
 *
 * The handshake follows the pattern the runner's pc-agent channel proved
 * against the real bridge: `initialize`, then `notifications/initialized`,
 * then the request, carrying the `Mcp-Session-Id` the server issues (a server
 * rejects later requests without it). Replies may be plain JSON or SSE; both
 * are parsed.
 *
 * There is deliberately no client-side tool filtering (Carlos's order,
 * 2026-10-31): tools/list returns everything the bridge offers and tools/call
 * forwards any name. Destructive ops are gated by the bridge's own native
 * consent dialog; a denial or dialog timeout surfaces here as a distinct
 * `bridge-denied` error, never as a hang or a fake success.
 */
import { type BridgeConfigOverrides } from './config.js';
import { type BridgeClient } from './types.js';
/** Options for {@link createBridgeClient}: config overrides plus a transport seam for tests. */
export interface BridgeClientOptions extends BridgeConfigOverrides {
    /** Environment to resolve config from; defaults to process.env. */
    readonly env?: NodeJS.ProcessEnv;
    /** Fetch implementation; defaults to the global fetch. */
    readonly fetchImpl?: typeof fetch;
}
/**
 * Create a bridge client. Configuration resolves once; the session token is
 * re-read from its file on every operation, so a re-pairing takes effect
 * without recreating the client.
 * @param options - config overrides and seams.
 * @returns the client.
 */
export declare function createBridgeClient(options?: BridgeClientOptions): BridgeClient;
