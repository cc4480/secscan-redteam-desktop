/**
 * Z.ai provider — GLM models on Z.ai's international platform,
 * OpenAI-compatible wire format (POST {baseUrl}/chat/completions). Tool
 * calls are translated between the router's JSON-Schema form and the
 * OpenAI `tools`/`tool_calls` form by the shared openai-wire
 * translation, exactly like the Meta provider.
 *
 * Models (IDs verified against Z.ai's published pricing/model pages,
 * Nov 2026 — fix these constants, never the call sites, if the API
 * disagrees):
 *   - glm-5.3 — the current GLM flagship. The thinking seat.
 *   - glm-4.6 — the established 200K-context tier. The volume seats.
 *   - glm-4.7-flash — free lightweight tier; registered for explicit
 *     calls, not seated by default.
 * Reasoning is controlled with Z.ai's `thinking` object, not
 * `reasoning_effort`: when the router supplies an effort hint, thinking
 * is enabled; the depth itself is the model's own.
 *
 * Auth: ZAI_API_KEY env var (the credential ref the Models page derives
 * for the `zai` route, so one seated key serves chat + fleet). Override
 * the endpoint with ZAI_BASE_URL. The key is sent as a Bearer token and
 * is never logged, never included in errors, and never written anywhere.
 */
import { applyResponseFormat, fromWireToolCalls, toWireMessages, toWireTools } from './openai-wire.js';
import { fleetValue } from '../resolver.js';
import { providerErrorFromResponse, providerTransportError } from '../errors.js';
import { completionSignal, resolveCompletionTimeoutMs } from '../timeout.js';
export const ZAI_PROVIDER_ID = 'zai';
export const ZAI_API_KEY_ENV = 'ZAI_API_KEY';
export const ZAI_BASE_URL_ENV = 'ZAI_BASE_URL';
export const ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
export const ZAI_MODELS = {
    /** Current GLM flagship. The exploiter's engine on the GLM seats. */
    flagship: 'glm-5.3',
    /** Established 200K-context tier. The volume seats. */
    standard: 'glm-4.6',
    /** Free lightweight tier. Registered for explicit calls; not seated by default. */
    flash: 'glm-4.7-flash',
};
export class ZaiProvider {
    id = ZAI_PROVIDER_ID;
    label = 'GLM (Z.ai)';
    baseUrl;
    constructor(baseUrl) {
        // Blank-but-present env guard, same as the Meta provider: a blank
        // ZAI_BASE_URL= means "use the default", so resolve with || / trim,
        // never ??.
        const fromEnv = process.env[ZAI_BASE_URL_ENV]?.trim();
        this.baseUrl = (baseUrl?.trim() || fromEnv || ZAI_BASE_URL).replace(/\/+$/, '');
    }
    isConfigured() {
        return !!this.apiKeyOrNull();
    }
    apiKeyOrNull() {
        // Resolved per call through the fleet resolver (launching environment
        // by default, the app credentials store when the host installs one),
        // so a key seated or rotated after startup reaches the next dispatch.
        const key = fleetValue(ZAI_API_KEY_ENV)?.trim();
        return key ? key : null;
    }
    apiKey(options) {
        // The resilience pool's per-attempt credential wins over the env vars;
        // the env vars alone remain the path for unwrapped direct use.
        const key = options?.apiKey ?? this.apiKeyOrNull();
        if (!key) {
            throw new Error(`[llm-router] ${ZAI_API_KEY_ENV} is set nowhere the fleet can read it. ` +
                'Seat a Z.ai API key in Settings → Models (it is stored under the ' +
                `${ZAI_API_KEY_ENV} credential ref, never in the environment). ` +
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
        // Z.ai's reasoning switch is the `thinking` object; an effort hint
        // from the router turns it on (the model picks its own depth).
        if (options.reasoningEffort)
            body['thinking'] = { type: 'enabled' };
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
            throw providerTransportError(this.id, '[llm-router] Z.ai request failed', err);
        }
        if (!res.ok) {
            // Never echo the key; the ProviderError carries status + provider
            // code + reset hints for the classifier.
            throw await providerErrorFromResponse(this.id, 'Z.ai', res);
        }
        const data = (await res.json());
        const choice = data.choices?.[0] ?? {};
        const message = choice.message ?? {};
        return {
            text: message.content ?? '',
            // GLM returns its thinking trace as reasoning_content, like the
            // other OpenAI-wire providers; surfaced separately.
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
