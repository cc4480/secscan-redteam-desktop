import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  LlmError,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LocalLlamaAdapter, toWireMessages } from '../src/index.js'
import {
  ACTIVE_MODEL_FILE,
  ACTIVE_MODEL_ID,
  createFixtureModelsDir,
  FIXTURE_BASE_URL,
  SECOND_MODEL_ID,
  writeServerState,
} from './fixtures.js'

/**
 * @param text - user text.
 * @returns a one-block user message.
 */
function user(text: string) {
  return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
}

/**
 * @param model - model id to request.
 * @returns minimal generate options for the adapter.
 */
function options(model: string): GenerateOptions {
  return { provider: 'local', model, messages: [user('Say hello.')] }
}

/**
 * Drain one adapter stream into an array.
 * @param chunks - the stream.
 * @returns the chunks in order.
 */
async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const collected: StreamChunk[] = []
  for await (const chunk of chunks) collected.push(chunk)
  return collected
}

/**
 * Await one stream's rejection.
 * @param chunks - the stream.
 * @returns the rejection reason.
 */
async function rejectionOf(chunks: AsyncIterable<StreamChunk>): Promise<unknown> {
  try {
    await collect(chunks)
  } catch (error) {
    return error
  }
  throw new Error('expected the stream to reject, but it completed')
}

/**
 * Build a fetch seam answering one canned SSE body and recording requests.
 * @param body - the SSE payload.
 * @param status - HTTP status to answer with.
 * @returns the fetch seam and its request log.
 */
function fakeFetch(body: string, status = 200): { fetchImpl: typeof fetch; requests: { url: string; init: RequestInit }[] } {
  const requests: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  return { fetchImpl, requests }
}

describe('local adapter catalog', () => {
  it('lists downloaded models with the server stopped, active first, absent file filtered', async () => {
    const directory = await createFixtureModelsDir()
    // No server-state.json at all: the reported bug's exact condition.
    // Catalog membership must not depend on it.
    const adapter = new LocalLlamaAdapter({ modelsDir: directory })
    const models = await adapter.listModels('local')
    assert.deepEqual(models.map(model => model.id), [ACTIVE_MODEL_ID, SECOND_MODEL_ID])
    assert.equal(models[0]?.name, `${ACTIVE_MODEL_FILE.replace(/\.gguf$/i, '')} · Local`)
    assert.equal(models[0]?.provider, 'local')
    assert.deepEqual(models[0]?.inputModalities, ['text'])
    assert.deepEqual(adapter.providerInfo('local'), { id: 'local', name: 'Local' })
  })

  it('resolves model metadata with the operator context length', async () => {
    const directory = await createFixtureModelsDir()
    const adapter = new LocalLlamaAdapter({ modelsDir: directory })
    const resolved = await adapter.resolveModel('local', ACTIVE_MODEL_ID)
    assert.equal(resolved.context?.contextWindow, 32768)
    assert.equal(resolved.name, `${ACTIVE_MODEL_FILE.replace(/\.gguf$/i, '')} · Local`)
  })
})

describe('local adapter dispatch gate', () => {
  it('fails a stopped server with the honest start action and never calls the endpoint', async () => {
    const directory = await createFixtureModelsDir()
    await writeServerState(directory, { status: 'stopped' })
    const { fetchImpl, requests } = fakeFetch('')
    const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl })
    const error = await rejectionOf(adapter.stream(options(ACTIVE_MODEL_ID)))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_SERVER_STOPPED')
    assert.match(error.failure.message, /open Local Models and press "Start server"/)
    assert.equal(requests.length, 0)
  })

  it('fails starting, error, and serving-other states distinctly', async () => {
    const directory = await createFixtureModelsDir()
    const { fetchImpl, requests } = fakeFetch('')
    const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl })

    await writeServerState(directory, { status: 'starting', modelId: ACTIVE_MODEL_ID })
    const starting = await rejectionOf(adapter.stream(options(ACTIVE_MODEL_ID)))
    assert.ok(starting instanceof LlmError)
    assert.equal(starting.failure.code, 'LOCAL_SERVER_STARTING')

    await writeServerState(directory, { status: 'error', modelId: ACTIVE_MODEL_ID })
    const errored = await rejectionOf(adapter.stream(options(ACTIVE_MODEL_ID)))
    assert.ok(errored instanceof LlmError)
    assert.equal(errored.failure.code, 'LOCAL_SERVER_ERROR')

    await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: SECOND_MODEL_ID })
    const other = await rejectionOf(adapter.stream(options(ACTIVE_MODEL_ID)))
    assert.ok(other instanceof LlmError)
    assert.equal(other.failure.code, 'LOCAL_SERVER_SERVING_OTHER')
    assert.match(other.failure.message, new RegExp(SECOND_MODEL_ID))
    assert.equal(requests.length, 0)
  })
})

