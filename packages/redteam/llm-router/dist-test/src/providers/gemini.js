/**
 * Gemini provider — Google AI Studio models through Google's
 * OpenAI-compatible endpoint (POST {baseUrl}/chat/completions). Tool
 * calls are translated between the router's JSON-Schema form and the
 * OpenAI `tools`/`tool_calls` form by the shared openai-wire
 * translation, exactly like the Meta provider.
 *
 * Models (IDs verified against Google's Gemini API documentation,
 * Nov 2026 — fix these constants, never the call sites, if the API
 * disagrees):
 *   - gemini-3.1-pro-preview — the Pro tier for complex reasoning. The
 *     thinking seat.
 *   - gemini-3.8-flash — stable Flash tier built for long-running
 *     agentic workflows; Google's own compatibility examples use it.
 *     The volume seats.
 *   - gemini-3.6-flash — the previous stable Flash; registered for
 *     explicit calls, not seated by default.
 * `reasoning_effort` is passed through; Google's compatibility layer
 * maps it onto the model's thinking level/budget.
 *
 * Known wire limitation (stated, not hidden): Gemini 3 models attach
 * thought signatures to tool calls, and Google's compatibility layer
 * expects them echoed back on later turns. The shared openai-wire
 * translation does not round-trip provider-specific extra fields, so a
 * multi-turn tool loop against a Gemini 3 model may be rejected by the
 * API until the translation carries them. Single-turn and text/tool-
 * first-turn calls are unaffected. This is wiring-proven only — no
 * Gemini key is seated, so no live call has exercised it.
 *
 * Auth: GEMINI_API_KEY env var (the credential ref pi-ai's catalog —
 * and therefore the Models page — uses for the `google` route, so one
 * seated key serves chat + fleet). Override the endpoint with
 * GEMINI_BASE_URL. The key is sent as a Bearer token and is never
 * logged, never included in errors, and never written anywhere.
 */
import { applyResponseFormat, fromWireToolCalls, toWireMessages, toWireTools } from './openai-wire.js';
import { fleetValue } from '../resolver.js';
import { providerErrorFromResponse, providerTransportError } from '../errors.js';
import { completionSignal, resolveCompletionTimeoutMs } from '../timeout.js';
export const GEMINI_PROVIDER_ID = 'gemini';
export const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';
export const GEMINI_BASE_URL_ENV = 'GEMINI_BASE_URL';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const GEMINI_MODELS = {
    /** Pro tier for complex reasoning. The exploiter's engine on the Gemini seats. */
    pro: 'gemini-3.1-pro-preview',
    /** Stable Flash tier for agentic workflows. The volume seats. */
    flash: 'gemini-3.8-flash',
    /** Previous stable Flash. Registered for explicit calls; not seated by default. */
    flashStable: 'gemini-3.6-flash',
};
/** Router hint → Gemini reasoning_effort (passed through; Google maps it to thinking level/budget). */
function toReasoningEffort(hint) {
    return hint; // 'low' | 'medium' | 'high' are all accepted by the compatibility layer
}
export class GeminiProvider {
    id = GEMINI_PROVIDER_ID;
    label = 'Gemini (Google AI Studio)';
    baseUrl;
    constructor(baseUrl) {
        // Blank-but-present env guard, same as the Meta provider: a blank
        // GEMINI_BASE_URL= means "use the default", so resolve with
        // || / trim, never ??.
        const fromEnv = process.env[GEMINI_BASE_URL_ENV]?.trim();
        this.baseUrl = (baseUrl?.trim() || fromEnv || GEMINI_BASE_URL).replace(/\/+$/, '');
    }
    isConfigured() {
        return !!this.apiKeyOrNull();
    }
    apiKeyOrNull() {
        // Resolved per call through the fleet resolver (launching environment
        // by default, the app credentials store when the host installs one),
        // so a key seated or rotated after startup reaches the next dispatch.
        const key = fleetValue(GEMINI_API_KEY_ENV)?.trim();
        return key ? key : null;
    }
    apiKey(options) {
        // The resilience pool's per-attempt credential wins over the env vars;
        // the env vars alone remain the path for unwrapped direct use.
        const key = options?.apiKey ?? this.apiKeyOrNull();
        if (!key) {
            throw new Error(`[llm-router] ${GEMINI_API_KEY_ENV} is set nowhere the fleet can read it. ` +
                'Seat a Gemini API key in Settings → Models (it is stored under the ' +
                `${GEMINI_API_KEY_ENV} credential ref, never in the environment). ` +
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
            throw providerTransportError(this.id, '[llm-router] Gemini request failed', err);
        }
        if (!res.ok) {
            // Never echo the key; the ProviderError carries status + provider
            // code + reset hints for the classifier.
            throw await providerErrorFromResponse(this.id, 'Gemini', res);
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
