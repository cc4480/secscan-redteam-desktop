/**
 * AlterEgo bridge client — MCP Streamable HTTP against the operator's own PC.
 *
 * The handshake follows the pattern the runner's pc-agent channel proved
 * against the real bridge: `initialize`, then `notifications/initialized`,
 * then the request, carrying the `Mcp-Session-Id` the server issues (a server
 * rejects later requests without it). Replies may be plain JSON or SSE; both
 * are parsed.
 *
 * There is deliberately no client-side tool filtering (Carlos's order,
 * 2026-10-31): tools/list returns everything the bridge offers and tools/call
 * forwards any name. Destructive ops are gated by the bridge's own native
 * consent dialog; a denial or dialog timeout surfaces here as a distinct
 * `bridge-denied` error, never as a hang or a fake success.
 */
import { readBridgeToken, resolveBridgeConfig } from './config.js';
import { BridgeError, } from './types.js';
const PROTOCOL_VERSION = '2025-03-26';
const USER_AGENT = 'secscan-redteam-runner/0.4.0';
/** Upper bound on tools/list pages followed in one listing. */
const MAX_LIST_PAGES = 16;
/**
 * The bridge's consent denial wording (AlterEgo raises it when its native
 * approval dialog is declined or times out). Matched case-insensitively.
 */
const DENIAL_PATTERN = /denied by local approval|local approval.*(denied|timed out)/i;
/** A JSON or SSE body; empty for accepted notifications. */
function parseBody(text) {
    const trimmed = text.trim();
    if (trimmed === '')
        return undefined;
    const dataLines = trimmed
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(line => line !== '');
    if (dataLines.length > 0)
        return JSON.parse(dataLines[dataLines.length - 1]);
    return JSON.parse(trimmed);
}
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
/** The JSON-RPC error message of a reply, when the reply carries one. */
function rpcErrorMessage(parsed) {
    const error = asRecord(asRecord(parsed)?.['error']);
    if (error === undefined)
        return undefined;
    return typeof error['message'] === 'string' ? error['message'] : 'unknown bridge error';
}
/** Classify an error text: consent denial is its own honest state. */
function classifyErrorText(text) {
    if (DENIAL_PATTERN.test(text)) {
        return new BridgeError('bridge-denied', `[bridge] denied by local approval: ${text.slice(0, 300)}`);
    }
    return new BridgeError('bridge-error', `[bridge] ${text.slice(0, 500)}`);
}
/**
 * Create a bridge client. Configuration resolves once; the session token is
 * re-read from its file on every operation, so a re-pairing takes effect
 * without recreating the client.
 * @param options - config overrides and seams.
 * @returns the client.
 */
