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
import { META_ROLE_MODEL_POLICY, ROLE_ORDER, roleModelPolicy } from '../src/policy.js'
import { DEEPSEEK_MODELS } from '../src/providers/deepseek.js'
import { completeForRole } from '../src/router.js'

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
      /neither MODEL_API_KEY nor META_API_KEY is set/,
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

  test('maps prompt_tokens_details.cached_tokens into usage.cacheReadTokens', async () => {
    process.env[META_API_KEY_ENV] = 'test-key'
    stubFetch(async () => jsonResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: {
        prompt_tokens: 1_000,
        completion_tokens: 50,
        total_tokens: 1_050,
        prompt_tokens_details: { cached_tokens: 910 },
      },
    }))

    const result = await new MetaProvider().complete({
      model: META_MODELS.spark,
      messages: [{ role: 'user', content: 'scan the lab' }],
    })

    assert.deepEqual(result.usage, {
      promptTokens: 1_000,
      completionTokens: 50,
      totalTokens: 1_050,
      cacheReadTokens: 910,
    })
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

describe('Meta model registry', () => {
  test('registers spark-1.2 under its evidenced wire ID', () => {
    assert.equal(META_MODELS.spark12, 'muse-spark-1.2')
  })

  test('registers spark-1.1 under its evidenced wire ID', () => {
    assert.equal(META_MODELS.spark11, 'muse-spark-1.1')
  })

  test('holds exactly the four evidenced models, in registration order', () => {
    // The exact-key assertion is the guard against silent registry
    // additions: muse-spark-1.1 joined only after the Q-G71 live probe
    // settled its wire ID (Cho-zen, 2026-10-31: HTTP 200, returned model
    // muse-spark-1.1).
    assert.deepEqual(Object.keys(META_MODELS), ['wonder', 'spark', 'spark12', 'spark11'])
    assert.deepEqual(Object.values(META_MODELS), ['muse-wonder-1.0', 'muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.1'])
  })

  test('registers no contributor variant and no catalog-only ID', () => {
    for (const id of Object.values(META_MODELS)) {
      assert.doesNotMatch(id, /contributor/i)
      assert.notEqual(id, 'muse-wonder-full-1.0')
    }
  })

  test('spark-1.2, spark-1.1, and wonder are registered but never seated on the fleet', () => {
    for (const role of ROLE_ORDER) {
      assert.equal(META_ROLE_MODEL_POLICY[role].model, META_MODELS.spark)
    }
    const seated = new Set(ROLE_ORDER.map(role => META_ROLE_MODEL_POLICY[role].model))
    assert.equal(seated.has(META_MODELS.spark12), false)
    assert.equal(seated.has(META_MODELS.spark11), false)
    assert.equal(seated.has(META_MODELS.wonder), false)
  })
})

describe('Meta seat policy', () => {
  test('REDTEAM_LLM_PROVIDER=meta seats Spark on all five roles, exploiter at high effort', () => {
    const policy = roleModelPolicy({ REDTEAM_LLM_PROVIDER: 'meta' })
    for (const role of ROLE_ORDER) {
      assert.equal(policy[role].provider, 'meta')
      assert.equal(policy[role].model, META_MODELS.spark)
    }
    assert.equal(policy.exploiter.reasoningEffort, 'high')
    assert.equal(policy.recon.reasoningEffort, 'low')
  })

  test('an unset selector with an empty env seats Meta on all five roles (G8 default)', () => {
    const policy = roleModelPolicy({})
    for (const role of ROLE_ORDER) {
      assert.equal(policy[role].provider, 'meta')
      assert.equal(policy[role].model, META_MODELS.spark)
    }
    assert.equal(policy.exploiter.reasoningEffort, 'high')
    assert.equal(policy.recon.reasoningEffort, 'low')
  })

  test('key presence no longer changes policy selection', () => {
    assert.deepEqual(roleModelPolicy({}), roleModelPolicy({ MODEL_API_KEY: 'test-key' }))
    assert.deepEqual(roleModelPolicy({}), roleModelPolicy({ META_API_KEY: 'test-key' }))
  })

  test('a configured MODEL_API_KEY seats the fleet on Meta with no selector set', () => {
    const policy = roleModelPolicy({ MODEL_API_KEY: 'test-key' })
    for (const role of ROLE_ORDER) {
      assert.equal(policy[role].provider, 'meta')
      assert.equal(policy[role].model, META_MODELS.spark)
    }
    assert.equal(policy.exploiter.reasoningEffort, 'high')
    // The provider those seats dispatch to posts to the Meta Model API.
    assert.equal(META_BASE_URL, 'https://api.meta.ai/v1')
  })

  test('the META_API_KEY fallback name also seats Meta by default', () => {
    const policy = roleModelPolicy({ META_API_KEY: 'test-key' })
    assert.equal(policy.coordinator.provider, 'meta')
    assert.equal(policy.exploiter.model, META_MODELS.spark)
  })

  test('an explicit selector wins over a configured Meta key', () => {
    const policy = roleModelPolicy({ MODEL_API_KEY: 'test-key', REDTEAM_LLM_PROVIDER: 'deepseek' })
    assert.equal(policy.coordinator.provider, 'deepseek')
    assert.equal(policy.exploiter.provider, 'deepseek')
  })

  test('an explicit deepseek selector seats DeepSeek on all five roles with no key set', () => {
    const policy = roleModelPolicy({ REDTEAM_LLM_PROVIDER: 'deepseek' })
    for (const role of ROLE_ORDER) {
      assert.equal(policy[role].provider, 'deepseek')
    }
    assert.equal(policy.exploiter.model, DEEPSEEK_MODELS.pro)
    assert.equal(policy.coordinator.model, DEEPSEEK_MODELS.flash)
  })

  test('a blank MODEL_API_KEY still seats Meta (the policy layer does not inspect the key)', () => {
    const policy = roleModelPolicy({ MODEL_API_KEY: '   ' })
    assert.equal(policy.coordinator.provider, 'meta')
    assert.equal(policy.exploiter.provider, 'meta')
  })
})

describe('Keyless fleet dispatch (G8)', () => {
  test('completeForRole with no selector and no key fails at the router gate, never seating DeepSeek', async () => {
    const savedSelector = process.env['REDTEAM_LLM_PROVIDER']
    delete process.env['REDTEAM_LLM_PROVIDER']
    delete process.env[META_API_KEY_ENV]
    delete process.env[META_API_KEY_FALLBACK_ENV]
    try {
      await assert.rejects(
        completeForRole('coordinator', [{ role: 'user', content: 'hi' }]),
        /provider 'meta' is registered but not configured/,
      )
    } finally {
      if (savedSelector === undefined) delete process.env['REDTEAM_LLM_PROVIDER']
      else process.env['REDTEAM_LLM_PROVIDER'] = savedSelector
    }
  })
})
