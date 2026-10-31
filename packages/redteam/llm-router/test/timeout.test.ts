/**
 * Completion-timeout policy: a hanging provider call must abort on its
 * deadline, and the caller's signal must still win. All fakes — no network.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { completionSignal, resolveCompletionTimeoutMs } from '../src/timeout.js'

describe('completionSignal', () => {
  test('returns undefined when there is no caller signal and no timeout', () => {
    assert.equal(completionSignal(undefined, 0), undefined)
  })

  test('returns the caller signal unchanged when the timeout is 0', () => {
    const c = new AbortController()
    assert.equal(completionSignal(c.signal, 0), c.signal)
  })

  test('aborts after the deadline when there is no caller signal', async () => {
    const s = completionSignal(undefined, 40)
    assert.ok(s)
    assert.equal(s!.aborted, false)
    await new Promise(resolve => s!.addEventListener('abort', resolve, { once: true }))
    assert.equal(s!.aborted, true)
  })

  test('aborts immediately when the caller signal aborts', () => {
    const c = new AbortController()
    const s = completionSignal(c.signal, 60_000)
    assert.equal(s!.aborted, false)
    c.abort()
    assert.equal(s!.aborted, true)
  })

  test('does not abort early when the deadline is far away and the caller is quiet', async () => {
    const s = completionSignal(undefined, 60_000)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(s!.aborted, false)
  })
})

describe('resolveCompletionTimeoutMs', () => {
  test('defaults to 300000 with no env', () => {
    assert.equal(resolveCompletionTimeoutMs({}), 300_000)
  })

  test('honours REDTEAM_LLM_TIMEOUT_MS', () => {
    assert.equal(resolveCompletionTimeoutMs({ REDTEAM_LLM_TIMEOUT_MS: '1234' }), 1234)
  })

  test('ignores non-positive and non-numeric values', () => {
    assert.equal(resolveCompletionTimeoutMs({ REDTEAM_LLM_TIMEOUT_MS: '0' }), 300_000)
    assert.equal(resolveCompletionTimeoutMs({ REDTEAM_LLM_TIMEOUT_MS: '-5' }), 300_000)
    assert.equal(resolveCompletionTimeoutMs({ REDTEAM_LLM_TIMEOUT_MS: 'abc' }), 300_000)
  })
})
