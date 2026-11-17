/**
 * Legacy MCP client placeholder.
 *
 * External SecScan MCP scanning/verification was removed; the runner uses
 * in-process engines and local domain verification. This class remains as a
 * compatibility stub for context wiring and tests that inject their own client.
 */
export class McpClient {
    constructor(_cfg = {}) { }
    unavailable(name) {
        throw new Error(`[mcp] ${name} is unavailable: external SecScan MCP is not configured in this build.`);
    }
    async callTool(name, _args = {}) {
        return this.unavailable(name);
    }
    listVerifiedDomains() {
        return this.callTool("list_verified_domains", {});
    }
    startDomainVerification(domain) {
        return this.callTool("start_domain_verification", { domain });
    }
    checkDomainVerification(domain) {
        return this.callTool("check_domain_verification", { domain });
    }
}
//# sourceMappingURL=mcp.js.map