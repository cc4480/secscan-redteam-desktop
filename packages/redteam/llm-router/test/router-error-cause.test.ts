/**
 * Router funnel: the provider's words survive to the router's exit.
 *
 * A mocked provider's failed HTTP response becomes a ProviderError (via
 * providerErrorFromResponse, the production builder), is classified and
 * wrapped by the resilience layer, and escapes complete() /
 * completeWithCharter() as a ResilienceError. These tests pin that a
 * caller doing nothing but String(err) / err.message at that exit sees
 * the classified rule, the HTTP status, and the provider body excerpt —
 * no describeErrorCause unwrap required — with the original ProviderError
 * still at err.cause. The success path through the same funnel is
 * unchanged.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ProviderError, providerErrorFromResponse, type FailedResponse } from '../src/errors.js'
import { ResilienceError } from '../src/executor.js'
import { ResilientProvider, type ResilienceConfig } from '../src/resilience.js'
import { complete, completeWithCharter, registerProvider } from '../src/router.js'
import type { CharterEngagement } from '../src/charter/loader.js'
import type { ChatResult, CompleteOptions, LlmProvider } from '../src/types.js'

function config(overrides: Partial<ResilienceConfig> = {}): ResilienceConfig {
  return {
    enabled: true,
    maxAttempts: 1,
    stayOnPrimaryResetMs: 0,
    maxDelayMs: 30_000,
    maxBenchWaitMs: 240_000,
    fallbackModels: {},
    fallbackProviders: {},
    logPath: null,
    ...overrides,
  }
}

function fakeResponse(status: number, body: string): FailedResponse {
  return {
    status,
    headers: { get: () => null },
    text: async () => body,
  }
}

/** A provider whose every call fails with the given HTTP response, built
 *  through providerErrorFromResponse exactly as the real providers do. */
class FailingProvider implements LlmProvider {
  readonly label = 'Failing Fake'
  constructor(
    readonly id: string,
    private readonly status: number,
    private readonly body: string,
  ) {}
  isConfigured(): boolean {
    return true
  }
  async complete(_options: CompleteOptions): Promise<ChatResult> {
    throw await providerErrorFromResponse(this.id, 'Failing Fake', fakeResponse(this.status, this.body))
  }
}

class OkProvider implements LlmProvider {
  readonly id = 'router-cause-ok'
  readonly label = 'Ok Fake'
  isConfigured(): boolean {
    return true
  }
  async complete(options: CompleteOptions): Promise<ChatResult> {
    return { text: 'ok', toolCalls: [], provider: this.id, model: options.model }
  }
}

function registerFailing(id: string, status: number, body: string): void {
  registerProvider(
    new ResilientProvider(new FailingProvider(id, status, body), {
      config: config(),
      sleep: async () => {},
    }),
  )
}

registerFailing(
  'router-cause-policy',
  400,
  '{"error":{"code":"content_filter","message":"This request was flagged by our safety system: prompt blocked"}}',
)
registerFailing(
  'router-cause-5xx',
  500,
  '{"error":{"message":"upstream exploded: shard 7 on fire"}}',
)
registerProvider(
  new ResilientProvider(new OkProvider(), { config: config(), sleep: async () => {} }),
)

const MESSAGES = [{ role: 'user' as const, content: 'hi' }]

describe('router funnel error-cause preservation', () => {
  test('a mocked 400 content_policy response surfaces rule, status, and body at the complete() exit', async () => {
    await assert.rejects(
      complete('router-cause-policy', { model: 'm1', messages: MESSAGES }),
      (err: unknown) => {
        if (!(err instanceof ResilienceError)) return false
        assert.equal(err.classified.reason, 'content_policy')
        assert.ok(err.message.includes('content_policy'), err.message)
        assert.ok(err.message.includes('HTTP 400'), err.message)
        assert.ok(err.message.includes('flagged by our safety system'), err.message)
        assert.ok(String(err).includes('prompt blocked'), String(err))
        if (!(err.cause instanceof ProviderError)) return false
        assert.equal(err.cause.status, 400)
        assert.equal(err.cause.code, 'content_filter')
        return true
      },
    )
  })

  test('a mocked 500 response surfaces rule, status, and body at the complete() exit', async () => {
    await assert.rejects(
      complete('router-cause-5xx', { model: 'm1', messages: MESSAGES }),
      (err: unknown) => {
        if (!(err instanceof ResilienceError)) return false
        assert.equal(err.classified.reason, 'server_error')
        assert.ok(err.message.includes('server_error'), err.message)
        assert.ok(err.message.includes('HTTP 500'), err.message)
        assert.ok(err.message.includes('shard 7 on fire'), err.message)
        if (!(err.cause instanceof ProviderError)) return false
        assert.equal(err.cause.status, 500)
        return true
      },
    )
  })

  test('the chartered entry point preserves the same cause at its exit', async () => {
    const engagement: CharterEngagement = {
      engagementId: 'eng-2026-11-01-cause',
      owner: 'Acme Widgets LLC',
      proofMethod: 'DNS TXT record verified 2026-11-01',
      inScope: 'app.acme.example',
    }
    await assert.rejects(
      completeWithCharter({
        engagement,
        role: 'recon',
        messages: MESSAGES,
        routeOverride: { provider: 'router-cause-policy', model: 'm1' },
      }),
      (err: unknown) =>
        err instanceof ResilienceError &&
        err.message.includes('content_policy') &&
        err.message.includes('HTTP 400') &&
        err.message.includes('flagged by our safety system'),
    )
  })

  test('the success path through the funnel is unchanged', async () => {
    const res = await complete('router-cause-ok', { model: 'm1', messages: MESSAGES })
    assert.equal(res.text, 'ok')
    assert.equal(res.provider, 'router-cause-ok')
    assert.equal(res.model, 'm1')
    assert.deepEqual(res.toolCalls, [])
  })
})
