/**
 * OpenAI-compatible wire translation shared by every provider that speaks the
 * `POST {baseUrl}/chat/completions` shape: the hosted Qwen (DashScope) provider
 * and the local llama.cpp / Ollama provider.
 *
 * Kept in one place so the two providers cannot drift on the tool-call
 * round-trip, which is the part that breaks agent loops when it is wrong.
 */

import type { ChatMessage, CompleteOptions, JsonSchemaTool, ResponseFormat, ToolCallRequest } from '../types.js'

/** Translate router messages into the OpenAI wire form. */
export function toWireMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content }
    }
    // Assistant tool-call turns must round-trip their tool_calls, or the
    // following tool messages are rejected by the OpenAI-compatible API.
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content ?? '',
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        })),
      }
    }
    return { role: m.role, content: m.content }
  })
}

/** Translate router tools into the OpenAI `tools` array, or undefined when there are none. */
export function toWireTools(tools?: JsonSchemaTool[]): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

/**
 * Per-provider support for `CompleteOptions.responseFormat`, keyed by provider id.
 *
 * States: 'send' (support evidenced), 'send-unverified' (the provider's
 * OpenAI-compatible surface claims it; no in-tree proof yet), 'degrade' (a
 * json_schema request is sent as json_object — the exact body sent is returned
 * on `ChatResult.requestBody`, so the degradation is provable from any call
 * record), 'refuse' (known-unsupported: applyResponseFormat throws before any
 * fetch; a silent drop is the one forbidden outcome). A state flips to 'send'
 * only on live-call evidence, never by assumption. A provider id with no entry
 * gets the generic OpenAI-compatible posture below.
 */
export type ResponseFormatSupport = 'send' | 'send-unverified' | 'degrade' | 'refuse'

export const RESPONSE_FORMAT_SUPPORT: Record<string, Record<ResponseFormat['type'], ResponseFormatSupport>> = {
  meta: { json_object: 'send-unverified', json_schema: 'degrade', regex: 'refuse' },
  deepseek: { json_object: 'send', json_schema: 'refuse', regex: 'refuse' },
  qwen: { json_object: 'send-unverified', json_schema: 'degrade', regex: 'refuse' },
  local: { json_object: 'send', json_schema: 'send', regex: 'refuse' },
}

const GENERIC_OPENAI_SUPPORT: Record<ResponseFormat['type'], ResponseFormatSupport> = {
  json_object: 'send-unverified',
  json_schema: 'degrade',
  regex: 'refuse',
}

/**
 * Translate the caller's structured-output constraint into the body's
 * `response_format` field, per RESPONSE_FORMAT_SUPPORT. Mutates `body`.
 * No-ops when the call carries no format, and when it carries tools — the
 * recipe's constraint selection: with tools present, the tool block is the
 * constraint and no response_format is sent. Throws (before any fetch) when
 * the provider's recorded support for the requested format is 'refuse', and
 * for `regex`, which has no OpenAI-compatible wire form in this translation.
 */
export function applyResponseFormat(
  body: Record<string, unknown>,
  providerId: string,
  options: CompleteOptions,
): void {
  const format = options.responseFormat
  if (!format) return
  if (options.tools && options.tools.length > 0) return
  const support = (RESPONSE_FORMAT_SUPPORT[providerId] ?? GENERIC_OPENAI_SUPPORT)[format.type]
  if (support === 'refuse') {
    throw new Error(
      `[llm-router] provider '${providerId}' does not support response_format ${format.type}. ` +
        'Choose another constraint (tool block > JSON > schema > regex) or another provider.',
    )
  }
  if (format.type === 'json_object') {
    body['response_format'] = { type: 'json_object' }
    return
  }
  if (format.type === 'json_schema') {
    if (support === 'degrade') {
      body['response_format'] = { type: 'json_object' }
      return
    }
    body['response_format'] = {
      type: 'json_schema',
      json_schema: {
        name: format.name,
        schema: format.schema,
        ...(format.strict !== undefined ? { strict: format.strict } : {}),
      },
    }
    return
  }
  // format.type === 'regex': every recorded state is 'refuse' today, so this
  // is unreachable with the shipped table; it guards a future 'send' entry
  // from silently becoming json_object.
  throw new Error(
    `[llm-router] provider '${providerId}' has no wire form for response_format regex in this translation. ` +
      'Choose another constraint (tool block > JSON > schema > regex) or another provider.',
  )
}

/** Read tool calls out of one OpenAI-compatible choice message. */
export function fromWireToolCalls(choice: Record<string, unknown>): ToolCallRequest[] {
  const calls = (choice['tool_calls'] as Array<Record<string, unknown>> | undefined) ?? []
  return calls.map((c, i) => {
    const fn = (c['function'] as Record<string, unknown>) ?? {}
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse((fn['arguments'] as string) ?? '{}') as Record<string, unknown>
    } catch {
      args = { _raw: fn['arguments'] }
    }
    return {
      id: (c['id'] as string) ?? `call_${i}`,
      name: (fn['name'] as string) ?? 'unknown',
      arguments: args,
    }
  })
}
