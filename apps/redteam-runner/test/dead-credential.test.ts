/**
 * FIX-DEADKEY fail-fast: the engagement-start dead-credential check.
 * All-dead for the fleet provider produces the honest halt reason (death
 * + provider evidence + remedy, never a rate-limit label); anything else
 * passes through.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PoolSnapshot } from '@secscan/redteam-llm-router'
import { deadCredentialHaltReason } from '../src/phases/dead-credential.js'

const DEAD_AT = 1_700_000_000_000

function metaSnap(entries: PoolSnapshot['entries']): PoolSnapshot[] {
  return [{ providerId: 'meta', entries }]
}

describe('deadCredentialHaltReason (FIX-DEADKEY)', () => {
  it('is silent without a pool, for another provider, or while a key lives', () => {
    assert.equal(deadCredentialHaltReason([], 'meta'), undefined)
    assert.equal(
      deadCredentialHaltReason(
        [{ providerId: 'deepseek', entries: [{ keyId: 0, fingerprint: 'ab12cd34', dead: true, benchedModels: [] }] }],
        'meta',
      ),
      undefined,
    )
    assert.equal(deadCredentialHaltReason(metaSnap([]), 'meta'), undefined)
    assert.equal(
      deadCredentialHaltReason(
        metaSnap([
          { keyId: 0, fingerprint: 'ab12cd34', dead: true, deadReason: 'auth_dead', benchedModels: [] },
          { keyId: 1, fingerprint: '9f3c77aa', dead: false, benchedModels: [] },
        ]),
        'meta',
      ),
      undefined,
      'a living key means the pool rotates and serves — no halt',
    )
  })

  it('names the death, the provider evidence, and the remedy when every key is dead', () => {
    const reason = deadCredentialHaltReason(
      metaSnap([
        {
          keyId: 0,
          fingerprint: 'cf323c24',
          dead: true,
          deadReason: 'auth_dead',
          deadAtMs: DEAD_AT,
          deadStatus: 401,
          deadCode: 'invalid_api_key',
          benchedModels: [],
        },
      ]),
      'meta',
    )
    assert.ok(reason)
    assert.match(reason, /provider 'meta'/)
    assert.match(reason, /…cf323c24/)
    assert.match(reason, /auth_dead/)
    assert.match(reason, /HTTP 401/)
    assert.match(reason, /invalid_api_key/)
    assert.match(reason, new RegExp(new Date(DEAD_AT).toISOString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(reason, /not a rate limit/)
    assert.match(reason, /Re-seat a valid provider key \(MODEL_API_KEY\)/)
    assert.doesNotMatch(reason, /benched/)
    assert.doesNotMatch(reason, /rate_limit/)
  })

  it('still halts honestly when the death record predates the evidence fields', () => {
    const reason = deadCredentialHaltReason(
      metaSnap([{ keyId: 0, fingerprint: 'ab12cd34', dead: true, deadReason: 'billing', benchedModels: [] }]),
      'meta',
    )
    assert.ok(reason)
    assert.match(reason, /billing/)
    assert.match(reason, /Re-seat/)
  })
})
