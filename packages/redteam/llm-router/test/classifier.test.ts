/**
 * Classifier table: every FailoverReason from representative provider
 * errors, plus the Retry-After/reset parsing the pool's cooldowns arm from.
 * All errors are fakes — no network, no real keys.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { classifyError } from '../src/classifier.js'
import {
  ProviderError,
  parseRetryAfterHeader,
  providerErrorFromResponse,
} from '../src/errors.js'

function httpError(status: number, body: string, extra: Partial<{ code: string; retryAfterMs: number }> = {}): ProviderError {
  return new ProviderError({
    provider: 'fake',
    message: `[llm-router] Fake HTTP ${status}: ${body}`,
    status,
    ...extra,
  })
}

describe('classifyError', () => {
  test('plain 429 is rate_limit: bench/rotate, key at fault', () => {
    const f = classifyError(httpError(429, 'Rate limit exceeded for this API key'))
    assert.equal(f.reason, 'rate_limit')
    assert.equal(f.hints.retryable, true)
    assert.equal(f.hints.rotateCredential, true)
    assert.equal(f.hints.fallbackModel, false)
    assert.equal(f.hints.compress, false)
  })

  test('429 carries the provider Retry-After through', () => {
    const f = classifyError(httpError(429, 'slow down', { retryAfterMs: 5000 }))
    assert.equal(f.reason, 'rate_limit')
    assert.equal(f.retryAfterMs, 5000)
  })

  test('upstream 429 is upstream_rate_limit: key healthy, change model only', () => {
    const f = classifyError(
      httpError(429, 'Upstream model provider is temporarily unavailable. Please try again in a moment.'),
    )
    assert.equal(f.reason, 'upstream_rate_limit')
    assert.equal(f.hints.rotateCredential, false)
    assert.equal(f.hints.fallbackModel, true)
    assert.equal(f.hints.fallbackProvider, true)
  })

  test('DashScope model-scoped Throttling.RateQuota is upstream', () => {
    const f = classifyError(httpError(429, 'rate quota exceeded', { code: 'Throttling.RateQuota' }))
    assert.equal(f.reason, 'upstream_rate_limit')
    assert.equal(f.hints.rotateCredential, false)
  })

  test('402 is billing: rotate immediately, not retryable on this credential', () => {
    const f = classifyError(httpError(402, 'Payment required'))
    assert.equal(f.reason, 'billing')
    assert.equal(f.hints.rotateCredential, true)
    assert.equal(f.hints.retryable, false)
  })

  test('structured insufficient_quota on a 400 is billing', () => {
    const f = classifyError(httpError(400, 'You exceeded your current quota', { code: 'insufficient_quota' }))
    assert.equal(f.reason, 'billing')
    assert.equal(f.hints.rotateCredential, true)
  })

  test('401 is auth_dead', () => {
    const f = classifyError(httpError(401, 'invalid api key'))
    assert.equal(f.reason, 'auth_dead')
    assert.equal(f.hints.rotateCredential, true)
    assert.equal(f.hints.retryable, false)
  })

  test('403 with an auth body is auth_dead', () => {
    const f = classifyError(httpError(403, 'Forbidden: invalid token'))
    assert.equal(f.reason, 'auth_dead')
  })

  test('403 written by a CDN is server_error with a healthy key', () => {
    const f = classifyError(httpError(403, 'Attention Required! | Cloudflare — your request was blocked'))
    assert.equal(f.reason, 'server_error')
    assert.equal(f.hints.rotateCredential, false)
    assert.equal(f.hints.fallbackProvider, true)
  })

  test('model_not_supported is entitlement: model-scoped, another key may hold it', () => {
    const f = classifyError(httpError(403, 'model_not_supported', { code: 'model_not_supported' }))
    assert.equal(f.reason, 'entitlement')
    assert.equal(f.hints.rotateCredential, true)
    assert.equal(f.hints.fallbackModel, true)
    assert.equal(f.hints.retryable, false)
  })

  test('model-not-found 404 is entitlement', () => {
    const f = classifyError(httpError(404, 'The model `gone-1` does not exist'))
    assert.equal(f.reason, 'entitlement')
  })

  test('context overflow: compress hint only, no failover', () => {
    const f = classifyError(
      httpError(400, 'prompt is too long', { code: 'context_length_exceeded' }),
    )
    assert.equal(f.reason, 'context_overflow')
    assert.deepEqual(f.hints, {
      retryable: false,
      rotateCredential: false,
      fallbackModel: false,
      fallbackProvider: false,
      compress: true,
    })
  })

  test('content policy: never retry unchanged, provider fallback allowed', () => {
    const f = classifyError(httpError(400, 'rejected', { code: 'content_filter' }))
    assert.equal(f.reason, 'content_policy')
    assert.equal(f.hints.retryable, false)
    assert.equal(f.hints.fallbackProvider, true)
    assert.equal(f.hints.rotateCredential, false)
  })

  test('500 and 503 are server_error, retryable on the same key', () => {
    for (const status of [500, 502, 503, 529]) {
      const f = classifyError(httpError(status, 'internal error'))
      assert.equal(f.reason, 'server_error', `status ${status}`)
      assert.equal(f.hints.retryable, true)
      assert.equal(f.hints.rotateCredential, false)
    }
  })

  test('timeout-shaped failures are timeout', () => {
    const named = new Error('The operation timed out')
    named.name = 'TimeoutError'
    assert.equal(classifyError(named).reason, 'timeout')
    const coded = new ProviderError({ provider: 'fake', message: 'boom', code: 'timeout' })
    assert.equal(classifyError(coded).reason, 'timeout')
  })

  test('transport failures are timeout (detail: transport)', () => {
    const f = classifyError(new TypeError('fetch failed'))
    assert.equal(f.reason, 'timeout')
    assert.equal(f.detail, 'transport')
    assert.equal(f.hints.retryable, true)
  })

  test('legacy plain-Error throws recover their status from the message', () => {
    assert.equal(
      classifyError(new Error('[llm-router] DeepSeek HTTP 429: too many requests')).reason,
      'rate_limit',
    )
    assert.equal(
      classifyError(new Error('[llm-router] Qwen HTTP 500: internal')).reason,
      'server_error',
    )
    assert.equal(
      classifyError(new Error('[llm-router] DeepSeek request failed: fetch failed')).reason,
      'timeout',
    )
  })

  test('generic 400 is unknown and NOT retryable (deterministic request problem)', () => {
    const f = classifyError(httpError(400, 'unknown parameter: temperature'))
    assert.equal(f.reason, 'unknown')
    assert.equal(f.hints.retryable, false)
    assert.equal(f.detail, 'request-validation')
  })

  test('unstructured failure is unknown and retryable', () => {
    const f = classifyError(new Error('something entirely unexpected'))
    assert.equal(f.reason, 'unknown')
    assert.equal(f.hints.retryable, true)
  })
})

// Q-HALT Item 2: the test-lock above ('generic 400 is unknown and NOT
// retryable') now pins "outside ALL tables INCLUDING the safety set" — its
// body matches no content code and no safety phrase, old or new. The block
// below proves the new safety-rejection vocabulary lands in content_policy
// and that the negative controls still classify exactly as before. If the
// lock ever goes red, a pattern here is too broad: narrow the pattern,
// never edit the lock.
describe('safety-rejection 400s', () => {
  const expectContentPolicy = (f: ReturnType<typeof classifyError>): void => {
    assert.equal(f.reason, 'content_policy')
    assert.equal(f.detail, 'content-pattern')
    assert.equal(f.hints.fallbackModel, true)
    assert.equal(f.hints.fallbackProvider, true)
    assert.equal(f.hints.retryable, false)
  }

  test('each safety code classifies content_policy on a neutral body', () => {
    for (const code of [
      'safety_blocked',
      'content_safety_blocked',
      'prohibited_content',
      'guardrail_violation',
      'content_blocked',
    ]) {
      expectContentPolicy(classifyError(httpError(400, 'request rejected by provider', { code })))
    }
  })

  test('each safety phrase classifies content_policy', () => {
    for (const body of [
      'The request was blocked by the safety review team.',
      'Our safety system declined this request.',
      'This content violates policy.',
      'Rejected: policy violation detected.',
      'Removed by content moderation.',
      'The prompt was flagged as inappropriate.',
    ]) {
      expectContentPolicy(classifyError(httpError(400, body)))
    }
  })

  test('negative control: the lock body still falls to the catch-all', () => {
    const f = classifyError(httpError(400, 'unknown parameter: temperature'))
    assert.equal(f.reason, 'unknown')
    assert.equal(f.detail, 'request-validation')
    assert.equal(f.hints.retryable, false)
  })

  test('negative control: billing prose mentioning policy stays billing (402)', () => {
    const f = classifyError(httpError(402, 'payment required: see billing policy'))
    assert.equal(f.reason, 'billing')
  })

  test('negative control: a 429 mentioning policy stays rate_limit', () => {
    const f = classifyError(httpError(429, 'rate limit policy: try again in 5s'))
    assert.equal(f.reason, 'rate_limit')
  })

  test('negative control: an over-long prompt stays context_overflow', () => {
    const f = classifyError(httpError(400, 'prompt is too long for the model'))
    assert.equal(f.reason, 'context_overflow')
  })
})

describe('providerErrorFromResponse', () => {
  test('extracts status, structured code, Retry-After, and reset headers', async () => {
    const res = new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'no credits' } }), {
      status: 402,
      headers: { 'Retry-After': '30', 'x-ratelimit-reset': '2000000000' },
    })
    const err = await providerErrorFromResponse('fake', 'Fake', res, 1_000_000)
    assert.equal(err.status, 402)
    assert.equal(err.code, 'insufficient_quota')
    assert.equal(err.retryAfterMs, 30_000)
    assert.equal(err.resetAtMs, 2_000_000_000_000)
    assert.equal(classifyError(err).reason, 'billing')
  })

  test('non-JSON bodies still classify from status + message', async () => {
    const res = new Response('Service overloaded, try later', { status: 503 })
    const err = await providerErrorFromResponse('fake', 'Fake', res)
    assert.equal(err.code, undefined)
    assert.equal(classifyError(err).reason, 'server_error')
  })
})

describe('parseRetryAfterHeader', () => {
  const now = Date.parse('Wed, 01 Jan 2030 00:00:00 GMT')
  test('delta-seconds', () => {
    assert.equal(parseRetryAfterHeader('45', now), 45_000)
    assert.equal(parseRetryAfterHeader('0', now), 0)
  })
  test('HTTP-date', () => {
    assert.equal(parseRetryAfterHeader('Wed, 01 Jan 2030 00:01:00 GMT', now), 60_000)
    assert.equal(parseRetryAfterHeader('Tue, 01 Jan 2019 00:00:00 GMT', now), 0)
  })
  test('missing or garbage is undefined', () => {
    assert.equal(parseRetryAfterHeader(null, now), undefined)
    assert.equal(parseRetryAfterHeader('', now), undefined)
    assert.equal(parseRetryAfterHeader('soon-ish', now), undefined)
  })
})