describe('local adapter streaming', () => {
  it('streams reasoning, text, and usage from the endpoint and finishes stop', async () => {
    const directory = await createFixtureModelsDir()
    await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"Let me think. "},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    const { fetchImpl, requests } = fakeFetch(sse)
    const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl })
    const chunks = await collect(adapter.stream(options(ACTIVE_MODEL_ID)))

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, `${FIXTURE_BASE_URL}/chat/completions`)
    const sent = JSON.parse(String(requests[0]?.init.body)) as { model: string; stream: boolean }
    assert.equal(sent.model, ACTIVE_MODEL_ID)
    assert.equal(sent.stream, true)

    const types = chunks.map(chunk => chunk.type)
    assert.deepEqual(types, [
      'block-start', 'reasoning-delta', 'block-end',
      'block-start', 'text-delta', 'text-delta', 'block-end',
      'usage', 'finish',
    ])
    const text = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map(chunk => chunk.text)
      .join('')
    assert.equal(text, 'Hello world')
    const usage = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage')
    assert.ok(usage !== undefined)
    assert.deepEqual(usage.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 })
    const finish = chunks[chunks.length - 1]
    assert.ok(finish?.type === 'finish')
    assert.equal(finish.reason.kind, 'stop')
  })

  it('assembles streamed tool calls and finishes tool-calls', async () => {
    const directory = await createFixtureModelsDir()
    await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"probe","arguments":"{\\"tar"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"get\\":\\"x\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    const { fetchImpl } = fakeFetch(sse)
    const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl })
    const request: GenerateOptions = {
      provider: 'local',
      model: ACTIVE_MODEL_ID,
      messages: [user('Probe it.')],
      tools: [{ name: 'probe', description: 'Probe a target.', parameters: { type: 'object' } }],
    }
    const chunks = await collect(adapter.stream(request))
    const end = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'block-end' }> => chunk.type === 'block-end')
    assert.ok(end !== undefined)
    assert.deepEqual(end.block, {
      type: 'tool-call',
      id: ToolCallId('call_1'),
      name: 'probe',
      arguments: '{"target":"x"}',
    })
    const finish = chunks[chunks.length - 1]
    assert.ok(finish?.type === 'finish')
    assert.equal(finish.reason.kind, 'tool-calls')
  })

  it('reports an HTTP failure with its status instead of a stream', async () => {
    const directory = await createFixtureModelsDir()
    await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
    const { fetchImpl } = fakeFetch('model not loaded', 404)
    const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl })
    const error = await rejectionOf(adapter.stream(options(ACTIVE_MODEL_ID)))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_REQUEST_FAILED')
    assert.equal(error.failure.status, 404)
  })

  it('reports an unreachable endpoint instead of dispatching into the void', async () => {
    const directory = await createFixtureModelsDir()
    await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
    const fetchImpl = (async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:18080') }) as typeof fetch
    const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl })
    const error = await rejectionOf(adapter.stream(options(ACTIVE_MODEL_ID)))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_ENDPOINT_UNREACHABLE')
  })
})

describe('local adapter context overflow', () => {
  it('classifies the llama-server overflow body as the canonical context failure', async () => {
    const directory = await createFixtureModelsDir()
    await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
    // The exact body llama-server answers with when the prompt outgrows the operator's Context length.
    // llama.cpp refuses the oversized prompt before streaming, so this response is the only overflow signal the harness gets.
    const overflow = '{"error":{"code":400,"message":"request (117282 tokens) exceeds the available context size (32768 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":117282,"n_ctx":32768}}'
    const { fetchImpl, requests } = fakeFetch(overflow, 400)
    const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl })
    const error = await rejectionOf(adapter.stream(options(ACTIVE_MODEL_ID)))

    assert.equal(requests.length, 1)
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, CONTEXT_WINDOW_EXCEEDED_CODE)
    assert.equal(error.failure.status, 400)
    // The harness recovers this code by compacting, so the message must name the operator's own fix.
    assert.match(error.failure.message, /context window is full/)
    assert.match(error.failure.message, /Raise the Context length in Local Models and restart the server, or start a new session/)
    // The endpoint's own detail rides along: the token counts are the operator's evidence for raising the setting.
    assert.match(error.failure.message, /117282 tokens/)
  })

  it('keeps a non-overflow bad request as a plain request failure', async () => {
    const directory = await createFixtureModelsDir()
    await writeServerState(directory, { status: 'running', baseUrl: FIXTURE_BASE_URL, modelId: ACTIVE_MODEL_ID })
    // A 400 that names the context without overflowing it, so the classifier cannot fire on the word alone.
    const rejected = '{"error":{"code":400,"message":"invalid request: context window size must be positive","type":"invalid_request_error"}}'
    const { fetchImpl } = fakeFetch(rejected, 400)
    const adapter = new LocalLlamaAdapter({ modelsDir: directory, fetchImpl })
    const error = await rejectionOf(adapter.stream(options(ACTIVE_MODEL_ID)))

    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'LOCAL_REQUEST_FAILED')
    assert.equal(error.failure.status, 400)
    // Not every bad request is a full window: a blanket classification here would compact a turn that cannot be fixed by compacting.
    assert.doesNotMatch(error.failure.message, /context window is full/)
    assert.match(error.failure.message, /answered HTTP 400/)
  })
})

describe('local adapter wire translation', () => {
  it('collapses system text, maps tool calls and results to wire form', () => {
    const assistant = createAssistantMessage({
      source: { provider: 'local', model: ACTIVE_MODEL_ID },
      content: [
        { type: 'text', text: 'Probing.' },
        { type: 'tool-call', id: ToolCallId('call_1'), name: 'probe', arguments: '{"target":"x"}' },
      ],
    })
    const result = createToolResultMessage({
      callId: ToolCallId('call_1'),
      content: [{ type: 'text', text: 'open port 80' }],
      isError: false,
    })
    const wire = toWireMessages({
      provider: 'local',
      model: ACTIVE_MODEL_ID,
      system: 'You are the Lead.',
      messages: [createSystemMessage('Doctrine text.'), user('Scan it.'), assistant, result],
    })
    assert.deepEqual(wire, [
      { role: 'system', content: 'You are the Lead.\n\nDoctrine text.' },
      { role: 'user', content: 'Scan it.' },
      {
        role: 'assistant',
        content: 'Probing.',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'probe', arguments: '{"target":"x"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'open port 80' },
    ])
  })
})
