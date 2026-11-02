/**
 * The `local` provider adapter: the desktop's downloaded GGUF models as a
 * first-class harness provider, wired the way every other provider is wired
 * — an {@link LlmAdapter} registered with `ctx.llm`, so the Host model
 * catalog (`session/modelCatalog`) lists it and session routing dispatches
 * through it.
 *
 * Catalog membership is a fact about the registry, not about the server:
 * a downloaded model is listed whether or not llama-server is currently
 * running. Dispatch is the gated half. The bundled server is owned by the
 * desktop's llama service (Electron main), and no Host-to-main channel can
 * start it, so a call that finds the server stopped, starting, failed, or
 * serving a different model fails with one honest error naming the exact
 * in-app action — the Local Models window's "Start server" button — rather
 * than dispatching to a dead endpoint or pretending success.
 */

import { existsSync } from 'node:fs'
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
  localModelLabel,
  readLocalModelsDirectory,
  resolveLocalDispatch,
  resolveLocalModelsDirectory,
  type LocalModelsDirectoryState,
} from './state.ts'

/** Provider route this adapter owns in the harness LLM registry. */
export const LOCAL_PROVIDER_ID = 'local'

/** Display name of the provider group in the model catalog. */
export const LOCAL_PROVIDER_NAME = 'Local'

/** Injectable adapter seams; production passes nothing. */
export interface LocalAdapterDeps {
  /** Explicit models directory; wins over the environment resolution. */
  readonly modelsDir?: string
  /** Environment the models directory resolves from. */
  readonly environment?: NodeJS.ProcessEnv
  /** Fetch implementation for the loopback endpoint. */
  readonly fetchImpl?: typeof fetch
  /** File-existence check for registry paths. */
  readonly fileExists?: (path: string) => boolean
}

/** The one in-app action every stopped-server error names. */
const START_ACTION = 'open Local Models and press "Start server"'

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

/** One OpenAI-compatible chat message, as the llama endpoint accepts it. */
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
 * Non-text blocks become short bracketed stand-ins: the local route
 * declares text-only input, so request admission refuses images before
 * dispatch names this route, and a stand-in is only the defensive residue.
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
        parts.push('[image attachment — not sent: the local model route is text-only]')
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
 * System and developer text collapses into one leading system message —
 * the llama chat templates accept a system turn only there — preserving
 * order; assistant tool calls become wire `tool_calls`; tool results
 * become `tool` messages keyed by their call id.
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
 * The harness adapter for the desktop's local models. Stateless across
 * calls: every operation re-reads the models directory, so downloads,
 * selection changes, and server transitions the desktop publishes are
 * visible to the next catalog load or dispatch without a restart.
 */
export class LocalLlamaAdapter extends LlmAdapter {
  private readonly directory: string
  private readonly fetchImpl: typeof fetch
  private readonly fileExists: (path: string) => boolean

  /**
   * @param deps - injectable directory, environment, fetch, and
   * file-existence seams; production passes nothing.
   */
  constructor(deps: LocalAdapterDeps = {}) {
    super()
    this.directory = resolveLocalModelsDirectory(deps.environment ?? process.env, deps.modelsDir)
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.fileExists = deps.fileExists ?? existsSync
  }

  /** @returns the models directory this adapter reads. */
  modelsDirectory(): string {
    return this.directory
  }

  /**
   * Read the current directory state, narrowing the registry to models
   * whose GGUF is actually on disk.
   * @returns the directory state with downloadable-absent entries removed.
   */
  private snapshot(): LocalModelsDirectoryState {
    const state = readLocalModelsDirectory(this.directory)
    return { ...state, models: state.models.filter(model => this.fileExists(model.path)) }
  }

