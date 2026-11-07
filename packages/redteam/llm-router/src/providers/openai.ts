/**
 * OpenAI provider — OpenAI API (ChatGPT models), OpenAI-compatible wire
 * format (POST {baseUrl}/chat/completions). Tool calls are translated
 * between the router's JSON-Schema form and the OpenAI `tools`/`tool_calls`
 * form by the shared openai-wire translation, exactly like the Meta
 * provider.
 *
 * Models (IDs verified against OpenAI's model/pricing pages, Nov 2026 —
 * fix these constants, never the call sites, if the API disagrees):
 *   - gpt-5.5 — the flagship with built-in reasoning. The thinking seat.
 *   - gpt-5.4 — the cost-tiered production tier below it. The volume seats.
 *   - gpt-5.6-sol — newest flagship tier; registered for explicit calls
 *     and A/B lanes, not seated by default.
 * `reasoning_effort` ("low" | "medium" | "high") is passed through when
 * the router supplies a hint. Temperature is forwarded only when the
 * caller set one AND no reasoning effort is in play: the GPT-5 reasoning
 * tiers accept only the default temperature alongside reasoning, so a
 * forced house default would fail the call at the API.
 *
 * Auth: OPENAI_API_KEY env var (the credential ref the Models page
 * derives for the `openai` route, so one seated key serves chat + fleet).
 * Override the endpoint with OPENAI_BASE_URL. The key is sent as a
 * Bearer token and is never logged, never included in errors, and never
 * written anywhere.
 */

import type {
  ChatResult,
  CompleteOptions,
  LlmProvider,
} from '../types.js'
import { applyResponseFormat, fromWireToolCalls, toWireMessages, toWireTools } from './openai-wire.js'
import { fleetValue } from '../resolver.js'
import { providerErrorFromResponse, providerTransportError } from '../errors.js'
import { completionSignal, resolveCompletionTimeoutMs } from '../timeout.js'

export const OPENAI_PROVIDER_ID = 'openai'
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY'
export const OPENAI_BASE_URL_ENV = 'OPENAI_BASE_URL'
export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export const OPENAI_MODELS = {
  /** Flagship reasoning tier. The exploiter's engine on the OpenAI seats. */
  flagship: 'gpt-5.5',
  /** Cost-tiered production tier. The volume seats. */
  standard: 'gpt-5.4',
  /** Newest flagship tier. Registered for explicit calls and A/B lanes; not seated by default. */
  sol: 'gpt-5.6-sol',
} as const

/** Router hint → OpenAI reasoning_effort (same scale; passed through). */
function toReasoningEffort(hint: CompleteOptions['reasoningEffort']): string | undefined {
  return hint // 'low' | 'medium' | 'high' are all valid OpenAI values
}

export class OpenAiProvider implements LlmProvider {
  readonly id = OPENAI_PROVIDER_ID
  readonly label = 'OpenAI (ChatGPT)'
  private readonly baseUrl: string

  constructor(baseUrl?: string) {
    // Blank-but-present env guard, same as the Meta provider: a blank
    // OPENAI_BASE_URL= means "use the default", so resolve with || / trim,
    // never ??.
    const fromEnv = process.env[OPENAI_BASE_URL_ENV]?.trim()
    this.baseUrl = (baseUrl?.trim() || fromEnv || OPENAI_BASE_URL).replace(/\/+$/, '')
  }

  isConfigured(): boolean {
    return !!this.apiKeyOrNull()
  }

  private apiKeyOrNull(): string | null {
    // Resolved per call through the fleet resolver (launching environment
    // by default, the app credentials store when the host installs one),
    // so a key seated or rotated after startup reaches the next dispatch.
    const key = fleetValue(OPENAI_API_KEY_ENV)?.trim()
    return key ? key : null
  }

  private apiKey(options?: CompleteOptions): string {
    // The resilience pool's per-attempt credential wins over the env vars;
    // the env vars alone remain the path for unwrapped direct use.
    const key = options?.apiKey ?? this.apiKeyOrNull()
    if (!key) {
      throw new Error(
        `[llm-router] ${OPENAI_API_KEY_ENV} is set nowhere the fleet can read it. ` +
          'Seat an OpenAI API key in Settings → Models (it is stored under the ' +
          `${OPENAI_API_KEY_ENV} credential ref, never in the environment). ` +
          'The key is never stored in code or docs.',
      )
    }
    return key
  }

  async complete(options: CompleteOptions): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: toWireMessages(options.messages),
    }
    const effort = toReasoningEffort(options.reasoningEffort)
    if (effort) body['reasoning_effort'] = effort
    // See the header: alongside reasoning, the GPT-5 tiers accept only
    // the default temperature, so a caller temperature is forwarded only
    // when no reasoning effort is in play.
    if (options.temperature !== undefined && !effort) body['temperature'] = options.temperature
    if (options.maxTokens) body['max_tokens'] = options.maxTokens
    const wireTools = toWireTools(options.tools)
    if (wireTools) body['tools'] = wireTools
    applyResponseFormat(body, this.id, options)

    let res: Response
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
      })
    } catch (err) {
      throw providerTransportError(this.id, '[llm-router] OpenAI request failed', err)
    }

    if (!res.ok) {
      // Never echo the key; the ProviderError carries status + provider
      // code + reset hints for the classifier.
      throw await providerErrorFromResponse(this.id, 'OpenAI', res)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } & Record<string, unknown> }>
      usage?: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
        prompt_tokens_details?: { cached_tokens?: number }
      }
    }
    const choice = data.choices?.[0] ?? {}
    const message = choice.message ?? {}

    return {
      text: (message.content as string) ?? '',
      reasoning: (message.reasoning_content as string) ?? undefined,
      toolCalls: fromWireToolCalls(message as Record<string, unknown>),
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
    }
  }
}
