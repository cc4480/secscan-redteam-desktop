/**
 * describeErrorCause: the provider's words survive wrapping.
 *
 * The ProviderError a ResilienceError wraps as `cause` carries status,
 * code, and the body excerpt; describeErrorCause unwraps it, and the
 * ResilienceError message itself embeds the same excerpt so a caller that
 * only logs err.message at the router funnel still sees the provider's
 * words. These tests pin both surfaces so a future refactor cannot
 * silently sever the chain the Q-HALT incident proved was unread.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { classifyError } from '../src/classifier.js'
import { ProviderError, describeErrorCause } from '../src/errors.js'
import { ResilienceError, executeStep } from '../src/executor.js'

function providerFailure(): ProviderError {
  return new ProviderError({
    provider: 'fake',
    message: '[llm-router] Fake HTTP 400: {"error":{"message":"blocked by the safety system"}}',
    status: 400,
    code: 'safety_blocked',
  })
}

describe('describeErrorCause', () => {
  test('a direct ProviderError yields provider, status, code, and the body with our framing stripped', () => {
    const text = describeErrorCause(providerFailure())
    assert.ok(text !== undefined)
    assert.ok(text.startsWith('provider=fake HTTP 400 code=safety_blocked: '), text)
    assert.ok(text.includes('blocked by the safety system'), text)
    assert.ok(!text.includes('[llm-router]'), text)
  })

  test('a ResilienceError wrapping a ProviderError surfaces the provider cause (the production shape)', async () => {
    const cause = providerFailure()
    let thrown: unknown
    await assert.rejects(
      executeStep({
        run: async () => {
          throw cause
        },
        initial: { providerId: 'fake', model: 'model-a' },
        maxAttempts: 1,
      }),
      (err: unknown) => {
        thrown = err
        return err instanceof ResilienceError
      },
    )
    const text = describeErrorCause(thrown)
    assert.ok(text !== undefined)
    assert.ok(text.includes('provider=fake HTTP 400 code=safety_blocked'), text)
    assert.ok(text.includes('blocked by the safety system'), text)
  })

  test('the cause chain itself is pinned: executeStep exposes the original ProviderError at err.cause', async () => {
    const cause = providerFailure()
    await assert.rejects(
      executeStep({
        run: async () => {
          throw cause
        },
        initial: { providerId: 'fake', model: 'model-a' },
        maxAttempts: 1,
      }),
      (err: unknown) => err instanceof ResilienceError && err.cause === cause,
    )
  })

  test('no ProviderError in the chain: falls back to the deepest Error message', () => {
    const wrapped = new ResilienceError(
      classifyError(new Error('classification input')),
      1,
      new Error('outer wrap', { cause: new Error('the root failure') }),
    )
    assert.equal(describeErrorCause(wrapped), 'the root failure')
    assert.equal(describeErrorCause(new Error('plain failure')), 'plain failure')
  })

  test('the ResilienceError message itself carries rule, status, and body excerpt (content_policy)', async () => {
    const cause = providerFailure()
    await assert.rejects(
      executeStep({
        run: async () => {
          throw cause
        },
        initial: { providerId: 'fake', model: 'model-a' },
        maxAttempts: 1,
      }),
      (err: unknown) => {
        if (!(err instanceof ResilienceError)) return false
        assert.equal(err.classified.reason, 'content_policy')
        assert.ok(err.message.includes('content_policy'), err.message)
        assert.ok(err.message.includes('content-pattern'), err.message)
        assert.ok(err.message.includes('HTTP 400'), err.message)
        assert.ok(err.message.includes('blocked by the safety system'), err.message)
        assert.ok(String(err).includes('blocked by the safety system'), String(err))
        assert.equal(err.cause, cause)
        return true
      },
    )
  })

  test('the ResilienceError message itself carries rule, status, and body excerpt (5xx)', async () => {
    const cause = new ProviderError({
      provider: 'fake',
      message: '[llm-router] Fake HTTP 500: upstream exploded in shard 7',
      status: 500,
    })
    await assert.rejects(
      executeStep({
        run: async () => {
          throw cause
        },
        initial: { providerId: 'fake', model: 'model-a' },
        maxAttempts: 1,
      }),
      (err: unknown) => {
        if (!(err instanceof ResilienceError)) return false
        assert.equal(err.classified.reason, 'server_error')
        assert.ok(err.message.includes('server_error'), err.message)
        assert.ok(err.message.includes('HTTP 500'), err.message)
        assert.ok(err.message.includes('upstream exploded in shard 7'), err.message)
        assert.equal(err.cause, cause)
        return true
      },
    )
  })

  test('non-Error input has nothing describable', () => {
    assert.equal(describeErrorCause('a string failure'), undefined)
    assert.equal(describeErrorCause(undefined), undefined)
    assert.equal(describeErrorCause(null), undefined)
    assert.equal(describeErrorCause(42), undefined)
  })

  test('the result is hard-capped with a trailing ellipsis', () => {
    const big = new ProviderError({
      provider: 'fake',
      message: `[llm-router] Fake HTTP 500: ${'x'.repeat(1000)}`,
      status: 500,
    })
    const text = describeErrorCause(big)
    assert.ok(text !== undefined)
    assert.equal(text.length, 300)
    assert.ok(text.endsWith('…'), text)
    const short = describeErrorCause(big, 40)
    assert.ok(short !== undefined)
    assert.equal(short.length, 40)
    assert.ok(short.endsWith('…'), short)
  })

  test('absent status and code are omitted, not rendered empty', () => {
    const transport = new ProviderError({ provider: 'fake', message: 'request failed: fetch failed' })
    assert.equal(describeErrorCause(transport), 'provider=fake: request failed: fetch failed')
  })
})
