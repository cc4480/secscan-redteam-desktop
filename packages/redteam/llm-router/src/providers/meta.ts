/**
 * Meta provider — Meta Model API (dev.meta.ai), OpenAI-compatible wire
 * format (POST {baseUrl}/chat/completions). Tool calls are translated
 * between the router's JSON-Schema form and the OpenAI `tools`/`tool_calls`
 * form, exactly like the Qwen provider.
 *
 * Models (IDs and endpoint from the Meta Model API quickstart and pricing
 * pages, Oct 2026 — the first live call in the acceptance smoke confirms
 * them against the account; fix these constants, never the call sites, if
 * the API disagrees):
 *   - muse-wonder-1.0 — frontier reasoning + agent model. $4.00 / 1M input,
 *     $20.00 / 1M output, $0.20 / 1M cached input. The thinking seats.
 *   - muse-spark-1.3 — fast volume tier. $1.25 / 1M input, $4.25 / 1M
 *     output, $0.15 / 1M cached input. The tool-loop seats.
 *   - muse-spark-1.2 — challenger / fallback candidate, 1M context.
 *     $1.25 / 1M input, $4.25 / 1M output, $0.15 / 1M cached input.
 *     Registered for explicit calls and A/B lanes; not seated.
 * Both accept `reasoning_effort` ("low" | "medium" | "high" | "xhigh");
 * the router's hint is passed through when present.
 *
 * Auth: MODEL_API_KEY env var (the name Meta's quickstart exports), with
 * META_API_KEY as a fallback. Override the endpoint with META_BASE_URL.
 * The key is sent as a Bearer token and is never logged, never included
 * in errors, and never written anywhere.
 */

import type {
  ChatResult,
  CompleteOptions,
  LlmProvider,
} from '../types.js'
import { applyResponseFormat, fromWireToolCalls, toWireMessages, toWireTools } from './openai-wire.js'
import { providerErrorFromResponse, providerTransportError } from '../errors.js'
import { completionSignal, resolveCompletionTimeoutMs } from '../timeout.js'

export const META_PROVIDER_ID = 'meta'
export const META_API_KEY_ENV = 'MODEL_API_KEY'
/** Fallback key name, for shells that already export the shorter form. */
export const META_API_KEY_FALLBACK_ENV = 'META_API_KEY'
export const META_BASE_URL_ENV = 'META_BASE_URL'
export const META_BASE_URL = 'https://api.meta.ai/v1'

export const META_MODELS = {
  /** Frontier-priced tier. Registered for explicit calls, small one-off jobs, and A/B lanes; not seated by default (see policy.ts). */
  wonder: 'muse-wonder-1.0',
  /** The fleet's engine on the Meta seats: all five roles, exploiter included. */
  spark: 'muse-spark-1.3',
  /** Challenger / fallback candidate. Registered for explicit calls and A/B lanes against the spark seat; NOT seated by default. */
  spark12: 'muse-spark-1.2',
} as const

/** Router hint → Meta reasoning_effort (same scale; passed through). */
function toReasoningEffort(hint: CompleteOptions['reasoningEffort']): string | undefined {
  return hint // 'low' | 'medium' | 'high' are all valid Meta values
}

export class MetaProvider implements LlmProvider {
  readonly id = META_PROVIDER_ID
  readonly label = 'Meta Model API (Muse Wonder / Muse Spark)'
  private readonly baseUrl: string

  constructor(baseUrl?: string) {
    // Blank-but-present env guard, same as the Qwen provider: a blank
    // META_BASE_URL= in .env means "use the default", so resolve with
    // || / trim, never ??.
    const fromEnv = process.env[META_BASE_URL_ENV]?.trim()
    this.baseUrl = (baseUrl?.trim() || fromEnv || META_BASE_URL).replace(/\/+$/, '')
  }

  isConfigured(): boolean {
    return !!this.apiKeyOrNull()
  }

  private apiKeyOrNull(): string | null {
    return process.env[META_API_KEY_ENV] ?? process.env[META_API_KEY_FALLBACK_ENV] ?? null
  }

  private apiKey(options?: CompleteOptions): string {
    // The resilience pool's per-attempt credential wins over the env vars;
    // the env vars alone remain the path for unwrapped direct use.
    const key = options?.apiKey ?? this.apiKeyOrNull()
    if (!key) {
      throw new Error(
        `[llm-router] neither ${META_API_KEY_ENV} nor ${META_API_KEY_FALLBACK_ENV} is set. ` +
          'Create a Meta Model API key at dev.meta.ai (Billing must be active on the account) ' +
          `and export ${META_API_KEY_ENV} before starting. The key is never stored in code or docs.`,
      )
    }
    return key
  }

  async complete(options: CompleteOptions): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: toWireMessages(options.messages),
      temperature: options.temperature ?? 0.2,
    }
    const effort = toReasoningEffort(options.reasoningEffort)
    if (effort) body['reasoning_effort'] = effort
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
      throw providerTransportError(this.id, '[llm-router] Meta request failed', err)
    }

    if (!res.ok) {
      // Never echo the key; the ProviderError carries status + provider
      // code + reset hints for the classifier, message in the legacy shape.
      throw await providerErrorFromResponse(this.id, 'Meta', res)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } & Record<string, unknown> }>
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }
    const choice = data.choices?.[0] ?? {}
    const message = choice.message ?? {}

    return {
      text: (message.content as string) ?? '',
      // Surfaced separately when the API returns a thinking trace, so the
      // harness can log it without polluting the model's visible reply.
      reasoning: (message.reasoning_content as string) ?? undefined,
      toolCalls: fromWireToolCalls(message as Record<string, unknown>),
      usage: data.usage
        ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
        : undefined,
      provider: this.id,
      model: options.model,
      requestBody: body,
    }
  }
}
