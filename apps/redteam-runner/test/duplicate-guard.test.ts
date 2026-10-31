/**
 * Duplicate-call guard tests (PentAGI alignment A1).
 *
 * The guard refuses an identical repeat of a target-traffic call that
 * already completed, and refuses a third identical attempt after two
 * failures. No engagement, no network: the guard functions run against a
 * minimal ctx whose event log is captured in memory.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  NEAR_DUP_IGNORED_KEYS,
  duplicateRefusal,
  nearKey,
  recordCallOutcome,
  toolCallKey,
} from '../src/dispatch/duplicate-guard.js'
import { type Ctx } from '../src/context.js'
import { type ActorRole, type EngagementPhase } from '../src/types.js'
import { type ToolCallRequest } from '@secscan/redteam-llm-router'

const ROLE = 'recon' as ActorRole
const PHASE = 'recon' as EngagementPhase
const HOST = 'lab.local'

function fakeCtx() {
  const appended: Array<{ action: string; result: string }> = []
  const ctx = {
    events: {
      append: (e: { action: string; result: string }) => {
        appended.push({ action: e.action, result: e.result })
      },
    },
  } as unknown as Ctx
  return { ctx, appended }
}

function probe(args: Record<string, unknown>): ToolCallRequest {
  return { id: 'call-1', name: 'http_probe', arguments: args }
}

const CLEAN = { result: '200 OK — server banner Apache/2.4', ok: true }
const FAILED = { result: 'probe failed: connection refused', ok: false }

describe('duplicate guard', () => {
  it('lets a first call execute, then refuses the identical repeat with the previous digest', () => {
    const { ctx, appended } = fakeCtx()
    const call = probe({ url: 'http://lab.local/admin' })
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, call, HOST), undefined)
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, CLEAN)
    const refusal = duplicateRefusal(ctx, ROLE, PHASE, call, HOST)
    assert.ok(refusal)
    assert.match(refusal.result, /^DENIED: duplicate call refused/)
    assert.match(refusal.result, /Apache\/2\.4/)
    assert.equal(refusal.ok, false)
    assert.equal(refusal.target, HOST)
    assert.deepEqual(appended.map(e => e.action), ['duplicate_refused'])
  })

  it('treats argument key order as the same call', () => {
    const { ctx } = fakeCtx()
    recordCallOutcome(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/', method: 'GET' }), HOST, CLEAN)
    const refusal = duplicateRefusal(ctx, ROLE, PHASE, probe({ method: 'GET', url: 'http://lab.local/' }), HOST)
    assert.ok(refusal)
  })

  it('lets a different call execute after a recorded one', () => {
    const { ctx } = fakeCtx()
    recordCallOutcome(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/a' }), HOST, CLEAN)
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/b' }), HOST), undefined)
  })

  it('allows one retry of a failed call and refuses the third identical attempt', () => {
    const { ctx } = fakeCtx()
    const call = probe({ url: 'http://lab.local/flaky' })
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, FAILED)
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, call, HOST), undefined)
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, FAILED)
    const refusal = duplicateRefusal(ctx, ROLE, PHASE, call, HOST)
    assert.ok(refusal)
    assert.match(refusal.result, /already\s+failed 2 times/)
  })

  it('a clean result after a failure makes the repeat a completed-duplicate', () => {
    const { ctx } = fakeCtx()
    const call = probe({ url: 'http://lab.local/retry' })
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, FAILED)
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, CLEAN)
    const refusal = duplicateRefusal(ctx, ROLE, PHASE, call, HOST)
    assert.ok(refusal)
    assert.match(refusal.result, /already\s+completed/)
  })

  it('scopes the guard by role and by phase', () => {
    const { ctx } = fakeCtx()
    const call = probe({ url: 'http://lab.local/admin' })
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, CLEAN)
    assert.equal(duplicateRefusal(ctx, 'exploiter' as ActorRole, PHASE, call, HOST), undefined)
    assert.equal(duplicateRefusal(ctx, ROLE, 'exploit' as EngagementPhase, call, HOST), undefined)
  })

  it('never guards calls without a target host', () => {
    const { ctx, appended } = fakeCtx()
    const call = probe({ url: 'http://lab.local/admin' })
    recordCallOutcome(ctx, ROLE, PHASE, call, undefined, CLEAN)
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, call, undefined), undefined)
    assert.deepEqual(appended, [])
  })
})

describe('near-duplicate guard (Item 9)', () => {
  /** Run fn with http_probe's cosmetic key listed, restoring the shipped (empty) table after. */
  function withTimeoutIgnored(fn: () => void): void {
    const table = NEAR_DUP_IGNORED_KEYS as Record<string, readonly string[]>
    table['http_probe'] = ['timeout']
    try {
      fn()
    } finally {
      delete table['http_probe']
    }
  }

  it("ships empty: an unlisted tool's near key is its exact key, and varied calls are allowed", () => {
    assert.equal(NEAR_DUP_IGNORED_KEYS['http_probe'], undefined)
    assert.equal(
      nearKey(probe({ url: 'http://lab.local/a', timeout: 5 })),
      toolCallKey(probe({ url: 'http://lab.local/a', timeout: 5 })),
    )
    const { ctx } = fakeCtx()
    recordCallOutcome(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/a', timeout: 5 }), HOST, CLEAN)
    // Varied arguments, no table entry: near key equals exact key, so
    // this is not even an exact repeat — allowed, exactly as today.
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/a', timeout: 9 }), HOST), undefined)
  })

  it('refuses the second call when only an ignored key varied after a clean first call, digest carried', () => {
    withTimeoutIgnored(() => {
      const { ctx, appended } = fakeCtx()
      recordCallOutcome(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/admin', timeout: 5 }), HOST, CLEAN)
      const refusal = duplicateRefusal(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/admin', timeout: 30 }), HOST)
      assert.ok(refusal)
      assert.match(refusal.result, /near-duplicate/)
      assert.match(refusal.result, /Apache\/2\.4/, 'previous digest carried')
      assert.equal(refusal.ok, false)
      assert.deepEqual(appended.map(e => e.action), ['duplicate_refused'])
      assert.match(appended[0]!.result, /near-duplicate/, 'event text marks the near-duplicate')
    })
  })

  it('refuses a near-duplicate after a FAILED first call — no failure grace', () => {
    withTimeoutIgnored(() => {
      const { ctx } = fakeCtx()
      recordCallOutcome(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/flaky', timeout: 5 }), HOST, FAILED)
      // The exact rule tolerates one retry of a failed call; the
      // cosmetically-varied repeat is refused immediately.
      const refusal = duplicateRefusal(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/flaky', timeout: 10 }), HOST)
      assert.ok(refusal)
      assert.match(refusal.result, /near-duplicate/)
      assert.match(refusal.result, /no\s+failure grace/)
    })
  })

  it('allows semantic variation even when ignored keys also vary', () => {
    withTimeoutIgnored(() => {
      const { ctx } = fakeCtx()
      recordCallOutcome(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/a', timeout: 5 }), HOST, CLEAN)
      assert.equal(duplicateRefusal(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/b', timeout: 30 }), HOST), undefined)
      assert.equal(
        duplicateRefusal(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/a', method: 'POST', timeout: 30 }), HOST),
        undefined,
      )
    })
  })

  it('keeps role, phase, and host isolation for near-duplicates', () => {
    withTimeoutIgnored(() => {
      const { ctx } = fakeCtx()
      recordCallOutcome(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/x', timeout: 5 }), HOST, CLEAN)
      const varied = probe({ url: 'http://lab.local/x', timeout: 9 })
      assert.equal(duplicateRefusal(ctx, 'exploiter' as ActorRole, PHASE, varied, HOST), undefined)
      assert.equal(duplicateRefusal(ctx, ROLE, 'exploit' as EngagementPhase, varied, HOST), undefined)
      assert.equal(duplicateRefusal(ctx, ROLE, PHASE, varied, 'other.local'), undefined)
    })
  })

  it('a gate-denied first call never seeds the near guard', () => {
    withTimeoutIgnored(() => {
      const { ctx } = fakeCtx()
      // Denials never reach recordCallOutcome; a near-identical first
      // EXECUTED call afterwards must be allowed.
      assert.equal(duplicateRefusal(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/y', timeout: 5 }), HOST), undefined)
      recordCallOutcome(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/y', timeout: 5 }), HOST, CLEAN)
      assert.ok(duplicateRefusal(ctx, ROLE, PHASE, probe({ url: 'http://lab.local/y', timeout: 6 }), HOST))
    })
  })

  it('an exact repeat keeps the exact refusal text even with keys listed', () => {
    withTimeoutIgnored(() => {
      const { ctx } = fakeCtx()
      const call = probe({ url: 'http://lab.local/z', timeout: 5 })
      recordCallOutcome(ctx, ROLE, PHASE, call, HOST, CLEAN)
      const refusal = duplicateRefusal(ctx, ROLE, PHASE, call, HOST)
      assert.ok(refusal)
      assert.match(refusal.result, /with identical arguments already\s+completed/)
      assert.doesNotMatch(refusal.result, /near-duplicate/)
    })
  })
})
