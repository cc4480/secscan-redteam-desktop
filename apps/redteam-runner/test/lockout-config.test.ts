/**
 * Q-LOCKOUT — config plumbing (spec §5.2/§5.4/§7 Config; pair build,
 * Agent B). The lockout numbers resolve exactly like the rest of the
 * runner's REDTEAM_* config: operator env through the fail-loud
 * parseEnvPositiveNumber, explicit opts over env. When nothing is said,
 * the config fields stay undefined and the defaults (threshold 5,
 * campaign ceiling 25, opaque runs 1) apply at the guard — the single
 * source of truth is DEFAULT_LOCKOUT_CONFIG, the same deferred-
 * resolution pattern as maxRpsPerHost. These tests pin both halves:
 * what resolveConfig returns, and the effective numbers the guard
 * runs with.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../src/phases/config.js'
import { CredentialAttemptGuard, lockoutGuardFor } from '../src/safety/lockout.js'

/** resolveConfig refuses to resolve without a provider key (G8); a dummy key satisfies the gate. */
const KEY = { modelApiKey: 'test-key-not-a-real-key' }

describe('resolveConfig — lockout fields (spec §7 Config)', () => {
  it('defaults: fields stay undefined in config; the guard applies 5 / 25 / 1', () => {
    const cfg = resolveConfig({}, KEY)
    assert.equal(cfg.lockoutThreshold, undefined)
    assert.equal(cfg.lockoutTotalFailures, undefined)
    assert.equal(cfg.lockoutOpaqueRuns, undefined)
    const guard = lockoutGuardFor({ safety: {}, config: cfg })
    assert.deepEqual(guard.config, { lockoutThreshold: 5, totalFailureCeiling: 25, opaqueRunsPerHost: 1 })
    assert.equal(guard.failureLimit, 4)
  })

  it('env values resolve onto the config fields and into the guard', () => {
    const cfg = resolveConfig(
      { REDTEAM_LOCKOUT_THRESHOLD: '7', REDTEAM_LOCKOUT_TOTAL: '40', REDTEAM_LOCKOUT_OPAQUE_RUNS: '2' },
      KEY,
    )
    assert.equal(cfg.lockoutThreshold, 7)
    assert.equal(cfg.lockoutTotalFailures, 40)
    assert.equal(cfg.lockoutOpaqueRuns, 2)
    const guard = new CredentialAttemptGuard({
      lockoutThreshold: cfg.lockoutThreshold,
      totalFailureCeiling: cfg.lockoutTotalFailures,
      opaqueRunsPerHost: cfg.lockoutOpaqueRuns,
    })
    assert.deepEqual(guard.config, { lockoutThreshold: 7, totalFailureCeiling: 40, opaqueRunsPerHost: 2 })
    assert.equal(guard.failureLimit, 6)
  })

  it('explicit opts beat env', () => {
    const cfg = resolveConfig({ REDTEAM_LOCKOUT_THRESHOLD: '7' }, { ...KEY, lockoutThreshold: 9 })
    assert.equal(cfg.lockoutThreshold, 9)
  })

  it('invalid values fail loud at resolution, naming the variable', () => {
    for (const bad of ['0', '-2', 'abc']) {
      assert.throws(() => resolveConfig({ REDTEAM_LOCKOUT_THRESHOLD: bad }, KEY), /REDTEAM_LOCKOUT_THRESHOLD/, bad)
    }
    assert.throws(() => resolveConfig({ REDTEAM_LOCKOUT_TOTAL: '0' }, KEY), /REDTEAM_LOCKOUT_TOTAL/)
    assert.throws(() => resolveConfig({ REDTEAM_LOCKOUT_OPAQUE_RUNS: 'abc' }, KEY), /REDTEAM_LOCKOUT_OPAQUE_RUNS/)
  })
})
