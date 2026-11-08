/**
 * Anthropic provider — Claude models on the Anthropic Messages API,
 * the fleet's one NATIVE wire (POST {baseUrl}/messages): the Messages
 * API is not OpenAI-compatible, so this provider carries its own
 * translation instead of reusing openai-wire:
 *   - router `system` messages concatenate into the top-level `system`
 *     field (the Messages API has no system role inside `messages`);
 *   - router tools become `{ name, description, input_schema }`;
 *   - assistant tool calls become `tool_use` content blocks and tool
 *     results become `tool_result` blocks inside a `user` message
 *     (consecutive same-role turns are merged — the API requires
 *     alternating roles);
 *   - the router's reasoning-effort hint becomes an extended-thinking
 *     budget (`thinking: { type: 'enabled', budget_tokens }`); while
 *     thinking is on, `temperature` is omitted (the API accepts only
 *     the default alongside thinking) and `max_tokens` is raised above
 *     the budget, as the API requires;
 *   - response blocks parse back: `text` → text, `thinking` →
 *     reasoning, `tool_use` → tool calls.
 * The tool-pairing invariant is enforced with the same
 * sanitizeToolPairing the OpenAI-wire providers use, so a severed
 * tool group is repaired before send, never shipped to a 400.
 * Calls are non-streaming, like every provider in this router (the
 * LlmProvider contract returns one ChatResult); the default
 * max_tokens stays far below the size at which the API requires
 * streaming.
 *
 * Structured output (CompleteOptions.responseFormat) is REFUSED here,
 * loudly, before any fetch: on this wire a schema constraint rides a
 * tool block, which the caller supplies as tools — a bare format with
 * no tools has no honest translation, and a silent drop is the one
 * forbidden outcome (the openai-wire doctrine, applied natively).
 *
 * Models (IDs verified against Anthropic's published model list,
 * Nov 2026 — fix these constants, never the call sites, if the API
 * disagrees):
 *   - claude-opus-5-5 — the hard-reasoning/agentic tier. The thinking
 *     seat.
 *   - claude-sonnet-5-5 — the speed/intelligence balance. The volume
 *     seats.
 *   - claude-haiku-5-5 — the high-volume latency tier. The recon seat.
 *   - claude-fable-5-1 — the most capable tier; registered for
 *     explicit calls and A/B lanes, not seated by default.
 *
 * Auth: ANTHROPIC_API_KEY env var (the credential ref the Models page
 * derives for the `anthropic` route, so one seated key serves chat +
 * fleet), sent in the `x-api-key` header with `anthropic-version`.
 * Override the endpoint with ANTHROPIC_BASE_URL. The key is never
 * logged, never included in errors, and never written anywhere.
 */

import type {
  ChatMessage,
  ChatResult,
  CompleteOptions,
  LlmProvider,
  ToolCallRequest,
} from '../types.js'
import { sanitizeToolPairing } from './openai-wire.js'
import { fleetValue } from '../resolver.js'
import { providerErrorFromResponse, providerTransportError } from '../errors.js'
import { completionSignal, resolveCompletionTimeoutMs } from '../timeout.js'

export const ANTHROPIC_PROVIDER_ID = 'anthropic'
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY'
export const ANTHROPIC_BASE_URL_ENV = 'ANTHROPIC_BASE_URL'
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'
/** Messages API version header (current stable, verified Nov 2026). */
export const ANTHROPIC_VERSION = '2023-06-01'

export const ANTHROPIC_MODELS = {
  /** Hard-reasoning / agentic tier. The exploiter's engine on the Anthropic seats. */
  opus: 'claude-opus-5-5',
  /** Speed/intelligence balance. The volume seats. */
  sonnet: 'claude-sonnet-5-5',
  /** High-volume latency tier. The recon seat. */
  haiku: 'claude-haiku-5-5',
  /** Most capable tier. Registered for explicit calls and A/B lanes; not seated by default. */
  fable: 'claude-fable-5-1',
} as const

/** Router hint → extended-thinking budget tokens. */
const THINKING_BUDGETS: Record<'low' | 'medium' | 'high', number> = {
  low: 2048,
  medium: 8192,
  high: 32768,
}

/** One Messages-API content block (the shapes this translation emits and reads). */
type WireBlock = Record<string, unknown>

/** One Messages-API message: a role plus string or block content. */
interface WireMessage {
  role: 'user' | 'assistant'
  content: string | WireBlock[]
}

/**
 * Translate router messages into Messages-API messages. System
 * messages are the caller's job (they leave via the top-level field);
 * everything else converts here, with tool results folded into user
 * turns and consecutive same-role turns merged.
 * @param messages - Router messages with system turns already removed.
 * @returns Messages-API messages, alternating user/assistant.
 */