  /**
   * Describe the `local` route.
   * @param provider - the registered route.
   * @returns the provider's display metadata.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: LOCAL_PROVIDER_NAME }
  }

  /**
   * List the registry's downloaded models, the operator's active model
   * first. Presence is a registry fact: the server's state is never
   * consulted here, so a stopped server cannot hide a downloaded model.
   * @param provider - the registered route.
   * @returns the pickable local models in display order.
   */
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const { models, settings } = this.snapshot()
    const ordered = [...models].sort((left, right) => {
      if (left.id === settings.activeModelId) return -1
      if (right.id === settings.activeModelId) return 1
      return 0
    })
    return Promise.resolve(ordered.map(model => ({
      provider,
      id: model.id,
      name: localModelLabel(model),
      inputModalities: ['text'] as const,
    })))
  }

  /**
   * Resolve one local model's metadata: its picker label and the context
   * capacity from the operator's own llama settings.
   * @param provider - the registered route.
   * @param model - the registry id.
   * @returns the resolved model metadata.
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const { models, settings } = this.snapshot()
    const entry = models.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: entry === undefined ? model : localModelLabel(entry),
      inputModalities: ['text'] as const,
      ...settings.contextLength === undefined ? {} : { context: { contextWindow: settings.contextLength } },
    })
  }

  /**
   * Stream one call to the bundled llama-server endpoint. The dispatch
   * gate runs first: unless the published server state says the selected
   * model is the one being served, the call fails with the honest start
   * action instead of touching the endpoint.
   * @param options - the fully-assembled request.
   * @returns the raw chunk stream.
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { server } = this.snapshot()
    const dispatch = resolveLocalDispatch(server, options.model)
    switch (dispatch.kind) {
      case 'stopped':
        throw new LlmError(
          `The local model server is stopped, so "${options.model}" cannot answer. `
          + `To use it, ${START_ACTION} in the app, then resend.`,
          'LOCAL_SERVER_STOPPED',
        )
      case 'starting':
        throw new LlmError(
          `The local model server is still loading "${options.model}". `
          + 'Wait for it to finish starting in Local Models, then resend.',
          'LOCAL_SERVER_STARTING',
        )
      case 'error':
        throw new LlmError(
          'The local model server is in an error state. '
          + `To recover, ${START_ACTION} in the app, then resend.`,
          'LOCAL_SERVER_ERROR',
        )
      case 'serving-other':
        throw new LlmError(
          `The local model server is serving "${dispatch.servingModelId}", not "${options.model}". `
          + 'Pick the served model, or stop the server in Local Models and start this one, then resend.',
          'LOCAL_SERVER_SERVING_OTHER',
        )
      case 'ready':
        break
    }

    if (options.signal?.aborted === true) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the local model request was aborted before dispatch', code: 'ABORTED' } } }
      return
    }

    let response: Response
    try {
      response = await this.fetchImpl(`${dispatch.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...attributionHeaders() },
        body: JSON.stringify({
          model: options.model,
          messages: toWireMessages(options),
          stream: true,
          stream_options: { include_usage: true },
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
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the local model request was aborted', code: 'ABORTED' } } }
        return
      }
      throw new LlmError(
        `The local model endpoint at ${dispatch.baseUrl} did not answer: `
        + `${error instanceof Error ? error.message : String(error)}. `
        + 'The server may have stopped; check Local Models in the app.',
        'LOCAL_ENDPOINT_UNREACHABLE',
      )
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500)
      throw new LlmError(
        `The local model endpoint answered HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`,
        'LOCAL_REQUEST_FAILED',
        { status: response.status },
      )
    }
    if (response.body === null) {
      throw new LlmError('The local model endpoint returned no stream body.', 'LOCAL_REQUEST_FAILED')
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
              usage = {
                inputTokens: prompt,
                outputTokens: completion,
                ...typeof total === 'number' ? { totalTokens: total } : {},
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
          `The local model stream failed: ${error instanceof Error ? error.message : String(error)}`,
          'LOCAL_STREAM_FAILED',
        )
      }
    } finally {
      reader.releaseLock()
    }

    yield* endBlock()
    if (usage !== undefined) yield { type: 'usage', usage }
    if (aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the local model request was aborted', code: 'ABORTED' } } }
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
