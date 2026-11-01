/**
 * Core types for the provider-pluggable LLM router.
 *
 * A provider implements `LlmProvider.complete()`. The router dispatches by
 * provider id; adding Claude / ChatGPT / Gemini / GLM / Qwen later means
 * writing one new class against this interface and calling
 * `registerProvider()` — no changes to agents or the harness plugin.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** For tool messages: the id of the call being answered. */
  toolCallId?: string
  /**
   * For assistant messages that requested tool calls: the calls themselves.
   * OpenAI-compatible APIs (DeepSeek, Qwen) REQUIRE that any `tool` message be
   * preceded by an assistant message carrying these — otherwise the request is
   * rejected ("Messages with role 'tool' must be a response to a preceding
   * message with 'tool_calls'"). Must round-trip into the wire `tool_calls`
   * field, with ids matching the following tool messages' toolCallId.
   */
  toolCalls?: ToolCallRequest[]
}

export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatResult {
  /** Assistant text (may be empty when the turn is pure tool calls). */
  text: string
  /**
   * The model's thinking trace, when the provider exposes one (Qwen
   * `reasoning_content`, DeepSeek reasoner). Surfaced separately so the
   * harness can log it without polluting the visible reply.
   */
  reasoning?: string
  /** Tool calls the model requested this turn. */
  toolCalls: ToolCallRequest[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    /**
     * Prompt tokens served from the provider's prompt cache, when the wire
     * reports the split (a subset of promptTokens). Absent when the provider
     * does not break cached tokens out — never estimated.
     */
    cacheReadTokens?: number
  }
  provider: string
  model: string
  /** Exact provider request body (credentials travel in headers, never here). */
  requestBody?: Record<string, unknown>
  /** Provider response payload as received. */
  rawResponse?: unknown
}

export interface JsonSchemaTool {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

/**
 * Structured-output constraint for one call. Selection (deepseek-recipe): when a
 * call carries tools, the tool block is the constraint; otherwise the caller's
 * chosen responseFormat is. The format variants are caller choices, not a ranked
 * cascade — per-provider support for each variant is recorded in
 * providers/openai-wire.ts (RESPONSE_FORMAT_SUPPORT).
 */
export type ResponseFormat =
  | { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict?: boolean }
  | { type: 'regex'; pattern: string }
  | { type: 'json_object' }

export interface CompleteOptions {
  model: string
  messages: ChatMessage[]
  /**
   * Credential override supplied by the resilience layer's credential pool
   * (see resilience.ts). Providers prefer it over their key env var when
   * set. It travels only into the Authorization header — never into request
   * bodies, trajectory logs, or error messages.
   */
  apiKey?: string
  tools?: JsonSchemaTool[]
  /** Hint only; providers may ignore it. */
  reasoningEffort?: 'low' | 'medium' | 'high'
  signal?: AbortSignal
  /** Hard completion deadline (ms); defaults to resolveCompletionTimeoutMs(). */
  timeoutMs?: number
  maxTokens?: number
  temperature?: number
  topP?: number
  responseFormat?: ResponseFormat
  role?: AgentRole
  runId?: string
}

export interface LlmProvider {
  /** Stable id, e.g. "deepseek". Used as the routing key. */
  readonly id: string
  /** Human label, e.g. "DeepSeek". */
  readonly label: string
  /** True when the provider can be used (e.g. its API key env var is set). */
  isConfigured(): boolean
  complete(options: CompleteOptions): Promise<ChatResult>
}

/** Agent roles the red-team uses. */
export type AgentRole = 'coordinator' | 'recon' | 'exploiter' | 'reporter' | 'architect'

export interface RoleRoute {
  provider: string
  model: string
  reasoningEffort?: 'low' | 'medium' | 'high'
}
