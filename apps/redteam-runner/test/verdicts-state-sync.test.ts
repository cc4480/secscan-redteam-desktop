/**
 * Q-PROVEN Step 2 — syncLiveFindingsToState carries the cell verdict.
 *
 * RECONSTRUCTION (2026-10-31, H8): Agent A's originally drafted state-sync
 * test was parked in an agent-side /tmp and lost to the /tmp namespace
 * split. This file is re-derived from the build brief's Step 2 test
 * prescription (fake ctx capturing updateState; the three fields ride
 * through; absence stays absence) — it is not A's original text.
 *
 * The console state findings must show the same cell verdict as the
 * report findings: cellState/provenClaim/cellDetail copy from the live
 * finding, and an unadjudicated finding keeps all three absent.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { syncLiveFindingsToState } from '../src/dispatch/verdicts.js'
import type { Ctx, LiveFinding } from '../src/context.js'
import type { Finding } from '../src/types.js'

function live(over: Partial<LiveFinding> = {}): LiveFinding {
  return {
    severity: 'high',
    title: 'Reflected XSS in search',
    attackId: 'T1059',
    evidence: 'marker reflected',
    ...over,
  }
}

function runSync(liveFindings: LiveFinding[]): Finding[] {
  let captured: { findings?: Finding[] } | undefined
  const ctx = {
    liveFindings,
    events: {
      updateState: (partial: { findings?: Finding[] }) => {
        captured = partial
      },
    },
  } as unknown as Ctx
  syncLiveFindingsToState(ctx)
  assert.ok(captured?.findings, 'updateState received findings')
  return captured.findings
}

describe('syncLiveFindingsToState cell-verdict carry (Q-PROVEN Step 2)', () => {
  it('a proven live finding carries all three fields into state', () => {
    const [f] = runSync([
      live({
        cellState: 'proven',
        provenClaim: { expectedMarker: 'REDTEAM-MARKER-x1', targetUrl: 'https://t.example/search' },
        cellDetail: 'Challenger critique + verification signed, negative control passed.',
      }),
    ])
    assert.equal(f!.cellState, 'proven')
    assert.deepEqual(f!.provenClaim, { expectedMarker: 'REDTEAM-MARKER-x1', targetUrl: 'https://t.example/search' })
    assert.equal(f!.cellDetail, 'Challenger critique + verification signed, negative control passed.')
  })

  it('a detected live finding carries detected + its claim fields', () => {
    const [f] = runSync([
      live({
        cellState: 'detected',
        provenClaim: { expectedMarker: 'M-2', targetUrl: 'https://t.example/a' },
        cellDetail: 'Control also reflected the marker — claim falsified.',
      }),
    ])
    assert.equal(f!.cellState, 'detected')
    assert.deepEqual(f!.provenClaim, { expectedMarker: 'M-2', targetUrl: 'https://t.example/a' })
    assert.equal(f!.cellDetail, 'Control also reflected the marker — claim falsified.')
  })

  it('an unadjudicated finding keeps all three fields absent', () => {
    const [f] = runSync([live()])
    assert.equal(f!.cellState, undefined)
    assert.equal(f!.provenClaim, undefined)
    assert.equal(f!.cellDetail, undefined)
  })

  it('positional ids and severity coercion are unchanged by the carry', () => {
    const findings = runSync([live({ severity: 'CRITICAL' }), live({ severity: 'bogus' })])
    assert.equal(findings[0]!.id, 'F-1')
    assert.equal(findings[0]!.severity, 'critical')
    assert.equal(findings[1]!.id, 'F-2')
    assert.equal(findings[1]!.severity, 'low')
    assert.equal(findings[0]!.status, 'confirmed')
  })
})
