/**
 * Ollama provider over its native chat API: the detected limits must reach the
 * daemon (num_ctx / num_predict), tools must round-trip, and a remote address
 * must not be used without the explicit opt-in.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  OllamaProvider,
  assertAllowedBaseUrl,
  fromNativeToolCalls,
  OLLAMA_ALLOW_REMOTE_ENV,
  OLLAMA_BASE_URL_ENV,
  OLLAMA_MAX_OUTPUT_TOKENS_ENV,
  OLLAMA_NUM_CTX_ENV,
} from '../src/providers/ollama.js'
import type { JsonSchemaTool } from '../src/types.js'

/** Environment names this suite mutates; restored after each test. */
const TOUCHED = [OLLAMA_BASE_URL_ENV, OLLAMA_NUM_CTX_ENV, OLLAMA_MAX_OUTPUT_TOKENS_ENV, OLLAMA_ALLOW_REMOTE_ENV]

const SAVED = new Map<string, string | undefined>(TOUCHED.map(name => [name, process.env[name]]))

afterEach(() => {
  for (const [name, value] of SAVED) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

/** A transport that records the request and answers one canned JSON body. */
function stubFetch(body: unknown, status = 200): { fetch: typeof fetch; calls: Array<{ url: string; body: any }> } {
  const calls: Array<{ url: string; body: any }> = []
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

const TOOL: JsonSchemaTool = {
  name: 'http_probe',
  description: 'Send one HTTP request',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
}

describe('native request assembly', () => {
  test('sends the detected context window and clamps the output budget', async () => {
    process.env[OLLAMA_NUM_CTX_ENV] = '131072'
    process.env[OLLAMA_MAX_OUTPUT_TOKENS_ENV] = '4096'
    const stub = stubFetch({ message: { content: 'ok' }, prompt_eval_count: 11, eval_count: 3 })
    const provider = new OllamaProvider('http://127.0.0.1:11434', stub.fetch)

    // A caller asking for more than the model can emit is clamped, not honoured.
    await provider.complete({ model: 'llama3.2:3b', messages: [{ role: 'user', content: 'hi' }], maxTokens: 999_999 })

    assert.equal(stub.calls.length, 1)
    assert.equal(stub.calls[0]!.url, 'http://127.0.0.1:11434/api/chat')
    assert.deepEqual(stub.calls[0]!.body.options, { temperature: 0.2, num_ctx: 131072, num_predict: 4096 })
    assert.equal(stub.calls[0]!.body.stream, false)
  })

  test('leaves num_ctx to the daemon when nothing was detected', async () => {
    delete process.env[OLLAMA_NUM_CTX_ENV]
    delete process.env[OLLAMA_MAX_OUTPUT_TOKENS_ENV]
    const stub = stubFetch({ message: { content: 'ok' } })
    await new OllamaProvider('http://127.0.0.1:11434', stub.fetch)
      .complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    assert.equal('num_ctx' in stub.calls[0]!.body.options, false)
    assert.equal('num_predict' in stub.calls[0]!.body.options, false)
  })

  test('maps tools natively and parses returned tool calls', async () => {
    const stub = stubFetch({
      message: {
        content: '',
        tool_calls: [{ function: { name: 'http_probe', arguments: { url: 'https://example.test' } } }],
      },
    })
    const result = await new OllamaProvider('http://127.0.0.1:11434', stub.fetch)
      .complete({ model: 'm', messages: [{ role: 'user', content: 'probe it' }], tools: [TOOL] })

    assert.equal(stub.calls[0]!.body.tools[0].function.name, 'http_probe')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.toolCalls[0]!.name, 'http_probe')
    assert.deepEqual(result.toolCalls[0]!.arguments, { url: 'https://example.test' })
    // The daemon omits ids, so the router's contract gets a synthesized one.
    assert.equal(result.toolCalls[0]!.id, 'call_1')
  })

  test('maps usage from the native counters', async () => {
    const stub = stubFetch({ message: { content: 'ok' }, prompt_eval_count: 7, eval_count: 5 })
    const result = await new OllamaProvider('http://127.0.0.1:11434', stub.fetch)
      .complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    assert.deepEqual(result.usage, { promptTokens: 7, completionTokens: 5, totalTokens: 12 })
  })

  test('surfaces the native 200-with-error reply as a failure', async () => {
    const stub = stubFetch({ error: 'model "nope" not found' })
    await assert.rejects(
      new OllamaProvider('http://127.0.0.1:11434', stub.fetch)
        .complete({ model: 'nope', messages: [{ role: 'user', content: 'hi' }] }),
      /not found/u,
    )
  })

  test('refuses a regex responseFormat instead of dropping it', async () => {
    const stub = stubFetch({ message: { content: 'ok' } })
    await assert.rejects(
      new OllamaProvider('http://127.0.0.1:11434', stub.fetch)
        .complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }], responseFormat: { type: 'regex', pattern: 'x' } }),
      /regex responseFormat/u,
    )
    assert.equal(stub.calls.length, 0, 'a refused format must not reach the daemon')
  })

  test('sends a JSON schema as the native format', async () => {
    const stub = stubFetch({ message: { content: '{}' } })
    const schema = { type: 'object', properties: {} }
    await new OllamaProvider('http://127.0.0.1:11434', stub.fetch).complete({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: { type: 'json_schema', name: 'r', schema },
    })
    assert.deepEqual(stub.calls[0]!.body.format, schema)
  })

  test('normalizes a pasted /v1 address to the native root', async () => {
    const stub = stubFetch({ message: { content: 'ok' } })
    await new OllamaProvider('http://127.0.0.1:11434/v1', stub.fetch)
      .complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(stub.calls[0]!.url, 'http://127.0.0.1:11434/api/chat')
  })
})

describe('remote address guard', () => {
  test('allows loopback by default', () => {
    delete process.env[OLLAMA_ALLOW_REMOTE_ENV]
    assert.equal(assertAllowedBaseUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434')
    assert.equal(assertAllowedBaseUrl('http://localhost:11434/'), 'http://localhost:11434')
    assert.equal(assertAllowedBaseUrl('http://127.9.9.9:11434'), 'http://127.9.9.9:11434')
  })

  test('refuses a remote host, naming the opt-in', () => {
    delete process.env[OLLAMA_ALLOW_REMOTE_ENV]
    assert.throws(() => assertAllowedBaseUrl('http://gpu-box.example:11434'), /OLLAMA_ALLOW_REMOTE/u)
  })

  test('allows a remote host once the operator opts in', () => {
    process.env[OLLAMA_ALLOW_REMOTE_ENV] = '1'
    assert.equal(assertAllowedBaseUrl('http://gpu-box.example:11434'), 'http://gpu-box.example:11434')
  })

  test('rejects an unparseable address', () => {
    assert.throws(() => assertAllowedBaseUrl('not-a-url'), /not a valid URL/u)
  })
})

describe('fromNativeToolCalls', () => {
  test('accepts arguments delivered as a JSON string', () => {
    const calls = fromNativeToolCalls({
      tool_calls: [{ function: { name: 'a', arguments: '{"k":1}' } }],
    })
    assert.deepEqual(calls, [{ id: 'call_1', name: 'a', arguments: { k: 1 } }])
  })

  test('ignores malformed entries instead of throwing', () => {
    const calls = fromNativeToolCalls({ tool_calls: [null, { function: {} }, { function: { name: 'b' } }] })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0]!.arguments, {})
  })

  test('returns nothing when the reply carries no calls', () => {
    assert.deepEqual(fromNativeToolCalls({ content: 'plain' }), [])
  })
})
