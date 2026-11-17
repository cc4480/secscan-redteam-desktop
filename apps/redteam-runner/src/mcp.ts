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

export class McpClient {
  constructor(_cfg: McpConfig = {}) {}

  private unavailable(name: string): never {
    throw new Error(
      `[mcp] ${name} is unavailable: external SecScan MCP is not configured in this build.`,
    );
  }

  async callTool(name: string, _args: Record<string, unknown> = {}): Promise<string> {
    return this.unavailable(name);
  }

  listVerifiedDomains(): Promise<string> {
    return this.callTool("list_verified_domains", {});
  }

  startDomainVerification(domain: string): Promise<string> {
    return this.callTool("start_domain_verification", { domain });
  }

  checkDomainVerification(domain: string): Promise<string> {
    return this.callTool("check_domain_verification", { domain });
  }
}