function toWireMessages(messages: ChatMessage[]): WireMessage[] {
  const repaired = sanitizeToolPairing(messages).messages
  const out: WireMessage[] = []
  const push = (role: 'user' | 'assistant', blocks: WireBlock[]): void => {
    const last = out[out.length - 1]
    if (last !== undefined && last.role === role && Array.isArray(last.content)) {
      last.content.push(...blocks)
      return
    }
    out.push({ role, content: blocks })
  }
  for (const m of repaired) {
    if (m.role === 'tool') {
      push('user', [{
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
      }])
      continue
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: WireBlock[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const call of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments ?? {} })
      }
      push('assistant', blocks)
      continue
    }
    if (m.role === 'assistant') {
      push('assistant', [{ type: 'text', text: m.content }])
      continue
    }
    // user (system turns were removed by the caller)
    push('user', [{ type: 'text', text: m.content }])
  }
  // A lone text block per message collapses to the plain string form.
  return out.map(m =>
    Array.isArray(m.content) && m.content.length === 1 && m.content[0]?.['type'] === 'text'
      ? { role: m.role, content: m.content[0]['text'] as string }
      : m,
  )
}

export class AnthropicProvider implements LlmProvider {
  readonly id = ANTHROPIC_PROVIDER_ID
  readonly label = 'Anthropic (Claude)'
  private readonly baseUrl: string

  constructor(baseUrl?: string) {
    // Blank-but-present env guard, same as the Meta provider: a blank
    // ANTHROPIC_BASE_URL= means "use the default", so resolve with
    // || / trim, never ??.
    const fromEnv = process.env[ANTHROPIC_BASE_URL_ENV]?.trim()
    this.baseUrl = (baseUrl?.trim() || fromEnv || ANTHROPIC_BASE_URL).replace(/\/+$/, '')
  }

  isConfigured(): boolean {
    return !!this.apiKeyOrNull()
  }

  private apiKeyOrNull(): string | null {
    // Resolved per call through the fleet resolver (launching environment
    // by default, the app credentials store when the host installs one),
    // so a key seated or rotated after startup reaches the next dispatch.
    const key = fleetValue(ANTHROPIC_API_KEY_ENV)?.trim()
    return key ? key : null
  }

  private apiKey(options?: CompleteOptions): string {
    // The resilience pool's per-attempt credential wins over the env vars;
    // the env vars alone remain the path for unwrapped direct use.
    const key = options?.apiKey ?? this.apiKeyOrNull()
    if (!key) {
      throw new Error(
        `[llm-router] ${ANTHROPIC_API_KEY_ENV} is set nowhere the fleet can read it. ` +
          'Seat an Anthropic API key in Settings → Models (it is stored under the ' +
          `${ANTHROPIC_API_KEY_ENV} credential ref, never in the environment). ` +
          'The key is never stored in code or docs.',
      )
    }
    return key
  }

  async complete(options: CompleteOptions): Promise<ChatResult> {
    // Structured output on this wire rides a tool block; a bare format
    // with no tools has no honest translation — refuse before any fetch
    // rather than silently drop it (see the header).
    if (options.responseFormat && (!options.tools || options.tools.length === 0)) {
      throw new Error(
        `[llm-router] provider '${this.id}' does not support response_format ` +
          `${options.responseFormat.type} without tools. On the Messages API a schema ` +
          'constraint rides a tool block — pass the schema as a tool, or choose another provider.',
      )
    }

    const system = options.messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n')
    const body: Record<string, unknown> = {
      model: options.model,
      messages: toWireMessages(options.messages.filter(m => m.role !== 'system')),
    }
    if (system) body['system'] = system

    const budget = options.reasoningEffort ? THINKING_BUDGETS[options.reasoningEffort] : undefined
    if (budget !== undefined) {
      body['thinking'] = { type: 'enabled', budget_tokens: budget }
      // The API requires max_tokens above the thinking budget.
      body['max_tokens'] = Math.max(options.maxTokens ?? 0, budget + 8192)
    } else {
      body['max_tokens'] = options.maxTokens ?? 8192
      if (options.temperature !== undefined) body['temperature'] = options.temperature
      else body['temperature'] = 0.2
    }
    if (options.topP !== undefined && budget === undefined) body['top_p'] = options.topP
    if (options.tools && options.tools.length > 0) {
      body['tools'] = options.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The raw key lives only in this header — never in logs or errors.
          'x-api-key': this.apiKey(options),
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: completionSignal(options.signal, options.timeoutMs ?? resolveCompletionTimeoutMs()),
      })
    } catch (err) {
      throw providerTransportError(this.id, '[llm-router] Anthropic request failed', err)
    }

    if (!res.ok) {
      // Never echo the key; the ProviderError carries status + provider
      // code + reset hints for the classifier (the Messages error body's
      // error.type lands in `code` via the shared builder).
      throw await providerErrorFromResponse(this.id, 'Anthropic', res)
    }

    const data = (await res.json()) as {
      content?: Array<Record<string, unknown>>
      usage?: { input_tokens: number; output_tokens: number }
    }
    let text = ''
    let reasoning: string | undefined
    const toolCalls: ToolCallRequest[] = []
    for (const block of data.content ?? []) {
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        text += block['text']
      } else if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
        reasoning = (reasoning ?? '') + block['thinking']
      } else if (block['type'] === 'tool_use') {
        toolCalls.push({
          id: (block['id'] as string) ?? `call_${toolCalls.length}`,
          name: (block['name'] as string) ?? 'unknown',
          arguments: (block['input'] as Record<string, unknown>) ?? {},
        })
      }
    }

    return {
      text,
      reasoning,
      toolCalls,
      usage: data.usage
        ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        }
        : undefined,
      provider: this.id,
      model: options.model,
      requestBody: body,
    }
  }
}
