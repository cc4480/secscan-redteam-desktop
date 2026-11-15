/**
 * Ollama provider — a local Ollama daemon (`ollama serve`, default
 * `http://127.0.0.1:11434`) reached through its **native** chat API,
 * `POST {baseURL}/api/chat`.
 *
 * Why native rather than the OpenAI-compatible shim: the shim cannot carry
 * `num_ctx` or `num_predict`, so a model declaring a 128K window would be served
 * at Ollama's small default and every long-context engagement would silently
 * degrade. The native API accepts both in `options`, which is what lets the
 * desktop's detected limits actually take effect. Tool calling is native too:
 * Ollama takes the same JSON-Schema tool block and answers with `tool_calls`.
 *
 * Ollama is a first-class, named fleet family and never the default: with no
 * selector the fleet stays on DeepSeek (see policy.ts), and Ollama seats only
 * when `REDTEAM_LLM_PROVIDER=ollama` or a saved model pick names it.
 *
 * Configuration (resolved at call time through the fleet configuration
 * resolver — the launching environment by default; see ../resolver.ts):
 *   OLLAMA_BASE_URL            default http://127.0.0.1:11434
 *   OLLAMA_MODEL               the model the daemon exposes, e.g. `llama3.2:3b`
 *                              (required when Ollama is selected: model names are
 *                              operator-specific, so there is no default)
 *   OLLAMA_NUM_CTX             context window to request; the desktop publishes
 *                              the value it detected from the model. Unset means
 *                              the daemon's own default, which is deliberately
 *                              NOT guessed here.
 *   OLLAMA_MAX_OUTPUT_TOKENS   ceiling on completion tokens; a caller asking for
 *                              more is clamped rather than allowed to overrun the
 *                              model
 *   OLLAMA_API_KEY             optional bearer token, for a proxied daemon
 *   OLLAMA_ALLOW_REMOTE        "1" permits a non-loopback base URL. Without it a
 *                              remote URL is refused, so a pasted address cannot
 *                              quietly receive the bearer token or mutate another
 *                              host's model store.
 *   REDTEAM_LLM_PROVIDER=ollama  routes every agent role here (see policy.ts)
 *
 * The endpoint is assumed reachable; a stopped daemon fails at request time with
 * the address and the HTTP status, never with a credential.
 */
import { fleetValue } from '../resolver.js';
import { sanitizeToolPairing } from './openai-wire.js';
import { providerErrorFromResponse, providerTransportError } from '../errors.js';
import { completionSignal, resolveCompletionTimeoutMs } from '../timeout.js';
/** Stable routing key for this provider. */
export const OLLAMA_PROVIDER_ID = 'ollama';
/** Daemon root; the native API lives directly below it. */
export const OLLAMA_BASE_URL_ENV = 'OLLAMA_BASE_URL';
/** The model the daemon exposes (required when Ollama is selected). */
export const OLLAMA_MODEL_ENV = 'OLLAMA_MODEL';
/** Context window to request from the daemon. */
export const OLLAMA_NUM_CTX_ENV = 'OLLAMA_NUM_CTX';
/** Ceiling on completion tokens for every role. */
export const OLLAMA_MAX_OUTPUT_TOKENS_ENV = 'OLLAMA_MAX_OUTPUT_TOKENS';
/** Optional bearer token, for a daemon behind a proxy that requires one. */
export const OLLAMA_API_KEY_ENV = 'OLLAMA_API_KEY';
/** Opt-in that permits a non-loopback daemon address. */
export const OLLAMA_ALLOW_REMOTE_ENV = 'OLLAMA_ALLOW_REMOTE';
/** Ollama's documented default listening address. */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
/** Hostnames that are this machine by definition. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
/**
 * @param hostname - a URL hostname.
 * @returns whether it names the local machine (loopback, including the 127/8 block).
 */
function isLoopback(hostname) {
    const host = hostname.trim().toLowerCase();
    return LOOPBACK_HOSTS.has(host) || /^127\./u.test(host);
}
/**
 * Normalize an operator-supplied daemon address to the native API root.
 * @param raw - a daemon root, possibly with a trailing `/v1` or trailing slashes.
 * @returns the root without a trailing slash.
 */
function normalizeBaseUrl(raw) {
    const trimmed = raw.trim().replace(/\/+$/u, '');
    // An operator who pastes the OpenAI-compatible form is not punished for it:
    // `/v1` is the shim's root, and every native path sits beside it.
    return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}