export function createBridgeClient(options = {}) {
    const config = resolveBridgeConfig(options.env, options);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    let session;
    /** One JSON-RPC POST. Transport failures classify as `unavailable`; HTTP failures as `bridge-error`. */
    async function post(body, token, timeoutMs, sessionId) {
        const headers = {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
            'user-agent': USER_AGENT,
        };
        if (sessionId !== undefined)
            headers['mcp-session-id'] = sessionId;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        let res;
        try {
            res = await fetchImpl(config.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
        }
        catch (error) {
            clearTimeout(timer);
            const message = error instanceof Error ? error.message : String(error);
            throw new BridgeError('unavailable', `[bridge] cannot reach the bridge at ${config.endpoint}: ${message}`);
        }
        let text;
        try {
            text = await res.text();
        }
        finally {
            clearTimeout(timer);
        }
        const issued = res.headers.get('mcp-session-id') ?? undefined;
        if (res.status === 401 || res.status === 403) {
            throw new BridgeError('bridge-error', `[bridge] HTTP ${String(res.status)}: token rejected (revoked or wrong file?).`);
        }
        if (!res.ok)
            throw new BridgeError('bridge-error', `[bridge] HTTP ${String(res.status)}: ${text.slice(0, 300)}`);
        let parsed;
        try {
            parsed = parseBody(text);
        }
        catch {
            throw new BridgeError('bridge-error', `[bridge] unparseable reply from the bridge: ${text.slice(0, 200)}`);
        }
        return { parsed, sessionId: issued ?? sessionId };
    }
    /** Run initialize + notifications/initialized once and cache the session. */
    function handshake(token, timeoutMs) {
        session ??= (async () => {
            const initialized = await post({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: {},
                    clientInfo: { name: 'secscan-redteam-runner', version: '0.4.0' },
                },
            }, token, timeoutMs);
            const initError = rpcErrorMessage(initialized.parsed);
            if (initError !== undefined)
                throw classifyErrorText(initError);
            if (asRecord(asRecord(initialized.parsed)?.['result']) === undefined) {
                throw new BridgeError('bridge-error', '[bridge] initialize reply carried no result');
            }
            await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, token, timeoutMs, initialized.sessionId);
            return initialized.sessionId;
        })().catch((error) => {
            session = undefined;
            throw error;
        });
        return session;
    }
    /** The paired token, or an `unavailable` error naming the missing file (never the token). */
    function requireToken() {
        const token = readBridgeToken(config);
        if (token === undefined) {
            throw new BridgeError('unavailable', `[bridge] no paired token in ${config.tokenFile} (bridge not paired)`);
        }
        return token;
    }
    /** One tools/* request on the cached session. */
    async function rpcCall(method, params) {
        const token = requireToken();
        try {
            const sessionId = await handshake(token, config.callTimeoutMs);
            const reply = await post({ jsonrpc: '2.0', id: `bridge-${method}`, method, params }, token, config.callTimeoutMs, sessionId);
            const errorMessage = rpcErrorMessage(reply.parsed);
            if (errorMessage !== undefined)
                throw classifyErrorText(errorMessage);
            return asRecord(reply.parsed)?.['result'];
        }
        catch (err) {
            // Clear stale session and retry once with a fresh handshake.
            session = undefined;
            const sessionId = await handshake(token, config.callTimeoutMs);
            const reply = await post({ jsonrpc: '2.0', id: `bridge-${method}`, method, params }, token, config.callTimeoutMs, sessionId);
            const errorMessage = rpcErrorMessage(reply.parsed);
            if (errorMessage !== undefined)
                throw classifyErrorText(errorMessage);
            return asRecord(reply.parsed)?.['result'];
        }
    }
    return {
        endpoint: config.endpoint,
        async available() {
            const token = readBridgeToken(config);
            if (token === undefined)
                return false;
            try {
                await handshake(token, config.probeTimeoutMs);
                return true;
            }
            catch {
                return false;
            }
        },
        async listTools() {
            const tools = [];
            let cursor;
            for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
                const params = cursor === undefined ? {} : { cursor };
                const result = asRecord(await rpcCall('tools/list', params));
                const entries = Array.isArray(result?.['tools']) ? result['tools'] : [];
                for (const entry of entries) {
                    const record = asRecord(entry);
                    if (record === undefined || typeof record['name'] !== 'string')
                        continue;
                    const def = {
                        name: record['name'],
                        ...(typeof record['description'] === 'string' ? { description: record['description'] } : {}),
                        ...('inputSchema' in record ? { inputSchema: record['inputSchema'] } : {}),
                    };
                    tools.push(def);
                }
                const next = result?.['nextCursor'];
                if (typeof next !== 'string' || next === '')
                    break;
                cursor = next;
            }
            return tools;
        },
        async call(name, args = {}) {
            const result = asRecord(await rpcCall('tools/call', { name, arguments: args }));
            if (result === undefined)
                throw new BridgeError('bridge-error', `[bridge] ${name}: empty result`);
            const content = Array.isArray(result['content']) ? result['content'] : [];
            const text = content
                .map(item => asRecord(item)?.['text'])
                .filter((item) => typeof item === 'string')
                .join('\n');
            if (result['isError'] === true)
                throw classifyErrorText(text || `${name} failed`);
            return {
                content,
                text,
                ...('structuredContent' in result ? { structuredContent: result['structuredContent'] } : {}),
            };
        },
    };
}
//# sourceMappingURL=client.js.map