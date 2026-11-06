/**
 * DeepSeek provider: the fleet thinking gate on the wire body. All fakes —
 * no network, no real key.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  DEEPSEEK_API_KEY_ENV,
  DEEPSEEK_MODELS,
  DeepSeekProvider,
} from '../src/providers/deepseek.js'

const THINKING_ENV = 'REDTEAM_DEEPSEEK_THINKING'

const realFetch = globalThis.fetch
const savedEnv = { ...process.env }

afterEach(() => {
  globalThis.fetch = realFetch
  for (const key of [DEEPSEEK_API_KEY_ENV, THINKING_ENV]) {
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

describe('DeepSeekProvider thinking gate', () => {
  test("REDTEAM_DEEPSEEK_THINKING=off adds thinking {type: 'disabled'}; unset leaves the body byte-identical", async () => {
    process.env[DEEPSEEK_API_KEY_ENV] = 'test-key'
    const bodies: string[] = []
    stubFetch(async (_url, init) => {
      bodies.push(String(init?.body))
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    })
    const provider = new DeepSeekProvider()

    delete process.env[THINKING_ENV]
    await provider.complete({
      model: DEEPSEEK_MODELS.flash,
      messages: [{ role: 'user', content: 'hi' }],
    })
    process.env[THINKING_ENV] = 'off'
    await provider.complete({
      model: DEEPSEEK_MODELS.flash,
      messages: [{ role: 'user', content: 'hi' }],
    })

    assert.equal(bodies.length, 2)
    // Gate unset: the exact pre-gate body — no thinking key, no
    // reasoning_effort, nothing added, removed, or reordered.
    assert.equal(bodies[0], JSON.stringify({
      model: DEEPSEEK_MODELS.flash,
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
    }))
    // Gate off: the plugin path's disabled form is the only addition.
    const gated = JSON.parse(bodies[1] ?? '') as Record<string, unknown>
    assert.deepEqual(gated['thinking'], { type: 'disabled' })
    assert.equal('reasoning_effort' in gated, false)
  })
})