/**
 * Resolve the daemon address and refuse a remote one unless explicitly allowed.
 *
 * The token and the pull/delete mutations follow this address, so an accidental
 * paste of someone else's host is a credential-leak and remote-write path. A
 * loopback address is always fine; anything else needs `OLLAMA_ALLOW_REMOTE=1`.
 * @param baseUrl - the configured address.
 * @returns the normalized address.
 * @throws Error naming the opt-in variable when a remote address was not allowed.
 */
export function assertAllowedBaseUrl(baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl);
    let hostname;
    try {
        hostname = new URL(normalized).hostname;
    }
    catch {
        throw new Error(`[llm-router] Ollama ${OLLAMA_BASE_URL_ENV} is not a valid URL: ${normalized}`);
    }
    if (isLoopback(hostname))
        return normalized;
    if (fleetValue(OLLAMA_ALLOW_REMOTE_ENV)?.trim() === '1')
        return normalized;
    throw new Error(`[llm-router] Ollama ${OLLAMA_BASE_URL_ENV} points at '${hostname}', which is not this machine. ` +
        `Set ${OLLAMA_ALLOW_REMOTE_ENV}=1 if that daemon is genuinely yours: the configured token and ` +
        'model-pull/delete operations follow this address.');
}
/**
 * @param raw - an environment value.
 * @returns the positive integer it carries, or undefined when unset or unusable.
 */
