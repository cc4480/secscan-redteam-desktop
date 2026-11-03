/**
 * The `meta` provider adapter: Meta's Muse models as a first-class harness
 * provider, wired the way every other provider is wired — an
 * {@link LlmAdapter} registered with `ctx.llm`, so the Host model catalog
 * (`session/modelCatalog`) lists it and session routing dispatches through
 * it. This is the desktop chat path's Meta wire; the engagement runner has
 * its own Meta provider in `@secscan/redteam-llm-router`, and the two share
 * only the model ids, endpoint, and credential reference declared in
 * `./models.ts`.
 *
 * Catalog membership is unconditional: the four models are listed whether
 * or not a key is seated. Dispatch is the gated half — the key is resolved
 * per request through the injected resolver (the plugin resolves it through
 * the credentials service, env-ref `MODEL_API_KEY`), and a call with no
 * usable key fails with `MISSING_CREDENTIAL` naming the seating, exactly as
 * the DeepSeek route behaves, rather than dispatching unauthenticated or
 * pretending success.
 */

import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  RequestMessage,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import {
  META_API_KEY_ENV,
  META_BASE_URL,
  META_BASE_URL_ENV,
  META_MODELS,
  META_PROVIDER_NAME,
} from './models.ts'

/** Injectable adapter seams; production passes only the key resolver. */
export interface MetaAdapterDeps {
  /** Explicit Meta Model API base URL; wins over the environment resolution. */
  readonly baseUrl?: string
  /** Environment the base URL resolves from. */
  readonly environment?: NodeJS.ProcessEnv
  /** Fetch implementation for the Meta endpoint. */
  readonly fetchImpl?: typeof fetch
  /**
   * Resolve the current API key, once per request. Returns `undefined`
   * while no key is seated; the adapter turns that into the named
   * `MISSING_CREDENTIAL` failure. When omitted, the key is read from the
   * environment under {@link META_API_KEY_ENV} (the router's seating).
   */
  readonly resolveApiKey?: () => Promise<string | undefined>
}

/**
 * Read a signal's aborted state. A function call on purpose: the state
 * changes asynchronously while a request is in flight, so a direct
 * property check after an earlier one would be narrowed to a stale value.
 * @param signal - the request's cancellation signal, when one was supplied.
 * @returns whether the signal has aborted by now.
 */
function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** One OpenAI-compatible chat message, as the Meta endpoint accepts it. */
type WireMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | {
    readonly role: 'assistant'
    readonly content: string | null
    readonly tool_calls?: readonly WireToolCall[]
  }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string }

/** One OpenAI-compatible tool call on an assistant wire message. */
interface WireToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

/**
 * Concatenate the text an endpoint can read from one message's blocks.
 * Non-text blocks become short bracketed stand-ins: request admission
 * handles attachments before dispatch, and a stand-in is only the
 * defensive residue for a block the wire cannot carry.
 * @param blocks - the message's content blocks.
 * @returns the concatenated text.
 */
function blockText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'image':
        parts.push('[image attachment]')
        break
      case 'file':
        parts.push('[file attachment]')
        break
      default:
        break
    }
  }
  return parts.join('')
}

/**
 * Translate the harness request history into OpenAI-compatible messages.
 * System and developer text collapses into one leading system message,
 * preserving order; assistant tool calls become wire `tool_calls`; tool
 * results become `tool` messages keyed by their call id.
 * @param options - the fully-assembled request.
 * @returns the wire messages in request order.
 */
