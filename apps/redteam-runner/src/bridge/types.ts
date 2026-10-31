/**
 * Bridge client contracts: configuration fields, tool definitions, call
 * results, the registry snapshot record, and the typed error the client
 * raises.
 *
 * Design note (Carlos's order, 2026-10-31 ~18:00 CDT): there is NO allowlist.
 * The client exposes everything the bridge offers and forwards any call; the
 * bridge's own native consent dialog is the gate for destructive ops, not a
 * client-side name filter.
 *
 * The three error codes are the honest states a caller must be able to tell
 * apart: `unavailable` (no paired bridge reachable — a normal state, not a
 * failure), `bridge-error` (the bridge was reached and answered with an
 * error, or rejected the token), and `bridge-denied` (the bridge's own
 * consent dialog denied the call or timed out — the operator said no, which
 * is neither a transport failure nor a success).
 */

/** Discriminant for {@link BridgeError}. */
export type BridgeErrorCode = "unavailable" | "bridge-error" | "bridge-denied";

/** Error raised by the bridge client; `code` names which honest state failed. */
export class BridgeError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/** Resolved bridge configuration: where the bridge is and how calls behave. */
export interface BridgeConfig {
  /** Bridge base URL as configured (before the MCP path is applied). */
  readonly url: string;
  /** Full MCP endpoint the client POSTs to (`<url>/mcp` unless a path was given). */
  readonly endpoint: string;
  /** File the paired session token is read from. The token value never appears in config output or logs. */
  readonly tokenFile: string;
  /** Timeout for the availability probe's initialize, in milliseconds. */
  readonly probeTimeoutMs: number;
  /** Timeout for tools/list and tools/call requests, in milliseconds. */
  readonly callTimeoutMs: number;
}

/** One tool the bridge offers; the bridge's own schema passes through unchanged. */
export interface BridgeToolDef {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

/** A successful tools/call result: raw content items plus their concatenated text. */
export interface BridgeCallResult {
  /** The MCP result's content array, unmodified. */
  readonly content: unknown[];
  /** Text content items joined with newlines (the house result convention). */
  readonly text: string;
  /** The MCP result's structuredContent, when the bridge sent one. */
  readonly structuredContent?: unknown;
}

/**
 * A record of what the bridge offered at probe time. This is evidence for
 * verification (the supervisor compares it against the bridge's registry),
 * never a filter: the client does not consult it before calling.
 */
export interface BridgeRegistrySnapshot {
  /** ISO timestamp of the probe. */
  readonly probedAt: string;
  /** Endpoint that was probed. */
  readonly endpoint: string;
  /** Whether the bridge answered initialize at probe time. */
  readonly available: boolean;
  /** Every tool the bridge offered, sorted by name. Empty when unavailable. */
  readonly tools: readonly BridgeToolDef[];
  /** Tool names only, sorted — the compact form for comparisons. */
  readonly toolNames: readonly string[];
}

/** The surface Builder B wires into the fleet. */
export interface BridgeClient {
  /** The full MCP endpoint this client POSTs to. */
  readonly endpoint: string;
  /**
   * Whether a paired bridge answers initialize right now.
   * Never throws: unconfigured, unreachable, and rejected all read as false.
   */
  available(): Promise<boolean>;
  /**
   * Every tool the bridge offers, schemas passed through. No filtering.
   * @throws {BridgeError} `unavailable` when no bridge can be reached, `bridge-error` when it answers with an error.
   */
  listTools(): Promise<BridgeToolDef[]>;
  /**
   * Call any tool the bridge offers.
   * @param name - tool name, forwarded unchanged.
   * @param args - tool arguments, passed through unchanged.
   * @throws {BridgeError} `bridge-denied` when the bridge's consent dialog denies or times out; `unavailable` or `bridge-error` for the other failed states.
   */
  call(name: string, args?: Record<string, unknown>): Promise<BridgeCallResult>;
}
