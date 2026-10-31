/**
 * Minimal SecScan MCP client (Streamable HTTP, stateless).
 *
 * Dependency-free — global fetch only. A normal User-Agent is set because the
 * edge WAF blocks default library user-agents (observed: Python-urllib 403s).
 */
const PROTOCOL_VERSION = "2025-03-26";
const USER_AGENT = "secscan-redteam-runner/0.4.0";
function headers(token) {
    return {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "user-agent": USER_AGENT,
    };
}
export class McpClient {
    endpoint;
    token;
    timeoutMs;
    constructor(cfg) {
        if (!cfg.token)
            throw new Error("[mcp] SECSCAN_MCP_TOKEN is not set.");
        this.endpoint = cfg.endpoint.replace(/\/+$/, "");
        this.token = cfg.token;
        this.timeoutMs = cfg.timeoutMs ?? 30_000;
    }
    async post(body) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
            const res = await fetch(this.endpoint, {
                method: "POST",
                headers: headers(this.token),
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
            const text = await res.text();
            if (res.status === 401 || res.status === 403) {
                throw new Error(`[mcp] HTTP ${res.status}: token rejected (wrong scope or revoked?).`);
            }
            if (!res.ok)
                throw new Error(`[mcp] HTTP ${res.status}: ${text.slice(0, 300)}`);
            // SSE or plain JSON: take the last data: line that parses.
            let json = null;
            for (const line of text.split("\n")) {
                const t = line.trim();
                if (t.startsWith("data:")) {
                    try {
                        json = JSON.parse(t.slice(5).trim());
                    }
                    catch {
                        // keep scanning
                    }
                }
            }
            if (json === null && text.trim()) {
                try {
                    json = JSON.parse(text);
                }
                catch {
                    // leave null
                }
            }
            return json;
        }
        finally {
            clearTimeout(timer);
        }
    }
    unwrap(message) {
        if (message && typeof message === "object" && "result" in message) {
            return message["result"];
        }
        return message;
    }
    /** Call any MCP tool by name; returns the concatenated text content. Throws on isError. */
    async callTool(name, args = {}) {
        await this.post({
            jsonrpc: "2.0",
            id: "init",
            method: "initialize",
            params: {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: "secscan-redteam-runner", version: "0.4.0" },
            },
        });
        await this.post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        const raw = await this.post({
            jsonrpc: "2.0",
            id: `tool-${name}`,
            method: "tools/call",
            params: { name, arguments: args },
        });
        const result = this.unwrap(raw);
        if (!result)
            throw new Error(`[mcp] ${name}: empty result`);
        if (result.isError) {
            const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
            throw new Error(`[mcp] ${name} isError: ${text.slice(0, 500)}`);
        }
        return (result.content ?? [])
            .filter((c) => typeof c.text === "string")
            .map((c) => c.text)
            .join("\n");
    }
    // Convenience wrappers (all read-only except scan_url / start_domain_verification).
    scanUrl(url, aggressive = false) {
        return this.callTool("scan_url", aggressive ? { url, aggressive: true } : { url });
    }
    getScanStatus(scanId, waitSeconds = 60) {
        return this.callTool("get_scan_status", { scan_id: scanId, wait_seconds: waitSeconds });
    }
    getReport(scanId) {
        return this.callTool("get_report", { scan_id: scanId });
    }
    listRecentScans(limit = 10) {
        return this.callTool("list_recent_scans", { limit });
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
    getAccount() {
        return this.callTool("get_account", {});
    }
}
//# sourceMappingURL=mcp.js.map