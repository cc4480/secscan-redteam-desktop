/**
 * CredentialPool: fill-first acquisition, per-(key, model) benching,
 * DEAD terminal states, and cooldown math — all on a fake clock.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, test } from 'node:test'
import type { ClassifiedFailure, FailoverReason } from '../src/classifier.js'
import {
  CredentialPool,
  collectCredentialEnv,
  cooldownMsForFailure,
  COOLDOWN_MAX_MS,
  type PoolStateStore,
} from '../src/pool.js'

const HINTS_OFF = {
  retryable: false,
  rotateCredential: false,
  fallbackModel: false,
  fallbackProvider: false,
  compress: false,
}

function failure(reason: FailoverReason, extra: Partial<ClassifiedFailure> = {}): ClassifiedFailure {
  return { reason, hints: HINTS_OFF, detail: 'test', ...extra }
}

function fakeClock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

const MODEL = 'model-a'
const OTHER = 'model-b'

describe('collectCredentialEnv', () => {
  test('primary + numbered siblings, blanks skipped, duplicates collapse', () => {
    const env = {
      FAKE_API_KEY: 'key-a',
      FAKE_API_KEY_2: '  ',
      FAKE_API_KEY_3: 'key-b',
      FAKE_API_KEY_4: 'key-a',
      FAKE_API_KEY_5: 'key-c',
    } as NodeJS.ProcessEnv
    assert.deepEqual(collectCredentialEnv(env, 'FAKE_API_KEY'), ['key-a', 'key-b', 'key-c'])
  })
  test('no variables set is an empty pool', () => {
    assert.deepEqual(collectCredentialEnv({} as NodeJS.ProcessEnv, 'FAKE_API_KEY'), [])
  })
})

describe('cooldownMsForFailure', () => {
  test('exponential ladder 60s → 2m → 4m, capped at 4h', () => {
    assert.equal(cooldownMsForFailure(1), 60_000)
    assert.equal(cooldownMsForFailure(2), 120_000)
    assert.equal(cooldownMsForFailure(3), 240_000)
    assert.equal(cooldownMsForFailure(8), 60_000 * 128)
    assert.equal(cooldownMsForFailure(9), COOLDOWN_MAX_MS)
    assert.equal(cooldownMsForFailure(100), COOLDOWN_MAX_MS)
  })
})

describe('CredentialPool', () => {
  test('fill-first: the earliest healthy key serves repeatedly', () => {
    const pool = new CredentialPool('fake', ['key-a', 'key-b'])
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a')
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a')
    assert.equal(pool.isActive(), true)
    assert.equal(new CredentialPool('fake', ['key-a']).isActive(), false)
  })

  test('rate_limit benches the (key, model) pair only', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('rate_limit'))
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-b', 'benched pair rotates')
    assert.equal(pool.acquire(OTHER)?.apiKey, 'key-a', 'other models unaffected')
    clock.advance(59_999)
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-b')
    clock.advance(1)
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a', 'bench lifts at 60s')
  })

  test('consecutive rate limits escalate the cooldown; success resets it', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('rate_limit'))
    clock.advance(60_000)
    pool.reportFailure(0, MODEL, failure('rate_limit'))
    assert.equal(pool.nextAvailableInMs(MODEL), 120_000)
    clock.advance(120_000)
    pool.reportSuccess(0, MODEL)
    pool.reportFailure(0, MODEL, failure('rate_limit'))
    assert.equal(pool.nextAvailableInMs(MODEL), 60_000, 'ladder restarts after a success')
  })

  test('provider Retry-After overrides the exponential ladder', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('rate_limit', { retryAfterMs: 5_000 }))
    assert.equal(pool.nextAvailableInMs(MODEL), 5_000)
    clock.advance(5_000)
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a')
  })

  test('provider reset timestamp arms the bench', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('rate_limit', { resetAtMs: clock.now() + 30_000 }))
    assert.equal(pool.nextAvailableInMs(MODEL), 30_000)
  })

  test('auth_dead is terminal: the key is never re-acquired', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('auth_dead'))
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-b')
    clock.advance(10 * COOLDOWN_MAX_MS)
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-b')
    const snap = pool.snapshot()
    assert.equal(snap[0]?.dead, true)
    assert.equal(snap[0]?.deadReason, 'auth_dead')
  })

  test('billing is terminal for the key', () => {
    const pool = new CredentialPool('fake', ['key-a', 'key-b'])
    pool.reportFailure(0, MODEL, failure('billing'))
    const snap = pool.snapshot()
    assert.equal(snap[0]?.dead, true)
    assert.equal(snap[0]?.deadReason, 'billing')
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-b')
  })

  test('all keys dead: acquire is null and availability is Infinity', () => {
    const pool = new CredentialPool('fake', ['key-a'])
    pool.reportFailure(0, MODEL, failure('auth_dead'))
    assert.equal(pool.acquire(MODEL), null)
    assert.equal(pool.nextAvailableInMs(MODEL), Infinity)
  })

  test('entitlement benches the (key, model) pair permanently; the key stays healthy', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('entitlement'))
    clock.advance(10 * 365 * 24 * 3600 * 1000)
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-b', 'still benched years later')
    assert.equal(pool.acquire(OTHER)?.apiKey, 'key-a', 'key healthy for other models')
    const snap = pool.snapshot()
    assert.equal(snap[0]?.dead, false)
    assert.deepEqual(snap[0]?.benchedModels, [{ model: MODEL, untilMs: null }])
  })

  test('upstream_rate_limit touches no key; benchModel benches the model pool-wide', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('upstream_rate_limit'))
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a', 'key unharmed')
    pool.benchModel(MODEL, 30_000)
    assert.equal(pool.acquire(MODEL), null, 'every key would hit the same upstream wall')
    assert.equal(pool.acquire(OTHER)?.apiKey, 'key-a')
    assert.equal(pool.modelBenchedForMs(MODEL), 30_000)
    clock.advance(30_000)
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a')
  })

  test('server_error and timeout change no credential state', () => {
    const pool = new CredentialPool('fake', ['key-a', 'key-b'])
    pool.reportFailure(0, MODEL, failure('server_error'))
    pool.reportFailure(0, MODEL, failure('timeout'))
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a')
    assert.deepEqual(pool.snapshot()[0]?.benchedModels, [])
  })

  test('snapshots never contain raw keys', () => {
    const pool = new CredentialPool('fake', ['super-secret-key-a', 'super-secret-key-b'])
    const json = JSON.stringify(pool.snapshot())
    assert.equal(json.includes('super-secret'), false)
    assert.equal(pool.snapshot()[0]?.fingerprint.length, 8)
  })
})

/** In-memory PoolStateStore: the document is a string, quarantine moves it aside. */
class MemoryPoolStore implements PoolStateStore {
  text: string | null = null
  quarantinedText: string | null = null
  read(): string | null {
    return this.text
  }
  write(text: string): void {
    this.text = text
  }
  quarantine(): string | null {
    if (this.text === null) return null
    this.quarantinedText = this.text
    this.text = null
    return 'memory.corrupt'
  }
}

function fingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 8)
}

describe('CredentialPool persistence (PoolStateStore)', () => {
  test('T-P1 round-trip: benches, permanent bench, dead entry, and pool-wide bench survive a restart', () => {
    const clock = fakeClock()
    const store = new MemoryPoolStore()
    const a = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now, store })
    a.reportFailure(0, MODEL, failure('rate_limit'))
    a.reportFailure(0, OTHER, failure('entitlement'))
    a.reportFailure(1, MODEL, failure('auth_dead'))
    a.benchModel(OTHER, 30_000)
    const b = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now, store })
    assert.deepEqual(b.snapshot(), a.snapshot())
    assert.equal(b.modelBenchedForMs(OTHER), a.modelBenchedForMs(OTHER))
    assert.equal(b.acquire(MODEL), null, 'key-a benched, key-b dead: nobody serves MODEL')
    assert.equal(b.restoreReport?.restoredEntries, 2)
    assert.equal(b.restoreReport?.prunedEntries, 0)
    assert.equal(b.restoreReport?.quarantined, false)
    clock.advance(60_000)
    assert.equal(b.acquire(MODEL)?.apiKey, 'key-a', 'rate bench lifts on schedule after restore')
    assert.equal(b.acquire(OTHER), null, 'key-a permanently benched for OTHER and key-b dead: nobody serves it')
  })

  test('T-P2 lapse on restore: lapsed benches drop, permanent benches and failure counts survive', () => {
    const clock = fakeClock()
    const store = new MemoryPoolStore()
    const a = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now, store })
    a.reportFailure(0, MODEL, failure('rate_limit', { retryAfterMs: 5_000 }))
    a.reportFailure(0, OTHER, failure('entitlement'))
    a.reportFailure(1, MODEL, failure('rate_limit'))
    clock.advance(6_000)
    const b = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now, store })
    assert.equal(b.restoreReport?.droppedLapsed, 1)
    assert.equal(b.acquire(MODEL)?.apiKey, 'key-a', 'lapsed pair serves immediately')
    assert.equal(b.acquire(OTHER)?.apiKey, 'key-b', 'permanent bench on (key-a, OTHER) survives')
    b.reportFailure(1, MODEL, failure('rate_limit'))
    const keyBBench = b.snapshot()[1]?.benchedModels.find(bench => bench.model === MODEL)
    assert.equal(keyBBench?.untilMs, 1_126_000, 'restored failure count escalates the ladder (2nd failure = 120s)')
  })

  test('T-P3 identity by fingerprint: a replaced key starts clean; unmatched state prunes', () => {
    const clock = fakeClock()
    const store = new MemoryPoolStore()
    const a = new CredentialPool('fake', ['key-a'], { now: clock.now, store })
    a.reportFailure(0, MODEL, failure('auth_dead'))
    const b = new CredentialPool('fake', ['key-a-replaced'], { now: clock.now, store })
    assert.equal(b.acquire(MODEL)?.apiKey, 'key-a-replaced', 'new value is not punished for its predecessor')
    assert.equal(b.restoreReport?.prunedEntries, 1)
    assert.equal(b.restoreReport?.restoredEntries, 0)
  })

  test('T-P4 penalty isolation: a restored bench touches only its own (key, model) pair', () => {
    const clock = fakeClock()
    const store = new MemoryPoolStore()
    const a = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now, store })
    a.reportFailure(0, MODEL, failure('rate_limit'))
    const b = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now, store })
    assert.equal(b.acquire(MODEL)?.apiKey, 'key-b', '(key-a, MODEL) is benched')
    assert.equal(b.acquire(OTHER)?.apiKey, 'key-a', '(key-a, OTHER) is untouched')
    assert.equal(b.nextAvailableInMs(OTHER), 0)
    const primaryBenchUntil = () =>
      b.snapshot()[0]?.benchedModels.find(bench => bench.model === MODEL)?.untilMs
    assert.equal(primaryBenchUntil(), 1_060_000)
    b.reportFailure(0, 'fallback-model', failure('rate_limit'))
    assert.equal(primaryBenchUntil(), 1_060_000, "a fallback model's failure never extends the primary's bench")
    clock.advance(60_000)
    assert.equal(b.acquire(MODEL)?.apiKey, 'key-a', 'the primary bench lifts on its original schedule')
  })

  test('T-P5 corruption: garbage, truncated, and wrong-version documents reseed without throwing', () => {
    const badDocuments = [
      'not json at all {{{',
      '{"version":1,"updatedAt":"x","providers":{"fake":{"entries":[',
      '{"version":99,"updatedAt":"x","providers":{}}',
      '{"version":1,"updatedAt":"x","providers":{"fake":{"entries":"nope","modelBenches":[]}}}',
    ]
    for (const bad of badDocuments) {
      const store = new MemoryPoolStore()
      store.text = bad
      const pool = new CredentialPool('fake', ['key-a'], { store })
      assert.equal(pool.restoreReport?.quarantined, true)
      assert.equal(store.quarantinedText, bad, 'the bad document is preserved aside, not overwritten')
      assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a', 'pool reseeds empty and serves')
      pool.reportFailure(0, MODEL, failure('auth_dead'))
      const doc = JSON.parse(store.text ?? 'null') as {
        version: number
        providers: { fake: { entries: Array<{ dead: boolean }> } }
      }
      assert.equal(doc.version, 1)
      assert.equal(doc.providers.fake.entries[0]?.dead, true, 'the next mutation writes a fresh valid document')
    }
  })

  test('malformed entries drop one by one; valid siblings restore', () => {
    const store = new MemoryPoolStore()
    store.text = JSON.stringify({
      version: 1,
      updatedAt: 'x',
      providers: {
        fake: {
          entries: [
            { fingerprint: fingerprint('key-a'), dead: 'yes', benches: [] },
            { fingerprint: fingerprint('key-b'), dead: true, deadReason: 'auth_dead', benches: [] },
            { fingerprint: fingerprint('key-b'), dead: false, benches: [{ model: 7, untilMs: null, failures: 1 }] },
          ],
          modelBenches: [{ model: MODEL, untilMs: 'soon' }],
        },
      },
    })
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { store })
    assert.equal(pool.restoreReport?.quarantined, false)
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-a', 'the wrong-typed entry dropped; key-b is dead by its valid entry')
    const snap = pool.snapshot()
    assert.equal(snap[0]?.dead, false)
    assert.equal(snap[1]?.dead, true)
    assert.equal(snap[1]?.deadReason, 'auth_dead')
  })

  test('save failure never breaks a call: mutations continue in memory', () => {
    const store: PoolStateStore = {
      read: () => null,
      write: () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      },
    }
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { store })
    pool.reportFailure(0, MODEL, failure('auth_dead'))
    assert.equal(pool.acquire(MODEL)?.apiKey, 'key-b')
    pool.benchModel(MODEL, 1_000)
    assert.equal(pool.acquire(MODEL), null)
  })

  test('non-state-changing failures write nothing', () => {
    const store = new MemoryPoolStore()
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { store })
    pool.reportFailure(0, MODEL, failure('server_error'))
    pool.reportFailure(0, MODEL, failure('timeout'))
    pool.reportFailure(0, MODEL, failure('upstream_rate_limit'))
    pool.reportSuccess(0, MODEL)
    assert.equal(store.text, null)
  })
})

