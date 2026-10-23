/**
 * CredentialPool: fill-first acquisition, per-(key, model) benching,
 * DEAD terminal states, and cooldown math — all on a fake clock.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ClassifiedFailure, FailoverReason } from '../src/classifier.js'
import {
  CredentialPool,
  collectCredentialEnv,
  cooldownMsForFailure,
  COOLDOWN_MAX_MS,
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
