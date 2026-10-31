/**
 * OpenAI-compatible wire translation shared by every provider that speaks the
 * `POST {baseUrl}/chat/completions` shape: the hosted Qwen (DashScope) provider
 * and the local llama.cpp / Ollama provider.
 *
 * Kept in one place so the two providers cannot drift on the tool-call
 * round-trip, which is the part that breaks agent loops when it is wrong.
 */

import type { ChatMessage, JsonSchemaTool, ToolCallRequest } from '../types.js'

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