describe('CredentialPool death record + refusal explanation (FIX-DEADKEY)', () => {
  test('the persisted death entry carries status, code, and the death timestamp', () => {
    const clock = fakeClock()
    const store = new MemoryPoolStore()
    const pool = new CredentialPool('fake', ['key-a'], { now: clock.now, store })
    pool.reportFailure(0, MODEL, failure('auth_dead', { status: 401, code: 'invalid_api_key' }))
    const doc = JSON.parse(store.text ?? 'null') as {
      providers: {
        fake: {
          entries: Array<{
            dead: boolean
            deadReason?: string
            deadAtMs?: number
            deadStatus?: number
            deadCode?: string
          }>
        }
      }
    }
    const entry = doc.providers.fake.entries[0]
    assert.equal(entry?.dead, true)
    assert.equal(entry?.deadReason, 'auth_dead')
    assert.equal(entry?.deadAtMs, 1_000_000, 'death stamped on the pool clock')
    assert.equal(entry?.deadStatus, 401)
    assert.equal(entry?.deadCode, 'invalid_api_key')

    // And the record survives a restart onto the snapshot surface.
    const restored = new CredentialPool('fake', ['key-a'], { now: clock.now, store })
    const snap = restored.snapshot()[0]
    assert.equal(snap?.dead, true)
    assert.equal(snap?.deadAtMs, 1_000_000)
    assert.equal(snap?.deadStatus, 401)
    assert.equal(snap?.deadCode, 'invalid_api_key')
  })

  test('a death recorded without provider fields persists reason + timestamp only', () => {
    const clock = fakeClock()
    const store = new MemoryPoolStore()
    const pool = new CredentialPool('fake', ['key-a'], { now: clock.now, store })
    pool.reportFailure(0, MODEL, failure('billing'))
    const snap = pool.snapshot()[0]
    assert.equal(snap?.deadReason, 'billing')
    assert.equal(snap?.deadAtMs, 1_000_000)
    assert.equal(snap?.deadStatus, undefined)
    assert.equal(snap?.deadCode, undefined)
  })

  test('refusalExplanation: all-dead names every death; a living key clears it', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('auth_dead', { status: 401, code: 'invalid_api_key' }))
    assert.equal(pool.refusalExplanation(MODEL), undefined, 'key-b still serves')
    pool.reportFailure(1, MODEL, failure('billing', { status: 402 }))
    const refusal = pool.refusalExplanation(MODEL)
    assert.equal(refusal?.kind, 'all-dead')
    assert.equal(refusal?.dead.length, 2)
    assert.equal(refusal?.dead[0]?.deadReason, 'auth_dead')
    assert.equal(refusal?.dead[0]?.deadStatus, 401)
    assert.equal(refusal?.dead[0]?.deadCode, 'invalid_api_key')
    assert.equal(refusal?.dead[0]?.deadAtMs, 1_000_000)
    assert.equal(refusal?.dead[1]?.deadReason, 'billing')
  })

  test('refusalExplanation: a pool-wide model bench outranks per-key state', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now })
    pool.benchModel(MODEL, 30_000)
    const refusal = pool.refusalExplanation(MODEL)
    assert.equal(refusal?.kind, 'model-benched')
    assert.equal(refusal?.benchUntilMs, 1_030_000)
    clock.advance(30_001)
    assert.equal(pool.refusalExplanation(MODEL), undefined, 'bench lapsed: keys serve again')
  })

  test('refusalExplanation: keys-benched reports the earliest lift; permanent benches flagged', () => {
    const clock = fakeClock()
    const pool = new CredentialPool('fake', ['key-a', 'key-b'], { now: clock.now })
    pool.reportFailure(0, MODEL, failure('rate_limit', { retryAfterMs: 5_000 }))
    pool.reportFailure(1, MODEL, failure('entitlement'))
    const refusal = pool.refusalExplanation(MODEL)
    assert.equal(refusal?.kind, 'keys-benched')
    assert.equal(refusal?.benchUntilMs, 1_005_000)
    assert.equal(refusal?.permanentBench, true)
    assert.equal(pool.refusalExplanation(OTHER), undefined, 'other models are untouched')
  })
})
