/**
 * Meta provider: configuration detection, wire translation, and the Meta
 * seat policy. All fakes — no network, no real key. The live smoke against
 * api.meta.ai is a separate, key-gated acceptance step.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  META_API_KEY_ENV,
  META_API_KEY_FALLBACK_ENV,
  META_BASE_URL,
  META_MODELS,
  MetaProvider,
} from '../src/providers/meta.js'
import { roleModelPolicy } from '../src/policy.js'

const realFetch = globalThis.fetch
const savedEnv = { ...process.env }

afterEach(() => {
  globalThis.fetch = realFetch
  for (const key of [META_API_KEY_ENV, META_API_KEY_FALLBACK_ENV]) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('MetaProvider configuration', () => {
  test('is not configured without a key in either env var', () => {
    delete process.env[META_API_KEY_ENV]
    delete process.env[META_API_KEY_FALLBACK_ENV]
    assert.equal(new MetaProvider().isConfigured(), false)
  })

  test('is configured with MODEL_API_KEY (the quickstart name)', () => {
    delete process.env[META_API_KEY_FALLBACK_ENV]
    process.env[META_API_KEY_ENV] = 'test-key'
    assert.equal(new MetaProvider().isConfigured(), true)
  })

  test('is configured with only the META_API_KEY fallback set', () => {
    delete process.env[META_API_KEY_ENV]
    process.env[META_API_KEY_FALLBACK_ENV] = 'test-key'
    assert.equal(new MetaProvider().isConfigured(), true)
  })

  test('complete() without a key fails loud, naming the env var, before any fetch', async () => {
    delete process.env[META_API_KEY_ENV]
    delete process.env[META_API_KEY_FALLBACK_ENV]
    let fetched = false
    stubFetch(async () => {
      fetched = true
      return jsonResponse({})
    })
    await assert.rejects(
      new MetaProvider().complete({ model: META_MODELS.spark, messages: [{ role: 'user', content: 'hi' }] }),
      new RegExp(META_API_KEY_ENV),
    )
    assert.equal(fetched, false)
  })
})

describe('MetaProvider wire translation', () => {
  test('posts an OpenAI-shaped body and parses text, tool calls, and usage', async () => {
    process.env[META_API_KEY_ENV] = 'test-key'
    let seenUrl = ''
    let seenAuth: unknown
    let seenBody: Record<string, unknown> = {}
    stubFetch(async (url, init) => {
      seenUrl = url
      seenAuth = (init?.headers as Record<string, string>)['Authorization']
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({
        choices: [{
          message: {
            content: 'found it',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'scan', arguments: '{"target":"lab"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
      })
    })

    const result = await new MetaProvider().complete({
      model: META_MODELS.wonder,
      messages: [{ role: 'user', content: 'scan the lab' }],
      tools: [{ name: 'scan', description: 'run a scan', parameters: { type: 'object' } }],
      reasoningEffort: 'high',
      maxTokens: 512,
    })

    assert.equal(seenUrl, `${META_BASE_URL}/chat/completions`)
    assert.equal(seenAuth, 'Bearer test-key')
    assert.equal(seenBody['model'], META_MODELS.wonder)
    assert.equal(seenBody['reasoning_effort'], 'high')
    assert.equal(seenBody['max_tokens'], 512)
    const wireTools = seenBody['tools'] as Array<{ function: { name: string } }>
    assert.equal(wireTools[0]?.function.name, 'scan')
    assert.equal(result.text, 'found it')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.toolCalls[0]?.name, 'scan')
    assert.deepEqual(result.toolCalls[0]?.arguments, { target: 'lab' })
    assert.deepEqual(result.usage, { promptTokens: 100, completionTokens: 25, totalTokens: 125 })
    assert.equal(result.provider, 'meta')
    assert.equal(result.model, META_MODELS.wonder)
  })

  test('an HTTP failure surfaces as a ProviderError naming Meta and the status', async () => {
    process.env[META_API_KEY_ENV] = 'test-key'
    stubFetch(async () => jsonResponse({ error: { message: 'bad key' } }, 401))
    await assert.rejects(
      new MetaProvider().complete({ model: META_MODELS.spark, messages: [{ role: 'user', content: 'hi' }] }),
      /Meta HTTP 401/,
    )
  })
})

describe('Meta seat policy', () => {
  test('REDTEAM_LLM_PROVIDER=meta seats Spark on all four roles, exploiter at high effort', () => {
    const policy = roleModelPolicy({ REDTEAM_LLM_PROVIDER: 'meta' })
    for (const role of ['coordinator', 'recon', 'exploiter', 'reporter'] as const) {
      assert.equal(policy[role].provider, 'meta')
      assert.equal(policy[role].model, META_MODELS.spark)
    }
    assert.equal(policy.exploiter.reasoningEffort, 'high')
    assert.equal(policy.recon.reasoningEffort, 'low')
  })

  test('the default policy still routes to DeepSeek when meta is not selected', () => {
    const policy = roleModelPolicy({})
    assert.equal(policy.coordinator.provider, 'deepseek')
    assert.equal(policy.exploiter.provider, 'deepseek')
  })
})
