/**
 * xAI provider — Grok models, OpenAI-compatible wire format
 * (POST {baseUrl}/chat/completions). Tool calls are translated between
 * the router's JSON-Schema form and the OpenAI `tools`/`tool_calls`
 * form by the shared openai-wire translation, exactly like the Meta
 * provider.
 *
 * Models (IDs verified against xAI's published model list, Nov 2026 —
 * fix these constants, never the call sites, if the API disagrees):
 *   - grok-4.7 — current flagship (Sep 2026), 500K context. The thinking
 *     seat.
 *   - grok-4.3 — 1M-context tier at the fleet's volume price point. The
 *     volume seats.
 * Both accept `reasoning_effort` ("low" | "medium" | "high"); the
 * router's hint is passed through when present.
 *
 * Auth: XAI_API_KEY env var (the credential ref the Models page derives
 * for the `xai` route, so one seated key serves chat + fleet). Override
 * the endpoint with XAI_BASE_URL. The key is sent as a Bearer token and
 * is never logged, never included in errors, and never written anywhere.
 */
import { applyResponseFormat, fromWireToolCalls, toWireMessages, toWireTools } from './openai-wire.js';
import { fleetValue } from '../resolver.js';
import { providerErrorFromResponse, providerTransportError } from '../errors.js';
import { completionSignal, resolveCompletionTimeoutMs } from '../timeout.js';
export const XAI_PROVIDER_ID = 'xai';
export const XAI_API_KEY_ENV = 'XAI_API_KEY';
export const XAI_BASE_URL_ENV = 'XAI_BASE_URL';
export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const XAI_MODELS = {
    /** Current flagship. The exploiter's engine on the xAI seats. */
    flagship: 'grok-4.7',
    /** 1M-context volume tier. The volume seats. */
    standard: 'grok-4.3',
};
/** Router hint → xAI reasoning_effort (same scale; passed through). */
function toReasoningEffort(hint) {
    return hint; // 'low' | 'medium' | 'high' are all valid xAI values
}
export class XaiProvider {
    id = XAI_PROVIDER_ID;
    label = 'xAI (Grok)';
    baseUrl;
    constructor(baseUrl) {
        // Blank-but-present env guard, same as the Meta provider: a blank
        // XAI_BASE_URL= means "use the default", so resolve with || / trim,
        // never ??.
        const fromEnv = process.env[XAI_BASE_URL_ENV]?.trim();
        this.baseUrl = (baseUrl?.trim() || fromEnv || XAI_BASE_URL).replace(/\/+$/, '');
    }
    isConfigured() {
        return !!this.apiKeyOrNull();
    }
    apiKeyOrNull() {
        // Resolved per call through the fleet resolver (launching environment
        // by default, the app credentials store when the host installs one),
        // so a key seated or rotated after startup reaches the next dispatch.
        const key = fleetValue(XAI_API_KEY_ENV)?.trim();
        return key ? key : null;
    }
    apiKey(options) {
        // The resilience pool's per-attempt credential wins over the env vars;
        // the env vars alone remain the path for unwrapped direct use.
        const key = options?.apiKey ?? this.apiKeyOrNull();
        if (!key) {
            throw new Error(`[llm-router] ${XAI_API_KEY_ENV} is set nowhere the fleet can read it. ` +
                'Seat an xAI API key in Settings → Models (it is stored under the ' +
                `${XAI_API_KEY_ENV} credential ref, never in the environment). ` +
                'The key is never stored in code or docs.');
        }
        return key;
    }
    async complete(options) {
        const body = {
            model: options.model,
            messages: toWireMessages(options.messages),
            temperature: options.temperature ?? 0.2,
        };
        const effort = toReasoningEffort(options.reasoningEffort);
        if (effort)
            body['reasoning_effort'] = effort;
        if (options.maxTokens)
            body['max_tokens'] = options.maxTokens;
        const wireTools = toWireTools(options.tools);
        if (wireTools)
            body['tools'] = wireTools;
        applyResponseFormat(body, this.id, options);
        let res;
        try {
            res = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // The raw key lives only in this header — never in logs or errors.
                    Authorization: `Bearer ${this.apiKey(options)}`,
                },
                body: JSON.stringify(body),
                signal: completionSignal(options.signal, options.timeoutMs ?? resolveCompletionTimeoutMs()),
            });
        }
        catch (err) {
            throw providerTransportError(this.id, '[llm-router] xAI request failed', err);
        }
        if (!res.ok) {
            // Never echo the key; the ProviderError carries status + provider
            // code + reset hints for the classifier.
            throw await providerErrorFromResponse(this.id, 'xAI', res);
        }
        const data = (await res.json());
        const choice = data.choices?.[0] ?? {};
        const message = choice.message ?? {};
        return {
            text: message.content ?? '',
            reasoning: message.reasoning_content ?? undefined,
            toolCalls: fromWireToolCalls(message),
            usage: data.usage
                ? {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens,
                    ...(typeof data.usage.prompt_tokens_details?.cached_tokens === 'number'
                        ? { cacheReadTokens: data.usage.prompt_tokens_details.cached_tokens }
                        : {}),
                }
                : undefined,
            provider: this.id,
            model: options.model,
            requestBody: body,
        };
    }
}
