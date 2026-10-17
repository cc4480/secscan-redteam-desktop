/**
 * Windows PC-agent host-exec backend — INTERFACE CONTRACT (v0.34.0).
 *
 * Why this exists: the Windows battery needs an execution channel, and our own
 * field run stalled because SMB / WinRM / SSH were all unavailable on the target
 * (WinRM closed, no test SMB credentials, RDP off). AlterEgo proved that a small
 * authenticated agent on the endpoint — speaking MCP Streamable HTTP — is a
 * workable channel for exactly that situation.
 *
 * What is here is the CONTRACT, not a shipped transport:
 *   - configuration is explicit and opt-in (two env vars, nothing implicit)
 *   - the tool allow-list is a closed set, so this backend can never become a
 *     generic shell
 *   - calls are typed and return text; the caller owns auditing
 *
 * Deliberately NOT included: the approval dialog. An engagement cannot ask the
 * *target's* user for consent; authorisation comes from the engagement's own
 * sign-off and tier, and every call is recorded in the runner's event log.
 *
 * Execution against a real agent has not been verified headless — that half of
 * AlterEgo's design needs an on-host smoke test before it is trusted.
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
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
}) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>;
/** Read and validate configuration. Returns undefined when unconfigured or malformed. */
export declare function pcAgentConfig(env?: NodeJS.ProcessEnv): PcAgentConfig | undefined;
export declare function pcAgentConfigured(env?: NodeJS.ProcessEnv): boolean;
/**
 * Create a client bound to one configuration. Every call re-checks the allow-list
 * so a future caller cannot widen the surface by passing an arbitrary name.
 */
export declare function createPcAgentClient(cfg: PcAgentConfig, fetchImpl: FetchLike): PcAgentClient;
