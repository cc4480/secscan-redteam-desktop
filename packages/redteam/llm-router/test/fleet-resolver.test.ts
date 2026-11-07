/**
 * Fleet configuration resolver: provider keys and the fleet provider
 * selection are consulted at dispatch time through the installed
 * resolver, so a key seated in the app's credentials store after the
 * process started — or a provider selection changed there — reaches the
 * next dispatch without a restart. All fakes: stub providers and a
 * stubbed fetch; no network, no real keys.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { LLM_PROVIDER_ENV } from '../src/policy.js'
import { DEEPSEEK_API_KEY_ENV, DeepSeekProvider } from '../src/providers/deepseek.js'
import { LOCAL_MODEL_ENV } from '../src/providers/local.js'
import { META_API_KEY_ENV, META_API_KEY_FALLBACK_ENV, MetaProvider } from '../src/providers/meta.js'
import { setFleetConfigResolver, type FleetConfigResolver } from '../src/resolver.js'
import { completeForRole } from '../src/router.js'

const realFetch = globalThis.fetch
const savedEnv = { ...process.env }
const TOUCHED_ENV = [DEEPSEEK_API_KEY_ENV, META_API_KEY_ENV, META_API_KEY_FALLBACK_ENV, LLM_PROVIDER_ENV, LOCAL_MODEL_ENV]

afterEach(() => {
  globalThis.fetch = realFetch
  setFleetConfigResolver(undefined)
  for (const key of TOUCHED_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

/** A resolver over a mutable name→value map: the store, in miniature. */
function mutableResolver(values: Map<string, string>): FleetConfigResolver {
  return { valueFor: name => values.get(name) }
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch
}

function completionResponse(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function authorizationOf(init?: RequestInit): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined
  return headers?.['Authorization'] ?? headers?.['authorization']
}

describe('fleet resolver: keys seated after startup', () => {
  test('a DeepSeek key seated after startup reaches the next dispatch', async () => {
    delete process.env[DEEPSEEK_API_KEY_ENV]
    const values = new Map<string, string>()
    setFleetConfigResolver(mutableResolver(values))
    const provider = new DeepSeekProvider()

    assert.equal(provider.isConfigured(), false)
    await assert.rejects(provider.complete({ model: 'deepseek-flash', messages: [] }), /is not set/)

    values.set(DEEPSEEK_API_KEY_ENV, 'sk-seated-late')
    assert.equal(provider.isConfigured(), true)

    let seen: string | undefined
    stubFetch(async (_url, init) => {
      seen = authorizationOf(init)
      return completionResponse('ok')
    })
    const result = await provider.complete({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(result.text, 'ok')
    assert.equal(seen, 'Bearer sk-seated-late')
  })

  test('a Meta key seated after startup reaches the next dispatch (same resolver, second family)', async () => {
    delete process.env[META_API_KEY_ENV]
    delete process.env[META_API_KEY_FALLBACK_ENV]
    const values = new Map<string, string>()
    setFleetConfigResolver(mutableResolver(values))
    const provider = new MetaProvider()

    assert.equal(provider.isConfigured(), false)
    values.set(META_API_KEY_ENV, 'meta-seated-late')
    assert.equal(provider.isConfigured(), true)

    let seen: string | undefined
    stubFetch(async (_url, init) => {
      seen = authorizationOf(init)
      return completionResponse('ok')
    })
    const result = await provider.complete({ model: 'muse-spark-1.3', messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(result.text, 'ok')
    assert.equal(seen, 'Bearer meta-seated-late')
  })

  test('with no resolver installed, the launching environment is the resolution (pre-seam behavior)', () => {
    const provider = new DeepSeekProvider()
    delete process.env[DEEPSEEK_API_KEY_ENV]
    assert.equal(provider.isConfigured(), false)
    process.env[DEEPSEEK_API_KEY_ENV] = 'sk-from-env'
    assert.equal(provider.isConfigured(), true)
    delete process.env[DEEPSEEK_API_KEY_ENV]
    assert.equal(provider.isConfigured(), false)
  })
})

describe('fleet resolver: provider selection', () => {
  test('a selection change applies to the next dispatch, across provider families', async () => {
    delete process.env[LLM_PROVIDER_ENV]
    delete process.env[LOCAL_MODEL_ENV]
    delete process.env[META_API_KEY_ENV]
    delete process.env[DEEPSEEK_API_KEY_ENV]
    const values = new Map<string, string>([
      [META_API_KEY_ENV, 'meta-key'],
      [DEEPSEEK_API_KEY_ENV, 'deepseek-key'],
    ])
    setFleetConfigResolver(mutableResolver(values))
    const calls: string[] = []
    stubFetch(async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      calls.push(`${url} :: ${body.model ?? ''} :: ${authorizationOf(init) ?? ''}`)
      return completionResponse('ok')
    })

    // No selection anywhere: the DeepSeek default seat table serves,
    // with the store-seated DeepSeek key.
    await completeForRole('recon', [{ role: 'user', content: 'map it' }])
    assert.deepEqual(calls, ['https://api.deepseek.com/v1/chat/completions :: deepseek-flash :: Bearer deepseek-key'])

    // The operator selects Meta in the app: the next dispatch follows.
    values.set(LLM_PROVIDER_ENV, 'meta')
    await completeForRole('recon', [{ role: 'user', content: 'map it' }])
    assert.deepEqual(calls, [
      'https://api.deepseek.com/v1/chat/completions :: deepseek-flash :: Bearer deepseek-key',
      'https://api.meta.ai/v1/chat/completions :: muse-spark-1.3 :: Bearer meta-key',
    ])

    // Local likewise: its model name arrives through the same resolver.
    values.set(LLM_PROVIDER_ENV, 'local')
    values.set(LOCAL_MODEL_ENV, 'local-test-model')
    await completeForRole('recon', [{ role: 'user', content: 'map it' }])
    assert.deepEqual(calls, [
      'https://api.deepseek.com/v1/chat/completions :: deepseek-flash :: Bearer deepseek-key',
      'https://api.meta.ai/v1/chat/completions :: muse-spark-1.3 :: Bearer meta-key',
      'http://127.0.0.1:8080/v1/chat/completions :: local-test-model :: ',
    ])
  })
})
