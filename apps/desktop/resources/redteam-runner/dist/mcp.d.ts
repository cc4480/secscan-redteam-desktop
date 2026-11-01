/**
 * Minimal SecScan MCP client (Streamable HTTP, stateless).
 *
 * Dependency-free — global fetch only. A normal User-Agent is set because the
 * edge WAF blocks default library user-agents (observed: Python-urllib 403s).
 */
export interface McpConfig {
    endpoint: string;
    token: string;
    timeoutMs?: number;
}
export declare class McpClient {
    private readonly endpoint;
    private readonly token;
    private readonly timeoutMs;
    constructor(cfg: McpConfig);
    private post;
    private unwrap;
    /** Call any MCP tool by name; returns the concatenated text content. Throws on isError. */
    callTool(name: string, args?: Record<string, unknown>): Promise<string>;
    listVerifiedDomains(): Promise<string>;
    startDomainVerification(domain: string): Promise<string>;
    checkDomainVerification(domain: string): Promise<string>;
}
