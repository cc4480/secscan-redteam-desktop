/**
 * Route paths and wire payloads shared verbatim by the host share routes and
 * the browser package (`@deepseek-ai/dsh-client-ui-redteam-console`),
 * published as the `./shared` subpath. Browser-safe: constants and types
 * only. Each route carries the absolute pathname the Host registers beside
 * the document-relative form the browser addresses.
 */

/**
 * Prefix route path carrying the whole share surface: the console `/api`
 * proxy lives under it (`<prefix>/api/...`) and the Arsenal bridge beside it
 * (`<prefix>/arsenal`).
 */
export const CONSOLE_SHARE_PREFIX_PATH = '/redteam-console'

/** Browser-relative form of {@link CONSOLE_SHARE_PREFIX_PATH}. */
export const CONSOLE_SHARE_PREFIX_ROUTE = CONSOLE_SHARE_PREFIX_PATH.slice(1)

/** POST route path bridging the console's read-only Arsenal MCP tools. */
export const CONSOLE_SHARE_ARSENAL_PATH = '/redteam-console/arsenal'

/** Browser-relative form of {@link CONSOLE_SHARE_ARSENAL_PATH}. */
export const CONSOLE_SHARE_ARSENAL_ROUTE = CONSOLE_SHARE_ARSENAL_PATH.slice(1)

/**
 * The only MCP tools the Arsenal bridge forwards. The console's `/mcp`
 * endpoint also carries engagement-driving and executor tools; those stay
 * model-facing and are never reachable from the browser through this bridge.
 */
export const ARSENAL_TOOL_NAMES = ['arsenal_search', 'arsenal_browse', 'arsenal_recommend'] as const

/** One forwardable Arsenal tool name. */
export type ArsenalToolName = typeof ARSENAL_TOOL_NAMES[number]

/** Arsenal bridge request body: one allowlisted tool plus its arguments. */
export interface ConsoleShareArsenalPayload {
  /** Tool name; must be one of {@link ARSENAL_TOOL_NAMES}. */
  readonly tool: string
  /** Tool arguments, forwarded verbatim as the JSON-RPC `arguments`. */
  readonly arguments?: Record<string, unknown>
}

/** Error payload every share route answers with on a refused or failed call. */
export interface ConsoleShareErrorPayload {
  /** Stable machine-readable failure code. */
  readonly code: string
  /** Human-readable failure detail. */
  readonly message: string
}
