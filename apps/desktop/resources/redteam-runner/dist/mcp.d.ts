/**
 * Legacy MCP client placeholder.
 *
 * External SecScan MCP scanning/verification was removed; the runner uses
 * in-process engines and local domain verification. This class remains as a
 * compatibility stub for context wiring and tests that inject their own client.
 */
export interface McpConfig {
    endpoint?: string;
    token?: string;
    timeoutMs?: number;
}
export declare class McpClient {
    constructor(_cfg?: McpConfig);
    private unavailable;
    callTool(name: string, _args?: Record<string, unknown>): Promise<string>;
    listVerifiedDomains(): Promise<string>;
    startDomainVerification(domain: string): Promise<string>;
    checkDomainVerification(domain: string): Promise<string>;
}
