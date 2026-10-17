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
/** The only tools this backend may call. Closed set, by design. */
export declare const PC_AGENT_ALLOWED_TOOLS: readonly ["system_info", "list_processes", "list_dir", "read_file", "shell_exec", "shell_pwsh"];
export type PcAgentTool = (typeof PC_AGENT_ALLOWED_TOOLS)[number];
export interface PcAgentConfig {
    url: string;
    token: string;
}
export interface PcAgentClient {
    /** Call one allow-listed tool and return its text result. */
    call(tool: PcAgentTool, args: Record<string, unknown>): Promise<string>;
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
