/**
 * Local provider — a llama.cpp `llama-server` (or Ollama, vLLM, LM Studio)
 * endpoint speaking the OpenAI-compatible `POST {baseURL}/chat/completions`
 * shape, served on this machine with no cloud API.
 *
 * Why it exists: the engagement engine must be able to run fully offline. The
 * hosted Qwen provider targets Alibaba DashScope and always enables
 * DashScope-only `enable_thinking`/`reasoning_effort`; a local server may reject
 * or mishandle those, so this provider sends the portable subset by default and
 * exposes thinking as an explicit opt-in.
 *
 * Configuration (environment, read at call time):
 *   REDTEAM_LOCAL_BASE_URL         default http://127.0.0.1:8080/v1
 *   REDTEAM_LOCAL_API_KEY          optional; sent as a bearer token when set
 *   REDTEAM_LOCAL_ENABLE_THINKING  "1" to request the model's thinking trace
 *   REDTEAM_LLM_PROVIDER=local     routes every agent role here (see policy.ts)
 *   REDTEAM_LOCAL_MODEL            the model name the server exposes
 *
 * The endpoint is assumed reachable; a down or unloaded server fails at request
 * time with the URL and the HTTP status, never with a credential.
 */

import type { ChatResult, CompleteOptions, LlmProvider } from '../types.js'
import { applyResponseFormat, fromWireToolCalls, toWireMessages, toWireTools } from './openai-wire.js'
import { providerErrorFromResponse, providerTransportError } from '../errors.js'
import { completionSignal, resolveCompletionTimeoutMs } from '../timeout.js'

/** Stable routing key for this provider. */
export const LOCAL_PROVIDER_ID = 'local'
export const LOCAL_BASE_URL_ENV = 'REDTEAM_LOCAL_BASE_URL'
export const LOCAL_API_KEY_ENV = 'REDTEAM_LOCAL_API_KEY'
export const LOCAL_ENABLE_THINKING_ENV = 'REDTEAM_LOCAL_ENABLE_THINKING'
/** The model name the local server exposes (required when the local provider is selected). */
export const LOCAL_MODEL_ENV = 'REDTEAM_LOCAL_MODEL'
/** llama.cpp llama-server's default OpenAI-compatible root. */
export const LOCAL_BASE_URL = 'http://127.0.0.1:8080/v1'

/** Router hint → the model template's reasoning_effort vocabulary. */
function toReasoningEffort(hint: CompleteOptions['reasoningEffort']): string | undefined {
  if (hint === 'high') return 'xhigh'
  if (hint === 'medium') return 'medium'
  if (hint === 'low') return 'low'
  return undefined
}

export class LocalOpenAiProvider implements LlmProvider {
  readonly id = LOCAL_PROVIDER_ID
  readonly label = 'Local model (OpenAI-compatible)'

  private readonly baseUrl: string

  constructor(baseUrl?: string) {
    const fromEnv = process.env[LOCAL_BASE_URL_ENV]?.trim()
    this.baseUrl = (baseUrl?.trim() || fromEnv || LOCAL_BASE_URL).replace(/\/+$/, '')
  }

  /** A local endpoint needs no credential; reachability is a per-request failure. */
  isConfigured(): boolean {
    return true
  }

  private apiKeyOrNull(options?: CompleteOptions): string | null {
    // The resilience pool's per-attempt credential wins over the env var.
    if (options?.apiKey !== undefined) return options.apiKey
    const value = process.env[LOCAL_API_KEY_ENV]?.trim()
    return value !== undefined && value.length > 0 ? value : null
  }

  async complete(options: CompleteOptions): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: toWireMessages(options.messages),
      temperature: options.temperature ?? 0.2,
    }
    // Thinking is opt-in for local runs: on a CPU-hosted model it multiplies
    // latency, and it is the feature most likely to differ between servers.
    if (process.env[LOCAL_ENABLE_THINKING_ENV] === '1') {
      body['enable_thinking'] = true
      const effort = toReasoningEffort(options.reasoningEffort)
      if (effort !== undefined) body['reasoning_effort'] = effort
    }
    if (options.maxTokens !== undefined) body['max_tokens'] = options.maxTokens
    const wireTools = toWireTools(options.tools)
    if (wireTools !== undefined) body['tools'] = wireTools
    applyResponseFormat(body, this.id, options)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const key = this.apiKeyOrNull(options)
    if (key !== null) headers['Authorization'] = `Bearer ${key}`

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: completionSignal(options.signal, options.timeoutMs ?? resolveCompletionTimeoutMs()),
      })
    }
    catch (err) {
      throw providerTransportError(
        this.id,
        `[llm-router] local model request to ${this.baseUrl} failed`,
        err,
      )
    }

    if (!res.ok) {
      throw await providerErrorFromResponse(this.id, 'local model', res)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } & Record<string, unknown> }>
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
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
        }
        : undefined,
      provider: this.id,
      model: options.model,
      requestBody: body,
    }
  }
}
