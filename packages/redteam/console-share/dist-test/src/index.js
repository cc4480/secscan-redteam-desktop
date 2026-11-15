import z from '@deepseek-ai/schemastery';
import { callArsenalTool, isArsenalToolName } from "./arsenal.js";
import { normalizeConsoleBaseUrl, proxyToConsole, sendShareJsonError } from "./proxy.js";
import { CONSOLE_SHARE_ARSENAL_PATH, CONSOLE_SHARE_PREFIX_PATH, } from "./shared.js";
export { normalizeConsoleBaseUrl } from "./proxy.js";
/** Cordis function-plugin name. */
export const name = 'redteam-console-share';
/** The route carrier and the trust fence guarding every route. */
export const inject = ['webServer', 'connection'];
export const Config = z.object({
    baseUrl: z.string().default('http://127.0.0.1:8787/mcp'),
    token: z.string().default(''),
});
/** The composition's connection service (typed locally: its package is browser-side). */
function connectionOf(ctx) {
    return Reflect.get(ctx, 'connection');
}
/** Arsenal bridge request bodies are small tool calls; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024;
/** JSON response (no-store: console data is live engagement state). */
function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
}
/** Collect a bounded request body as UTF-8 text; null past the ceiling (stream drained). */
async function readBoundedBody(req) {
    const chunks = [];
    let size = 0;
    // http server streams without setEncoding always yield Buffer chunks.
    for await (const chunk of req) {
        size += chunk.byteLength;
        if (size > MAX_BODY_BYTES) {
            // Drain the remainder so the refusal is a readable response, not a socket cut.
            req.resume();
            return null;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, size).toString('utf8');
}
/** Validate one Arsenal bridge body at the wire: a JSON object naming an allowlisted tool. */
function parseArsenalBody(text) {
    let body;
    try {
        body = JSON.parse(text);
    }
    catch {
        // Swallows the parse error: a non-JSON body is exactly the null case.
        return null;
    }
    if (typeof body !== 'object' || body === null)
        return null;
    const { tool, arguments: args } = body;
    if (typeof tool !== 'string' || !isArsenalToolName(tool))
        return null;
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args)))
        return null;
    return { tool, ...(args === undefined ? {} : { arguments: args }) };
}
/**
 * Register the share prefix route behind the connection trust fence.
 * @param ctx - host context carrying the webServer and connection services.
 * @param config - the console address and token, resolved by the Loader.
 */
export function apply(ctx, config) {
    const target = {
        baseUrl: normalizeConsoleBaseUrl(config.baseUrl),
        token: config.token,
    };
    /** Answer an untrusted/unauthenticated request; true when it was rejected. */
    const rejected = (req, res) => {
        const rejection = connectionOf(ctx).requestRejection(req);
        if (rejection === undefined)
            return false;
        res.statusCode = rejection;
        res.end();
        return true;
    };
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: CONSOLE_SHARE_PREFIX_PATH,
        handler: async (req, res) => {
            if (rejected(req, res))
                return;
            // Node always sets url on server requests; String keeps that fact local.
            const url = new URL(String(req.url), 'http://localhost');
            const rest = url.pathname.slice(CONSOLE_SHARE_PREFIX_PATH.length);
            if (rest === CONSOLE_SHARE_ARSENAL_PATH.slice(CONSOLE_SHARE_PREFIX_PATH.length)) {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'POST');
                    res.end();
                    return;
                }
                // Body-format validation: the essence must be exactly application/json.
                const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase();
                if (essence !== 'application/json') {
                    sendShareJsonError(res, 415, 'unsupported-media-type', 'content-type must be application/json');
                    return;
                }
                let text;
                try {
                    text = await readBoundedBody(req);
                }
                catch {
                    // Swallows connection errors mid-body: there is nothing left to answer precisely.
                    sendShareJsonError(res, 400, 'bad-request', 'request body unreadable');
                    return;
                }
                if (text === null) {
                    sendShareJsonError(res, 413, 'payload-too-large', 'request body is too large');
                    return;
                }
                const payload = parseArsenalBody(text);
                if (payload === null || !isArsenalToolName(payload.tool)) {
                    sendShareJsonError(res, 400, 'bad-request', 'request body must be JSON naming one allowlisted Arsenal tool with an object of arguments');
                    return;
                }
                const outcome = await callArsenalTool(target, payload.tool, payload.arguments ?? {});
                sendJson(res, outcome.status, outcome.payload);
                return;
            }
            if (rest.startsWith('/api/')) {
                proxyToConsole(target, req, res, `${rest}${url.search}`);
                return;
            }
            sendShareJsonError(res, 404, 'not-found', `no share route at ${url.pathname}`);
        },
    }), `redteam-console-share: prefix ${CONSOLE_SHARE_PREFIX_PATH}`);
}