export function toWireMessages(options: GenerateOptions): WireMessage[] {
  const systemTexts: string[] = []
  if (options.system !== undefined && options.system !== '') systemTexts.push(options.system)
  const messages: WireMessage[] = []
  for (const message of options.messages as readonly RequestMessage[]) {
    switch (message.role) {
      case 'system':
      case 'developer': {
        const text = blockText(message.content)
        if (text !== '') systemTexts.push(text)
        break
      }
      case 'user':
        messages.push({ role: 'user', content: blockText(message.content) })
        break
      case 'assistant': {
        const textParts: string[] = []
        const toolCalls: WireToolCall[] = []
        for (const block of message.content) {
          if (block.type === 'text') textParts.push(block.text)
          else if (block.type === 'tool-call') {
            toolCalls.push({
              id: String(block.id),
              type: 'function',
              function: { name: block.name, arguments: block.arguments },
            })
          }
        }
        const text = textParts.join('')
        messages.push({
          role: 'assistant',
          content: text === '' && toolCalls.length > 0 ? null : text,
          ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
        })
        break
      }
      case 'tool':
        messages.push({
          role: 'tool',
          tool_call_id: String(message.toolCallId),
          content: blockText(message.content),
        })
        break
    }
  }
  if (systemTexts.length > 0) messages.unshift({ role: 'system', content: systemTexts.join('\n\n') })
  return messages
}

/** Accumulated state of one in-flight streamed block. */
interface BlockAssembly {
  readonly index: number
  readonly kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  toolId: string
  toolName: string
  toolArguments: string
  /** Wire tool-call index for tool-call blocks, so its mapping can retire on close. */
  wireIndex?: number
}

/**
 * The harness adapter for the Meta Model API. Stateless across calls: the
 * key is re-resolved on every dispatch, so a key seated or rotated after
 * the Host booted reaches the next request without a restart.
 */
export class MetaAdapter extends LlmAdapter {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly resolveApiKey: () => Promise<string | undefined>

