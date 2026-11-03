/**
 * Mid-run autonomy tier changes.
 *
 * The defect this pins shut: `refreshTierFromDisk` adopted whatever `tier.json`
 * said, with no approval consult and no direction check. Anything able to write
 * the engagement directory — an offered `bridge_write_file` is enough — could move
 * a run from Tier 0 to Tier 2 and the audit log would record it as though an
 * operator had asked. Raising autonomy now requires a matching `tier-escalation`
 * approval; lowering it never does.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { refreshTierFromDisk } from '../src/dispatch/router.js'
import type { Ctx } from '../src/context.js'
import type { ApprovalEntry } from '../src/accountability/accountability.js'

function sandbox(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tier-refresh-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

interface Harness { ctx: Ctx; events: Array<{ action: string; result: string }> }

function harness(dir: string, tier: 0 | 1 | 2, approvals: Partial<ApprovalEntry>[]): Harness {
  const events: Array<{ action: string; result: string }> = []
  const ctx = {
    events: {
      dir,
      append: (e: { action: string; result: string }) => { events.push(e) },
    },
    tier: { current: tier },
    approvals: { list: () => approvals as ApprovalEntry[] },
  } as unknown as Ctx
  return { ctx, events }
}

function writeTier(dir: string, tier: number, by?: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'tier.json'), JSON.stringify({
    tier, declared: tier, environment: 'staging',
    updatedAt: new Date().toISOString(), ...(by === undefined ? {} : { by }),
  }))
}

describe('refreshTierFromDisk — autonomy is a governance act', () => {
  it('refuses an upward change with no matching approval', () => {
    const { dir, cleanup } = sandbox()
    try {
      writeTier(dir, 2, 'tier.json')
      const h = harness(dir, 0, [])
      refreshTierFromDisk(h.ctx, 'exploit')
      assert.equal(h.ctx.tier.current, 0, 'the run escalated on a bare file write')
      assert.equal(h.events.length, 1)
      assert.equal(h.events[0]?.action, 'tier_change_refused')
      assert.match(h.events[0]?.result ?? '', /no matching tier-escalation approval/)
    } finally {
      cleanup()
    }
  })

  it('adopts an upward change that has a matching approval', () => {
    const { dir, cleanup } = sandbox()
    try {
      writeTier(dir, 2)
      const h = harness(dir, 0, [{ kind: 'tier-escalation', fromTier: 0, toTier: 2 }])
      refreshTierFromDisk(h.ctx, 'exploit')
      assert.equal(h.ctx.tier.current, 2)
      assert.equal(h.events[0]?.action, 'tier_changed')
      assert.match(h.events[0]?.result ?? '', /matching operator approval/)
    } finally {
      cleanup()
    }
  })

  it('approval for a different tier does not authorise this one', () => {
    const { dir, cleanup } = sandbox()
    try {
      writeTier(dir, 2)
      const h = harness(dir, 0, [{ kind: 'tier-escalation', fromTier: 0, toTier: 1 }])
      refreshTierFromDisk(h.ctx, 'exploit')
      assert.equal(h.ctx.tier.current, 0)
      assert.equal(h.events[0]?.action, 'tier_change_refused')
    } finally {
      cleanup()
    }
  })

  it('a downward change needs no approval', () => {
    const { dir, cleanup } = sandbox()
    try {
      writeTier(dir, 0)
      const h = harness(dir, 2, [])
      refreshTierFromDisk(h.ctx, 'exploit')
      assert.equal(h.ctx.tier.current, 0)
      assert.equal(h.events[0]?.action, 'tier_changed')
    } finally {
      cleanup()
    }
  })
})
