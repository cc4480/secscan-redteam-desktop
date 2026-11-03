import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  LlmError,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MetaAdapter, META_BASE_URL, META_MODELS, toWireMessages } from '../src/index.js'

/** Fake key used by every dispatch test; a fixture value, never a real credential. */
const FAKE_KEY = 'fake-meta-key-for-tests'

/** Base URL the fixture adapter dispatches to. */
const FIXTURE_BASE_URL = 'https://meta.test/v1'

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
  return { provider: 'meta', model, messages: [user('Say hello.')] }
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

/**
 * Build an adapter wired to the fixture endpoint with a seated fake key.
 * @param fetchImpl - the fetch seam.
 * @returns the adapter.
 */
function seatedAdapter(fetchImpl: typeof fetch): MetaAdapter {
  return new MetaAdapter({ baseUrl: FIXTURE_BASE_URL, fetchImpl, resolveApiKey: () => Promise.resolve(FAKE_KEY) })
}

describe('meta adapter catalog', () => {
  it('lists the four META_MODELS unconditionally, with no key seated', async () => {
    // No resolveApiKey seam at all and an empty environment: listing must
    // not consult any credential (the local group's serving-gate sin,
    // repeated here as a key gate, is what this guards against).
    const adapter = new MetaAdapter({ environment: {} })
    const models = await adapter.listModels('meta')
    assert.deepEqual(models.map(model => model.id), META_MODELS.map(model => model.id))
    assert.deepEqual(models.map(model => model.id), ['muse-wonder-1.0', 'muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.1'])
    assert.equal(models[1]?.name, 'Muse Spark 1.3')
    assert.equal(models[1]?.provider, 'meta')
    assert.deepEqual(adapter.providerInfo('meta'), { id: 'meta', name: 'Meta' })
    assert.equal(adapter.baseUrlValue(), META_BASE_URL)
  })

  it('resolves model metadata with the stated context capacity', async () => {
    const adapter = new MetaAdapter({ environment: {} })
    const resolved = await adapter.resolveModel('meta', 'muse-spark-1.2')
    assert.equal(resolved.name, 'Muse Spark 1.2')
    assert.equal(resolved.context?.contextWindow, 1_000_000)
    const wonder = await adapter.resolveModel('meta', 'muse-wonder-1.0')
    assert.equal(wonder.name, 'Muse Wonder 1.0')
    assert.equal(wonder.context, undefined)
  })
})

describe('meta adapter credential gate', () => {
  it('fails a missing key with MISSING_CREDENTIAL and never calls the endpoint', async () => {
    const { fetchImpl, requests } = fakeFetch('')
    const adapter = new MetaAdapter({ baseUrl: FIXTURE_BASE_URL, fetchImpl, resolveApiKey: () => Promise.resolve(undefined) })
    const error = await rejectionOf(adapter.stream(options('muse-spark-1.3')))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'MISSING_CREDENTIAL')
    assert.match(error.failure.message, /MODEL_API_KEY/)
    assert.match(error.failure.message, /credentials service/)
    assert.equal(requests.length, 0)
  })

  it('re-resolves the key on every request, so a later seating reaches the next call', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    const { fetchImpl, requests } = fakeFetch(sse)
    let seated: string | undefined
    const adapter = new MetaAdapter({ baseUrl: FIXTURE_BASE_URL, fetchImpl, resolveApiKey: () => Promise.resolve(seated) })
    const first = await rejectionOf(adapter.stream(options('muse-spark-1.3')))
    assert.ok(first instanceof LlmError)
    assert.equal(first.failure.code, 'MISSING_CREDENTIAL')
    seated = FAKE_KEY
    const chunks = await collect(adapter.stream(options('muse-spark-1.3')))
    assert.equal(chunks[chunks.length - 1]?.type, 'finish')
    assert.equal(requests.length, 1)
  })
})

describe('meta adapter streaming', () => {
  it('streams reasoning, text, and usage from the endpoint and finishes stop', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"Let me think. "},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18,"prompt_tokens_details":{"cached_tokens":3}}}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    const { fetchImpl, requests } = fakeFetch(sse)
    const adapter = seatedAdapter(fetchImpl)
    const chunks = await collect(adapter.stream(options('muse-spark-1.3')))

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, `${FIXTURE_BASE_URL}/chat/completions`)
    const headers = requests[0]?.init.headers as Record<string, string>
    assert.equal(headers['authorization'], `Bearer ${FAKE_KEY}`)
    const sent = JSON.parse(String(requests[0]?.init.body)) as { model: string; stream: boolean }
    assert.equal(sent.model, 'muse-spark-1.3')
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
    assert.deepEqual(usage.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18, cacheReadTokens: 3 })
    const finish = chunks[chunks.length - 1]
    assert.ok(finish?.type === 'finish')
    assert.equal(finish.reason.kind, 'stop')
  })

  it('assembles streamed tool calls and finishes tool-calls', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"probe","arguments":"{\\"tar"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"get\\":\\"x\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    const { fetchImpl } = fakeFetch(sse)
    const adapter = seatedAdapter(fetchImpl)
    const request: GenerateOptions = {
      provider: 'meta',
      model: 'muse-spark-1.3',
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

  it('reports an HTTP failure with its status and never echoes the key', async () => {
    const { fetchImpl } = fakeFetch('{"error":{"code":"invalid_api_key"}}', 401)
    const adapter = seatedAdapter(fetchImpl)
    const error = await rejectionOf(adapter.stream(options('muse-spark-1.3')))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'META_REQUEST_FAILED')
    assert.equal(error.failure.status, 401)
    assert.ok(!error.failure.message.includes(FAKE_KEY), 'the key must never appear in an error')
  })

  it('reports an unreachable endpoint instead of dispatching into the void', async () => {
    const fetchImpl = (async () => { throw new Error('connect ECONNREFUSED 203.0.113.1:443') }) as typeof fetch
    const adapter = seatedAdapter(fetchImpl)
    const error = await rejectionOf(adapter.stream(options('muse-spark-1.3')))
    assert.ok(error instanceof LlmError)
    assert.equal(error.failure.code, 'META_ENDPOINT_UNREACHABLE')
  })
})

describe('meta adapter wire translation', () => {
  it('collapses system text, maps tool calls and results to wire form', () => {
    const assistant = createAssistantMessage({
      source: { provider: 'meta', model: 'muse-spark-1.3' },
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
      provider: 'meta',
      model: 'muse-spark-1.3',
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