  /**
   * @param deps - injectable base URL, environment, fetch, and key-resolver
   * seams; production passes the plugin's credentials-backed resolver.
   */
  constructor(deps: MetaAdapterDeps = {}) {
    super()
    const environment = deps.environment ?? process.env
    // Blank-but-present env guard, same as the router's Meta provider: a
    // blank META_BASE_URL= means "use the default", so resolve with
    // || / trim, never ??.
    const fromEnv = environment[META_BASE_URL_ENV]?.trim()
    this.baseUrl = (deps.baseUrl?.trim() || fromEnv || META_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.resolveApiKey = deps.resolveApiKey ?? (() => Promise.resolve(environment[META_API_KEY_ENV]))
  }

  /** @returns the Meta Model API base URL this adapter dispatches to. */
  baseUrlValue(): string {
    return this.baseUrl
  }

  /**
   * Describe the `meta` route.
   * @param provider - the registered route.
   * @returns the provider's display metadata.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: META_PROVIDER_NAME }
  }

  /**
   * List the Meta models. The list is static and unconditional: it is
   * never gated on a seated key, so the picker offers the group before
   * the operator seats one, and dispatch reports the missing key.
   * @param provider - the registered route.
   * @returns the pickable Meta models in catalog order.
   */
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(META_MODELS.map(model => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: ['text', 'image'] as const,
    })))
  }

  /**
   * Resolve one Meta model's metadata: its picker label and, where the
   * codebase already states one, its context capacity.
   * @param provider - the registered route.
   * @param model - the model id.
   * @returns the resolved model metadata.
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const entry = META_MODELS.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: entry === undefined ? model : entry.name,
      inputModalities: ['text', 'image'] as const,
      ...entry?.contextWindow === undefined ? {} : { context: { contextWindow: entry.contextWindow } },
    })
  }

  /**
   * Stream one call to the Meta Model API. The credential gate runs
   * first: with no usable key the call fails `MISSING_CREDENTIAL` and
   * the endpoint is never touched. The key is sent only as the
   * `Authorization` header — never in a log, error, or request field.
   * @param options - the fully-assembled request.
   * @returns the raw chunk stream.
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const key = await this.resolveApiKey()
    if (key === undefined || key.trim() === '') {
      throw new LlmError(
        `llm-meta: no API key for provider route "meta"; store ${META_API_KEY_ENV} through the credentials`
        + ` service (the web Models page writes it), or export ${META_API_KEY_ENV} in the launching environment`,
        'MISSING_CREDENTIAL',
      )
    }

    if (options.signal?.aborted === true) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the Meta model request was aborted before dispatch', code: 'ABORTED' } } }
      return
    }

    const effort = options.reasoningEffort
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          ...attributionHeaders(),
        },
        body: JSON.stringify({
          model: options.model,
          messages: toWireMessages(options),
          stream: true,
          stream_options: { include_usage: true },
          ...effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh'
            ? { reasoning_effort: effort }
            : {},
          ...options.tools !== undefined && options.tools.length > 0
            ? {
              tools: options.tools.map(tool => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
              })),
            }
            : {},
          ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
          ...options.temperature === undefined ? {} : { temperature: options.temperature },
          ...options.stop === undefined ? {} : { stop: options.stop },
        }),
        signal: options.signal,
      })
    } catch (error) {
      if (signalAborted(options.signal)) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the Meta model request was aborted', code: 'ABORTED' } } }
        return
      }
      throw new LlmError(
        `The Meta Model API at ${this.baseUrl} did not answer: `
        + `${error instanceof Error ? error.message : String(error)}.`,
        'META_ENDPOINT_UNREACHABLE',
      )
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500)
      throw new LlmError(
        `The Meta Model API answered HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`,
        'META_REQUEST_FAILED',
        { status: response.status },
      )
    }
    if (response.body === null) {
      throw new LlmError('The Meta Model API returned no stream body.', 'META_REQUEST_FAILED')
    }

    yield* this.readStream(response.body, options.signal)
  }

  /**
   * Translate the endpoint's SSE stream into the harness chunk vocabulary:
   * reasoning and text deltas, tool-call deltas keyed by the wire tool
   * index, usage ahead of the terminal finish. An abort mid-stream closes
   * the blocks assembled so far and finishes as aborted.
   * @param body - the response body stream.
   * @param signal - the request's cancellation signal.
   * @returns the translated chunk stream.
   */
  private async *readStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let nextIndex = 0
    let open: BlockAssembly | undefined
    let currentText: BlockAssembly | undefined
    let currentReasoning: BlockAssembly | undefined
    const toolBlocks = new Map<number, BlockAssembly>()
    let usage: TokenUsage | undefined
    let finishReason: string | null = null
    let aborted = false

    /**
     * Close the open block, if any.
     * @returns the block-end chunk to emit, or an empty list when nothing is open.
     */
    const endBlock = (): StreamChunk[] => {
      if (open === undefined) return []
      const block = open
      open = undefined
      // A kind that resumes after another kind intervened opens a fresh
      // block: retire this block's delta routing before closing it.
      if (currentReasoning === block) currentReasoning = undefined
      if (currentText === block) currentText = undefined
      if (block.wireIndex !== undefined) toolBlocks.delete(block.wireIndex)
      if (block.kind === 'tool-call') {
        return [{
          type: 'block-end',
          index: block.index,
          block: {
            type: 'tool-call',
            id: ToolCallId(block.toolId === '' ? `call_${block.index}` : block.toolId),
            name: block.toolName,
            arguments: block.toolArguments,
          },
        }]
      }
      return [{
        type: 'block-end',
        index: block.index,
        block: { type: block.kind, text: block.text },
      }]
    }

    /**
     * Open the next block of one kind, closing the currently open one.
     * @param kind - the block kind to open.
     * @returns the new block and the chunks to emit (the previous block's end, then this start).
     */
    const beginBlock = (kind: BlockAssembly['kind']): { block: BlockAssembly; chunks: StreamChunk[] } => {
      const chunks = endBlock()
      const block: BlockAssembly = { index: nextIndex, kind, text: '', toolId: '', toolName: '', toolArguments: '' }
      nextIndex += 1
      open = block
      chunks.push({ type: 'block-start', index: block.index, blockType: kind })
      return { block, chunks }
    }

    try {
      let buffer = ''
      let done = false
      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (readerDone) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (!line.startsWith('data:')) continue
          const payload = line.slice('data:'.length).trim()
          if (payload === '[DONE]') {
            done = true
            break
          }
          let chunk: unknown
          try {
            chunk = JSON.parse(payload)
          } catch {
            // A malformed SSE line carries no model output; the stream
            // continues and the terminal state still settles the call.
            continue
          }
          if (typeof chunk !== 'object' || chunk === null) continue
          const record = chunk as Record<string, unknown>

          const rawUsage = record['usage']
          if (typeof rawUsage === 'object' && rawUsage !== null) {
            const counts = rawUsage as Record<string, unknown>
            const prompt = counts['prompt_tokens']
            const completion = counts['completion_tokens']
            const total = counts['total_tokens']
            if (typeof prompt === 'number' && typeof completion === 'number') {
              const details = counts['prompt_tokens_details']
              const cached = typeof details === 'object' && details !== null
                ? (details as Record<string, unknown>)['cached_tokens']
                : undefined
              usage = {
                inputTokens: prompt,
                outputTokens: completion,
                ...typeof total === 'number' ? { totalTokens: total } : {},
                ...typeof cached === 'number' ? { cacheReadTokens: cached } : {},
              }
            }
          }

          const choices = record['choices']
          if (!Array.isArray(choices) || choices.length === 0) continue
          const first = choices[0] as Record<string, unknown>
          const delta = typeof first['delta'] === 'object' && first['delta'] !== null
            ? first['delta'] as Record<string, unknown>
            : {}
          const reason = first['finish_reason']
          if (typeof reason === 'string') finishReason = reason

          const reasoning = delta['reasoning_content']
          if (typeof reasoning === 'string' && reasoning !== '') {
            if (currentReasoning === undefined) {
              const begun = beginBlock('reasoning')
              yield* begun.chunks
              currentReasoning = begun.block
            }
            currentReasoning.text += reasoning
            yield { type: 'reasoning-delta', index: currentReasoning.index, text: reasoning }
          }

          const content = delta['content']
          if (typeof content === 'string' && content !== '') {
            if (currentText === undefined) {
              const begun = beginBlock('text')
              yield* begun.chunks
              currentText = begun.block
            }
            currentText.text += content
            yield { type: 'text-delta', index: currentText.index, text: content }
          }

          const toolCalls = delta['tool_calls']
          if (Array.isArray(toolCalls)) {
            for (const rawCall of toolCalls) {
              if (typeof rawCall !== 'object' || rawCall === null) continue
              const call = rawCall as Record<string, unknown>
              const wireIndex = typeof call['index'] === 'number' ? call['index'] : toolBlocks.size
              let block = toolBlocks.get(wireIndex)
              if (block === undefined) {
                const begun = beginBlock('tool-call')
                yield* begun.chunks
                block = begun.block
                block.wireIndex = wireIndex
                toolBlocks.set(wireIndex, block)
              }
              const id = call['id']
              if (typeof id === 'string' && id !== '') block.toolId = id
              const fn = typeof call['function'] === 'object' && call['function'] !== null
                ? call['function'] as Record<string, unknown>
                : {}
              const name = fn['name']
              if (typeof name === 'string' && name !== '') block.toolName = name
              const args = fn['arguments']
              const argsDelta = typeof args === 'string' ? args : ''
              block.toolArguments += argsDelta
              yield {
                type: 'tool-call-delta',
                index: block.index,
                id: ToolCallId(block.toolId === '' ? `call_${wireIndex}` : block.toolId),
                ...block.toolName === '' ? {} : { name: block.toolName },
                argumentsDelta: argsDelta,
              }
            }
          }
        }
      }
    } catch (error) {
      if (signalAborted(signal)) {
        aborted = true
      } else {
        throw new LlmError(
          `The Meta model stream failed: ${error instanceof Error ? error.message : String(error)}`,
          'META_STREAM_FAILED',
        )
      }
    } finally {
      reader.releaseLock()
    }

    yield* endBlock()
    if (usage !== undefined) yield { type: 'usage', usage }
    if (aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the Meta model request was aborted', code: 'ABORTED' } } }
      return
    }
    switch (finishReason) {
      case 'tool_calls':
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        break
      case 'length':
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        break
      default:
        yield { type: 'finish', reason: { kind: 'stop' } }
        break
    }
  }
}
