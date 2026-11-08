/**
 * Dead-key revival (Stage-2 B2): the exact operator sequence — seat a
 * key, watch a 402 kill it, re-seat a valid key, run again WITHOUT a
 * restart. CredentialPool.refreshKeys is the seam: the pool reconciles
 * with the resolver's current key set by fingerprint. Semantics mirror
 * a restart exactly (construction + restore does the same reconcile):
 * a NEW key enters alive; re-presenting the SAME dead key changes
 * nothing (the provider still rejects it); a key removed and later
 * re-seated starts unproven, and its first call re-establishes the
 * truth — the file was converged when it left the pool.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyError } from '../src/classifier.js'
import { ProviderError } from '../src/errors.js'
import { CredentialPool, type PoolStateStore } from '../src/pool.js'

/** In-memory PoolStateStore: the shared document as one mutable string. */
function memoryStore(): PoolStateStore & { text: string | null } {
  const store = {
    text: null as string | null,
    read(): string | null {
      return store.text
    },
    write(text: string): void {
      store.text = text
    },
  }
  return store
}

function billingDeath(pool: CredentialPool, keyId: number): void {
  const failure = classifyError(
    new ProviderError({ provider: pool.providerId, message: 'HTTP 402: billing', status: 402, code: 'billing' }),
  )
  assert.equal(failure.reason, 'billing')
  pool.reportFailure(keyId, 'any-model', failure)
}

describe('CredentialPool.refreshKeys — revival without a restart', () => {
  it('seat → 402-kill → re-seat a valid key → alive, same process, no restart', () => {
    const store = memoryStore()
    const pool = new CredentialPool('meta', ['key-A'], { store })

    // The key dies on a 402; the death persists to the shared document.
    billingDeath(pool, 0)
    assert.equal(pool.snapshot()[0]?.dead, true)
    assert.match(store.text ?? '', /"dead": true/)

    // Re-presenting the SAME key (a bare refresh) revives nothing:
    // the provider still rejects that key, and the pool knows it.
    assert.equal(pool.refreshKeys(['key-A']), false)
    assert.equal(pool.snapshot()[0]?.dead, true)

    // The operator re-seats a VALID key under the same ref: the pool
    // reconciles — the dead entry drops, the new key serves.
    assert.equal(pool.refreshKeys(['key-B']), true)
    const entries = pool.snapshot()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.dead, false)
    assert.notEqual(entries[0]?.fingerprint, undefined)
    // The persisted document converged: no dead entry remains.
    assert.doesNotMatch(store.text ?? '', /"dead": true/)

    // A steady-state refresh is a no-op.
    assert.equal(pool.refreshKeys(['key-B']), false)
  })

  it('a removed key’s replacement key keeps its own bookkeeping when the first key returns unproven', () => {
    const store = memoryStore()
    const pool = new CredentialPool('meta', ['key-A'], { store })
    billingDeath(pool, 0)
    pool.refreshKeys(['key-B'])
    // key-A returns: its death record was pruned from the converged
    // document when it left the pool (restart-equivalent semantics),
    // so it re-enters unproven rather than pre-dead.
    pool.refreshKeys(['key-A'])
    assert.equal(pool.snapshot()[0]?.dead, false)
  })

  it('the death still survives a real restart (persistence unchanged)', () => {
    const store = memoryStore()
    const first = new CredentialPool('meta', ['key-A'], { store })
    billingDeath(first, 0)
    const second = new CredentialPool('meta', ['key-A'], { store })
    assert.equal(second.snapshot()[0]?.dead, true, 'restore pronounces the recorded death')
    assert.equal(second.restoreReport?.restoredEntries, 1)
  })

  it('rotation sets reconcile by fingerprint: survivors keep state, order follows the new set', () => {
    const store = memoryStore()
    const pool = new CredentialPool('meta', ['key-A', 'key-B'], { store })
    billingDeath(pool, 0) // key-A dies
    assert.equal(pool.refreshKeys(['key-B', 'key-A']), true)
    const entries = pool.snapshot()
    assert.equal(entries.length, 2)
    assert.equal(entries[0]?.dead, false, 'key-B leads and lives')
    assert.equal(entries[1]?.dead, true, 'key-A keeps its death after the reorder')
  })
})
