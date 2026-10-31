/**
 * Windows PC-agent host-exec backend — interface and client (v0.34.0).
 *
 * Why this exists: the Windows battery needs an execution channel, and our own
 * field run stalled because SMB / WinRM / SSH were all unavailable on the target
 * (WinRM closed, no test SMB credentials, RDP off). AlterEgo proved that a small
 * authenticated agent on the endpoint — speaking MCP Streamable HTTP — is a
 * workable channel for exactly that situation.
 *
 * What is here: the configuration gate, the closed tool allow-list, and a client
 * that performs the Streamable-HTTP handshake correctly — `initialize`, then
 * `notifications/initialized`, then `tools/call`, carrying the `Mcp-Session-Id`
 * the server returns. The session id is not optional: a server rejects subsequent
 * requests without it ("Missing session ID"), which an on-host smoke against a real
 * agent demonstrated.
 *
 * Deliberately NOT included: the approval dialog. An engagement cannot ask the
 * *target's* user for consent; authorisation comes from the engagement's own
 * sign-off and tier, and every call is recorded in the runner's event log.
 *
 * Verified against a real agent by `scripts/smoke-pc-agent.mjs` (AlterEgo's
 * pc-agent on loopback, paired through its 6-digit flow).
 */
export declare const PC_AGENT_ENV_URL = "REDTEAM_PC_AGENT_URL";
export declare const PC_AGENT_ENV_TOKEN = "REDTEAM_PC_AGENT_TOKEN";
/**
 * Observation ("eyes"): read-only perception of the host and its UI. Tier 0.
 * A bridge that implements only the robot tools can run commands but cannot see
 * a UI, which is why `screen_snapshot`/`ui_tree`/`state_hash` are first-class.
 */
export declare const PC_AGENT_OBSERVE_TOOLS: readonly ["system_info", "list_processes", "list_dir", "read_file", "screen_snapshot", "ui_windows", "ui_tree", "ui_describe", "ui_focused", "state_hash", "clipboard_get", "wait_idle", "wait_window"];
/** UI action ("hands"): safe interactions with the visible desktop. Tier 1. */
export declare const PC_AGENT_ACTION_TOOLS: readonly ["ui_invoke", "ui_set_value", "ui_toggle", "input_click", "input_type", "input_key", "input_scroll", "input_drag", "window_focus", "window_arrange", "window_close", "clipboard_set", "assert_element"];
/** Robot path: destructive or host-wide actions. Tier 2 - requires approval. */
export declare const PC_AGENT_ROBOT_TOOLS: readonly ["shell_exec", "shell_pwsh", "proc_kill", "fs_write", "fs_delete"];
/** Every tool this backend may call. Closed set, by design. */
export declare const PC_AGENT_ALLOWED_TOOLS: readonly ["system_info", "list_processes", "list_dir", "read_file", "screen_snapshot", "ui_windows", "ui_tree", "ui_describe", "ui_focused", "state_hash", "clipboard_get", "wait_idle", "wait_window", "ui_invoke", "ui_set_value", "ui_toggle", "input_click", "input_type", "input_key", "input_scroll", "input_drag", "window_focus", "window_arrange", "window_close", "clipboard_set", "assert_element", "shell_exec", "shell_pwsh", "proc_kill", "fs_write", "fs_delete"];
export type PcAgentTool = (typeof PC_AGENT_ALLOWED_TOOLS)[number];
/** Autonomy tier for one tool: 0 observe, 1 safe action, 2 destructive. */
export type PcAgentToolTier = 0 | 1 | 2;
/** The tier of one allow-listed tool; unknown names are treated as destructive. */
export declare function pcAgentToolTier(tool: string): PcAgentToolTier;
/** The action receipt a bridge returns with every call, when it implements one. */
export interface PcAgentReceipt {
    /** Tool the receipt describes. */
    readonly tool?: string;
    readonly ok?: boolean;
    /** True when the action changed the observed state; false is a failed step. */
    readonly changed?: boolean;
    readonly before?: PcAgentObservation;
    readonly after?: PcAgentObservation;
    /** Postcondition the caller asked the bridge to verify. */
    readonly assert?: {
        readonly kind?: string;
        readonly expected?: string;
        readonly pass?: boolean;
    };
    /** Structured failure; `code` is stable for callers (STALE_REF, NO_FOCUS, ...). */
    readonly error?: {
        readonly code?: string;
        readonly message?: string;
    };
}
/** One observation fingerprint: enough to tell whether the screen moved. */
export interface PcAgentObservation {
    readonly shotHash?: string;
    readonly treeHash?: string;
    readonly activeWindow?: string;
}
/** Text result plus the receipt, when the bridge returned one. */
export interface PcAgentToolResult {
    readonly text: string;
    readonly receipt?: PcAgentReceipt;
}
/**
 * Parse a receipt out of a tool result.
 *
 * A bridge may wrap it (`{ receipt: { ... } }`) or return it directly; a result
 * that is neither is simply text, so older bridges keep working unchanged.
 * @param text - the tool result text.
 * @returns the receipt, or undefined when the result is not a receipt.
 */
export declare function parsePcAgentReceipt(text: string): PcAgentReceipt | undefined;
export interface PcAgentConfig {
    url: string;
    token: string;
}
export interface PcAgentClient {
    /** Call one allow-listed tool and return its text result. */
    call(tool: PcAgentTool, args: Record<string, unknown>): Promise<string>;
    /** Call one allow-listed tool and return the text plus its receipt, when the bridge sent one. */
    callWithReceipt(tool: PcAgentTool, args: Record<string, unknown>): Promise<PcAgentToolResult>;
}
/** Response surface the client needs; a real fetch satisfies it structurally. */
export interface FetchLikeResponse {
    ok: boolean;
    status: number;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
}
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
}) => Promise<FetchLikeResponse>;
/** Read and validate configuration. Returns undefined when unconfigured or malformed. */
export declare function pcAgentConfig(env?: NodeJS.ProcessEnv): PcAgentConfig | undefined;
export declare function pcAgentConfigured(env?: NodeJS.ProcessEnv): boolean;
/**
 * Create a client bound to one configuration. Every call re-checks the allow-list
 * so a future caller cannot widen the surface by passing an arbitrary name.
 */
export declare function createPcAgentClient(cfg: PcAgentConfig, fetchImpl: FetchLike): PcAgentClient;
