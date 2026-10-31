/**
 * ResilientProvider end-to-end with a scripted fake provider and fake keys:
 * rotation on 429, DEAD keys on billing/auth, stay-on-primary, upstream
 * model fallback, compress surfacing, and the disabled passthrough.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { ProviderError, providerErrorFromResponse } from '../src/errors.js'
import { ResilienceError, type RetryEvent } from '../src/executor.js'
import { CredentialPool } from '../src/pool.js'
import {
  ResilientProvider,
  resilienceConfigFromEnv,
  type ResilienceConfig,
} from '../src/resilience.js'
import type { ChatResult, CompleteOptions, LlmProvider } from '../src/types.js'

type Outcome = ChatResult | Error

function ok(model: string): ChatResult {
  return { text: 'ok', toolCalls: [], provider: 'fake', model }
}

function http(status: number, body: string, extra: Partial<{ code: string; retryAfterMs: number }> = {}): ProviderError {
  return new ProviderError({
    provider: 'fake',
    message: `[llm-router] Fake HTTP ${status}: ${body}`,
    status,
    ...extra,
  })
}

class FakeProvider implements LlmProvider {
  readonly id = 'fake'
  readonly label = 'Fake'
  readonly seen: Array<{ model: string; apiKey?: string }> = []
  private readonly script: Outcome[]

  constructor(script: Outcome[]) {
    this.script = [...script]
  }

  isConfigured(): boolean {
    return true
  }

  async complete(options: CompleteOptions): Promise<ChatResult> {
    this.seen.push({ model: options.model, apiKey: options.apiKey })
    const next = this.script.shift()
    if (next === undefined) throw new Error('fake provider script exhausted')
    if (next instanceof Error) throw next
    return next
  }
}

function config(overrides: Partial<ResilienceConfig> = {}): ResilienceConfig {
  return {
    enabled: true,
    maxAttempts: 3,
    stayOnPrimaryResetMs: 0,
    maxDelayMs: 30_000,
    fallbackModels: {},
    fallbackProviders: {},
    logPath: null,
    ...overrides,
  }
}

function harness(
  script: Outcome[],
  opts: { keys?: string[]; config?: Partial<ResilienceConfig> } = {},
) {
  const inner = new FakeProvider(script)
  const events: RetryEvent[] = []
  const sleeps: number[] = []
  const pool = new CredentialPool('fake', opts.keys ?? ['key-a', 'key-b'])
  const provider = new ResilientProvider(inner, {
    pool,
    config: config(opts.config),
    onEvent: e => events.push(e),
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  const call = (model = 'model-a'): Promise<ChatResult> =>
    provider.complete({ model, messages: [{ role: 'user', content: 'hi' }] })
  return { inner, events, sleeps, pool, provider, call }
}

describe('ResilientProvider', () => {
  test('no failure: one call on the first pooled key, no events', async () => {
    const h = harness([ok('model-a')])
    const res = await h.call()
    assert.equal(res.text, 'ok')
    assert.deepEqual(h.inner.seen, [{ model: 'model-a', apiKey: 'key-a' }])
    assert.deepEqual(h.events, [])
  })

  test('429 rotates to the next key instead of killing the run', async () => {
    const h = harness([http(429, 'rate limit exceeded'), ok('model-a')])
    const res = await h.call()
    assert.equal(res.text, 'ok')
    assert.deepEqual(
      h.inner.seen.map(s => s.apiKey),
      ['key-a', 'key-b'],
    )
    const scheduled = h.events.find(e => e.kind === 'retry-scheduled')
    assert.equal(scheduled?.reason, 'rate_limit')
    assert.equal(scheduled?.delayMs, 0, 'rotation does not wait')
  })

  test('401 marks the key DEAD: the next call starts on the surviving key', async () => {
    const h = harness([http(401, 'invalid api key'), ok('model-a'), ok('model-a')])
    await h.call()
    await h.call()
    assert.deepEqual(
      h.inner.seen.map(s => s.apiKey),
      ['key-a', 'key-b', 'key-b'],
    )
    assert.equal(h.pool.snapshot()[0]?.dead, true)
  })

  test('402 billing kills the key and rotates', async () => {
    const h = harness([http(402, 'insufficient balance'), ok('model-a')])
    await h.call()
    assert.equal(h.pool.snapshot()[0]?.deadReason, 'billing')
    assert.deepEqual(
      h.inner.seen.map(s => s.apiKey),
      ['key-a', 'key-b'],
    )
  })

  test('single key + Retry-After: waits the published delay on the same key', async () => {
    const h = harness([http(429, 'slow down', { retryAfterMs: 250 }), ok('model-a')], {
      keys: ['key-a'],
    })
    const res = await h.call()
    assert.equal(res.text, 'ok')
    assert.deepEqual(h.sleeps, [250])
    assert.deepEqual(
      h.inner.seen.map(s => s.apiKey),
      ['key-a', 'key-a'],
    )
  })

  test('stay-on-primary: a reset sooner than the threshold beats rotation', async () => {
    const h = harness([http(429, 'slow down', { retryAfterMs: 2_000 }), ok('model-a')], {
      config: { stayOnPrimaryResetMs: 60_000 },
    })
    await h.call()
    assert.deepEqual(
      h.inner.seen.map(s => s.apiKey),
      ['key-a', 'key-a'],
      'no rotation when the reset is near',
    )
    assert.deepEqual(h.sleeps, [2_000])
  })

  test('upstream 429 falls back to the configured model on the SAME key', async () => {
    const h = harness(
      [http(429, 'Upstream model provider is temporarily unavailable'), ok('model-flash')],
      { config: { fallbackModels: { fake: { 'model-pro': 'model-flash' } } } },
    )
    const res = await h.call('model-pro')
    assert.equal(res.model, 'model-flash')
    assert.deepEqual(
      h.inner.seen.map(s => `${s.apiKey}:${s.model}`),
      ['key-a:model-pro', 'key-a:model-flash'],
    )
    assert.equal(h.pool.snapshot()[0]?.benchedModels.length, 0, 'key never benched')
  })

  test('entitlement rotates: another account may hold the model', async () => {
    const h = harness([http(403, 'model_not_supported', { code: 'model_not_supported' }), ok('model-pro')])
    await h.call('model-pro')
    assert.deepEqual(
      h.inner.seen.map(s => s.apiKey),
      ['key-a', 'key-b'],
    )
  })

  test('context overflow surfaces the compress hint after exactly one attempt', async () => {
    const h = harness([http(400, 'prompt is too long', { code: 'context_length_exceeded' })])
    await assert.rejects(
      h.call(),
      (err: unknown) =>
        err instanceof ResilienceError &&
        err.classified.reason === 'context_overflow' &&
        err.classified.hints.compress === true &&
        err.attempts === 1,
    )
    assert.equal(h.inner.seen.length, 1)
  })

  test('content policy gives up on the route with a provider-fallback hint', async () => {
    const h = harness([http(400, 'rejected', { code: 'content_filter' })])
    await assert.rejects(
      h.call(),
      (err: unknown) =>
        err instanceof ResilienceError &&
        err.classified.reason === 'content_policy' &&
        err.classified.hints.fallbackProvider === true,
    )
    assert.equal(h.inner.seen.length, 1)
  })

  test('server errors retry the same key on the default backoff ladder', async () => {
    const h = harness([http(500, 'boom'), http(500, 'boom'), ok('model-a')])
    const res = await h.call()
    assert.equal(res.text, 'ok')
    assert.deepEqual(h.sleeps, [500, 1000])
    assert.deepEqual(
      h.inner.seen.map(s => s.apiKey),
      ['key-a', 'key-a', 'key-a'],
    )
  })

  test('exhausted attempts throw a classified ResilienceError (fallback hints intact)', async () => {
    const h = harness([http(500, 'boom'), http(500, 'boom'), http(500, 'boom')])
    await assert.rejects(
      h.call(),
      (err: unknown) =>
        err instanceof ResilienceError &&
        err.attempts === 3 &&
        err.classified.reason === 'server_error' &&
        err.classified.hints.fallbackProvider === true,
    )
  })

  test('disabled: the raw provider error propagates untouched, one call, no events', async () => {
    const raw = http(500, 'boom')
    const h = harness([raw], { config: { enabled: false } })
    await assert.rejects(h.call(), (err: unknown) => err === raw)
    assert.equal(h.inner.seen.length, 1)
    assert.deepEqual(h.events, [])
  })
})

describe('resilienceConfigFromEnv', () => {
  test('defaults: on, 3 attempts, stay-on-primary off', () => {
    const c = resilienceConfigFromEnv({} as NodeJS.ProcessEnv)
    assert.equal(c.enabled, true)
    assert.equal(c.maxAttempts, 3)
    assert.equal(c.stayOnPrimaryResetMs, 0)
  })
  test('REDTEAM_LLM_RESILIENCE=off disables', () => {
    const c = resilienceConfigFromEnv({ REDTEAM_LLM_RESILIENCE: 'off' } as NodeJS.ProcessEnv)
    assert.equal(c.enabled, false)
  })
  test('fallback maps parse', () => {
    const c = resilienceConfigFromEnv({
      REDTEAM_LLM_FALLBACK_MODELS: 'deepseek:deepseek-v4-pro>deepseek-flash',
      REDTEAM_LLM_FALLBACK_PROVIDERS: 'deepseek>qwen:qwen3.8-max',
    } as NodeJS.ProcessEnv)
    assert.equal(c.fallbackModels['deepseek']?.['deepseek-v4-pro'], 'deepseek-flash')
    assert.deepEqual(c.fallbackProviders['deepseek'], { provider: 'qwen', model: 'qwen3.8-max' })
  })
  test('malformed values fail loud', () => {
    assert.throws(() =>
      resilienceConfigFromEnv({ REDTEAM_LLM_MAX_ATTEMPTS: 'soon' } as NodeJS.ProcessEnv),
    )
    assert.throws(() =>
      resilienceConfigFromEnv({ REDTEAM_LLM_FALLBACK_MODELS: 'deepseek-v4-pro' } as NodeJS.ProcessEnv),
    )
  })
})

describe('trajectory log cause fields (Q-HALT Item 1)', () => {
  test('a failed completion writes http_status, error_code, and cause_excerpt to the JSONL record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resilience-log-'))
    const logPath = join(dir, 'trajectories.jsonl')
    const inner = new FakeProvider([http(400, 'rejected', { code: 'content_filter' })])
    const provider = new ResilientProvider(inner, {
      pool: new CredentialPool('fake', ['key-a']),
      config: config({ logPath }),
      sleep: async () => {},
    })
    await assert.rejects(
      provider.complete({ model: 'model-a', messages: [{ role: 'user', content: 'hi' }] }),
      (err: unknown) => err instanceof ResilienceError,
    )
    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    const failed = lines
      .map(line => JSON.parse(line) as Record<string, unknown>)
      .find(record => record['kind'] === 'llm/attempt-failed')
    assert.ok(failed, 'an attempt-failed record was written')
    assert.equal(failed['http_status'], 400)
    assert.equal(failed['error_code'], 'content_filter')
    assert.ok(String(failed['cause_excerpt']).includes('provider=fake'), String(failed['cause_excerpt']))
  })
})

describe('safety-rejection fixture (Q-HALT brief §8, router leg)', () => {
  test('a safety_blocked 400 surfaces content_policy with the cause on the attempt-failed event', async () => {
    const body =
      '{"error":{"code":"safety_blocked","message":"Request blocked by the safety system: the submitted content may violate policy."}}'
    const fixture = await providerErrorFromResponse('fake', 'Fake', new Response(body, { status: 400 }))
    const h = harness([fixture])
    await assert.rejects(
      h.call(),
      (err: unknown) =>
        err instanceof ResilienceError &&
        err.classified.reason === 'content_policy' &&
        err.classified.hints.fallbackProvider === true &&
        err.attempts === 1,
    )
    assert.equal(h.inner.seen.length, 1)
    const failed = h.events.find(e => e.kind === 'attempt-failed')
    assert.equal(failed?.status, 400)
    assert.equal(failed?.code, 'safety_blocked')
    assert.ok(failed?.causeExcerpt?.includes('safety system'), failed?.causeExcerpt)
  })
})