function positiveInt(raw) {
    const trimmed = raw?.trim();
    if (trimmed === undefined || trimmed === '')
        return undefined;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
/**
 * Translate one router message into the native chat shape.
 * @param message - router message.
 * @returns the wire message.
 */
function toNativeMessage(message) {
    // Native Ollama does not require tool-call ids on the pairing, but an assistant
    // turn that requested tools must still carry them, exactly as on the OpenAI wire.
    if (message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0) {
        return {
            role: 'assistant',
            content: message.content ?? '',
            tool_calls: message.toolCalls.map(call => ({
                function: { name: call.name, arguments: call.arguments ?? {} },
            })),
        };
    }
    return { role: message.role, content: message.content };
}
/**
 * @param tools - router tools.
 * @returns the native tool block, or undefined when there are none.
 */
function toNativeTools(tools) {
    if (tools === undefined || tools.length === 0)
        return undefined;
    return tools.map(tool => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
}
/**
 * Read the native reply's tool calls.
 *
 * Native Ollama returns `arguments` as a JSON object; some builds and proxies
 * return it as a JSON string. Both are accepted, and ids are synthesized when the
 * daemon omits them, because the router's contract needs one per call.
 * @param message - the reply's `message` object.
 * @returns the calls, in the order the daemon listed them.
 */
export function fromNativeToolCalls(message) {
    const raw = message['tool_calls'];
    if (!Array.isArray(raw))
        return [];
    const calls = [];
    for (const [index, entry] of raw.entries()) {
        if (typeof entry !== 'object' || entry === null)
            continue;
        const fn = entry['function'];
        if (typeof fn !== 'object' || fn === null)
            continue;
        const record = fn;
        const name = typeof record['name'] === 'string' && record['name'] !== '' ? record['name'] : undefined;
        if (name === undefined)
            continue;
        let args = {};
        const rawArgs = record['arguments'];
        if (typeof rawArgs === 'string') {
            try {
                const parsed = JSON.parse(rawArgs);
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    args = parsed;
                }
            }
            catch {
                // A malformed argument string yields an empty object rather than a crash:
                // the tool layer reports the missing inputs to the model on the next turn.
            }
        }
        else if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
            args = rawArgs;
        }
        const id = typeof entry['id'] === 'string'
            ? entry['id']
            : `call_${String(index + 1)}`;
        calls.push({ id, name, arguments: args });
    }
    return calls;
}
export class OllamaProvider {
    id = OLLAMA_PROVIDER_ID;
    label = 'Ollama (local daemon, native chat API)';
    /** Constructor-pinned endpoint; wins over the environment when set. */
    baseUrlOverride;
    /** Test seam: a supplied transport is used instead of the global one. */
    fetchImpl;
    constructor(baseUrl, fetchImpl) {
        const pinned = baseUrl?.trim();
        this.baseUrlOverride = pinned ? pinned : undefined;
        this.fetchImpl = fetchImpl;
    }
    /**
     * The endpoint for this call: the constructor value when pinned, else
     * `OLLAMA_BASE_URL` read now, else the daemon's default address.
     * @returns the checked native API root.
     * @throws Error when a remote address is not explicitly allowed.
     */
    resolveBaseUrl() {
        if (this.baseUrlOverride !== undefined)
            return assertAllowedBaseUrl(this.baseUrlOverride);
        const fromEnv = fleetValue(OLLAMA_BASE_URL_ENV)?.trim();
        return assertAllowedBaseUrl(fromEnv !== undefined && fromEnv !== '' ? fromEnv : OLLAMA_BASE_URL);
    }
    /**
     * A local daemon needs no credential to be reachable, so this provider is
     * always "configured" — the failure mode is a request-time connection error
     * naming the address, which is more useful than a startup refusal.
     * @returns true.
     */
    isConfigured() {
        return true;
    }
    /**
     * @param options - per-attempt options carrying the resilience pool's credential, when any.
     * @returns the bearer token to send, or null when none is configured.
     */
    apiKeyOrNull(options) {
        if (options?.apiKey !== undefined)
            return options.apiKey;
        const value = fleetValue(OLLAMA_API_KEY_ENV)?.trim();
        return value !== undefined && value.length > 0 ? value : null;
    }
    async complete(options) {
        const baseUrl = this.resolveBaseUrl();
        // The completion budget, clamped by the model's ceiling when one is published.
        // Asking a 4K-context model for 32K of output is not an error the daemon
        // reports usefully, so it is prevented here.
        const ceiling = positiveInt(fleetValue(OLLAMA_MAX_OUTPUT_TOKENS_ENV));
        const requested = options.maxTokens;
        const numPredict = ceiling === undefined
            ? requested
            : Math.min(requested ?? ceiling, ceiling);
        const requestOptions = { temperature: options.temperature ?? 0.2 };
        const numCtx = positiveInt(fleetValue(OLLAMA_NUM_CTX_ENV));
        if (numCtx !== undefined)
            requestOptions['num_ctx'] = numCtx;
        if (numPredict !== undefined)
            requestOptions['num_predict'] = numPredict;
        // Pairing repair is shared with the OpenAI wire: a tool message with no
        // preceding assistant tool_calls is rejected by Ollama just the same.
        const repair = sanitizeToolPairing(options.messages);
        const body = {
            model: options.model,
            messages: repair.messages.map(toNativeMessage),
            stream: false,
            options: requestOptions,
        };
        const tools = toNativeTools(options.tools);
        if (tools !== undefined)
            body['tools'] = tools;
        // Native structured output replaces `response_format`: json_object is
        // `format: 'json'`, a JSON schema is `format: <schema>`. A regex constraint has
        // no native equivalent, so it is refused rather than silently dropped.
        if (options.responseFormat !== undefined) {
            if (options.responseFormat.type === 'regex') {
                throw new Error('[llm-router] Ollama cannot enforce a regex responseFormat; it was refused rather than dropped');
            }
            body['format'] = options.responseFormat.type === 'json_object'
                ? 'json'
                : options.responseFormat.schema;
        }
        const headers = { 'Content-Type': 'application/json' };
        const key = this.apiKeyOrNull(options);
        if (key !== null)
            headers['Authorization'] = `Bearer ${key}`;
        const fetchImpl = this.fetchImpl ?? globalThis.fetch;
        let res;
        try {
            res = await fetchImpl(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: completionSignal(options.signal, options.timeoutMs ?? resolveCompletionTimeoutMs()),
            });
        }
        catch (err) {
            throw providerTransportError(this.id, `[llm-router] Ollama request to ${baseUrl} failed (is the daemon running? \`ollama serve\`)`, err);
        }
        if (!res.ok)
            throw await providerErrorFromResponse(this.id, 'Ollama', res);
        const data = (await res.json());
        // The native API reports failures as a 200 with an `error` string.
        if (typeof data.error === 'string' && data.error !== '') {
            throw new Error(`[llm-router] Ollama refused the request: ${data.error}`);
        }
        const message = data.message ?? {};
        const promptTokens = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : undefined;
        const completionTokens = typeof data.eval_count === 'number' ? data.eval_count : undefined;
        return {
            text: message.content ?? '',
            toolCalls: fromNativeToolCalls(message),
            usage: promptTokens !== undefined && completionTokens !== undefined
                ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
                : undefined,
            provider: this.id,
            model: options.model,
            requestBody: body,
        };
    }
}
