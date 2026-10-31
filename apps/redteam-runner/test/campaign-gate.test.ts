/**
 * Campaign wave gate (Q-CAMPAIGN, Decision C-1) — the recorded-decision
 * battery.
 *
 * Pins the donor's core safety property as mechanical law: a wave runs
 * only on an operator's explicit, recorded advance. A fresh campaign is
 * operator-gated with auto-advance OFF; a launch with no authorizing
 * decision on record is refused; caps bind even against recorded
 * decisions; an enabled auto-advance flag whose enabling decision does
 * not resolve authorizes nothing (fail-closed); and every refusal says
 * why. Decisions themselves are validated receipts — anonymous,
 * mis-shaped, or post-terminal decisions cannot be recorded.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CampaignGateError,
  assertLaunchAllowed,
  evaluateLaunch,
  nextWaveIndex,
  recordOperatorDecision,
} from '../src/campaign/gate.js'
import {
  beginWave,
  campaignFile,
  createCampaign,
  loadCampaign,
  recordTransition,
  recordWaveOutcome,
  type CreateCampaignInput,
} from '../src/campaign/store.js'

let root: string
let campaignsDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'campaign-gate-'))
  campaignsDir = join(root, 'campaigns')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function make(over: Partial<CreateCampaignInput> = {}): void {
  createCampaign(campaignsDir, {
    id: 'camp-gate',
    name: 'Gate',
    kind: 'web-hunt',
    objective: 'Gate battery fixture',
    scope: { hosts: ['127.0.0.1'], verificationRef: 'dns-txt:fixture' },
    caps: { maxWaves: 3 },
    createdBy: 'Carlos',
    ...over,
  })
}

function finishWave(waveIndex: number): void {
  beginWave(campaignsDir, 'camp-gate', waveIndex, { engagementId: `eng-${waveIndex}` })
  recordWaveOutcome(campaignsDir, 'camp-gate', waveIndex, { status: 'complete', findings: [] })
}

describe('the gated default', () => {
  it('a fresh campaign is operator-gated: auto-advance OFF, wave 1 refused without a start decision', () => {
    make()
    const rec = loadCampaign(campaignsDir, 'camp-gate')
    assert.equal(rec.autoAdvance.enabled, false)
    const ev = evaluateLaunch(rec, 1)
    assert.equal(ev.allowed, false)
    assert.match(ev.reason, /operator-gated/)
    assert.throws(() => assertLaunchAllowed(rec, 1), CampaignGateError)
  })

  it('a recorded start decision authorizes wave 1 — and only wave 1', () => {
    make()
    const d = recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'start' })
    assert.equal(d.seq, 0)
    assert.equal(d.operator, 'Carlos')
    assert.ok(d.ts)
    const rec = loadCampaign(campaignsDir, 'camp-gate')
    const ev = evaluateLaunch(rec, 1)
    assert.equal(ev.allowed, true)
    assert.equal(ev.via, 'operator-decision')
    assert.equal(ev.decisionSeq, 0)
    assert.equal(evaluateLaunch(rec, 2).allowed, false)
  })

  it('after wave 1, wave 2 is refused until an advance decision names it', () => {
    make()
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'start' })
    finishWave(1)
    let rec = loadCampaign(campaignsDir, 'camp-gate')
    assert.equal(evaluateLaunch(rec, 2).allowed, false)
    const d = recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'advance', waveIndex: 2 })
    assert.equal(d.waveIndex, 2)
    rec = loadCampaign(campaignsDir, 'camp-gate')
    const ev = evaluateLaunch(rec, 2)
    assert.equal(ev.allowed, true)
    assert.equal(ev.via, 'operator-decision')
    // the same decision does not leak to wave 3
    assert.equal(evaluateLaunch(rec, 3).allowed, false)
  })

  it('refuses out-of-sequence and already-launched waves with reasons', () => {
    make()
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'advance', waveIndex: 2 })
    let rec = loadCampaign(campaignsDir, 'camp-gate')
    const seq = evaluateLaunch(rec, 2)
    assert.equal(seq.allowed, false)
    assert.match(seq.reason, /out of sequence/)
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'start' })
    beginWave(campaignsDir, 'camp-gate', 1, { engagementId: 'eng-1' })
    rec = loadCampaign(campaignsDir, 'camp-gate')
    const again = evaluateLaunch(rec, 1)
    assert.equal(again.allowed, false)
    assert.match(again.reason, /already launched/)
    assert.equal(nextWaveIndex(rec), 2)
  })

  it('caps bind in every path: an advance decision cannot authorize a wave past the cap', () => {
    make({ caps: { maxWaves: 2 } })
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'advance', waveIndex: 3 })
    const rec = loadCampaign(campaignsDir, 'camp-gate')
    const ev = evaluateLaunch(rec, 3)
    assert.equal(ev.allowed, false)
    assert.match(ev.reason, /exceeds the campaign cap/)
  })

  it('a stopped campaign refuses launches and further decisions', () => {
    make()
    recordTransition(campaignsDir, 'camp-gate', 'stopped', 'operator stopped the campaign')
    const rec = loadCampaign(campaignsDir, 'camp-gate')
    assert.equal(evaluateLaunch(rec, 1).allowed, false)
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'start' }),
      CampaignGateError,
    )
  })
})

describe('recorded auto-advance (C-1 opt-in)', () => {
  it('enabling records who/when/cap in the auto-advance state and covers waves up to the cap', () => {
    make()
    const d = recordOperatorDecision(campaignsDir, 'camp-gate', {
      operator: 'Carlos',
      kind: 'enable-auto-advance',
      maxWave: 2,
    })
    let rec = loadCampaign(campaignsDir, 'camp-gate')
    assert.equal(rec.autoAdvance.enabled, true)
    assert.equal(rec.autoAdvance.maxWave, 2)
    assert.equal(rec.autoAdvance.enabledBy, 'Carlos')
    assert.equal(rec.autoAdvance.decisionSeq, d.seq)

    assert.equal(evaluateLaunch(rec, 1).via, 'auto-advance')
    finishWave(1)
    rec = loadCampaign(campaignsDir, 'camp-gate')
    const ev2 = evaluateLaunch(rec, 2)
    assert.equal(ev2.allowed, true)
    assert.equal(ev2.via, 'auto-advance')
    finishWave(2)
    rec = loadCampaign(campaignsDir, 'camp-gate')
    const ev3 = evaluateLaunch(rec, 3)
    assert.equal(ev3.allowed, false)
    assert.match(ev3.reason, /caps at wave 2/)
  })

  it('disabling returns the campaign to the gated default; a later advance decision still works', () => {
    make()
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'enable-auto-advance', maxWave: 3 })
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'disable-auto-advance' })
    let rec = loadCampaign(campaignsDir, 'camp-gate')
    assert.equal(rec.autoAdvance.enabled, false)
    assert.equal(evaluateLaunch(rec, 1).allowed, false)
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'start' })
    rec = loadCampaign(campaignsDir, 'camp-gate')
    assert.equal(evaluateLaunch(rec, 1).allowed, true)
  })

  it('fails closed when the enabled flag cannot resolve to its enabling decision', () => {
    make()
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'enable-auto-advance', maxWave: 2 })
    // Hand-edit the record: point the state at a decision that does not exist.
    const file = campaignFile(campaignsDir, 'camp-gate')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    parsed.autoAdvance.decisionSeq = 99
    writeFileSync(file, JSON.stringify(parsed, null, 2))
    const rec = loadCampaign(campaignsDir, 'camp-gate') // schema shape is valid...
    const ev = evaluateLaunch(rec, 1) // ...but the gate resolves the decision itself
    assert.equal(ev.allowed, false)
    assert.match(ev.reason, /fail-closed/)
  })
})

describe('decision recording discipline', () => {
  it('rejects anonymous and mis-shaped decisions', () => {
    make()
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: ' ', kind: 'start' }),
      CampaignGateError,
    )
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'advance' }),
      CampaignGateError,
    )
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'advance', waveIndex: 1 }),
      CampaignGateError,
    )
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'start', waveIndex: 2 }),
      CampaignGateError,
    )
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'enable-auto-advance' }),
      CampaignGateError,
    )
    assert.throws(
      () =>
        recordOperatorDecision(campaignsDir, 'camp-gate', {
          operator: 'Carlos',
          kind: 'enable-auto-advance',
          maxWave: 4, // beyond the campaign cap of 3
        }),
      CampaignGateError,
    )
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'disable-auto-advance' }),
      CampaignGateError, // nothing to disable
    )
    // none of the failed attempts landed in the record
    assert.deepEqual(loadCampaign(campaignsDir, 'camp-gate').decisions, [])
  })

  it('rejects a double enable and an enable whose cap is already behind the next wave', () => {
    make()
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'enable-auto-advance', maxWave: 2 })
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'enable-auto-advance', maxWave: 3 }),
      CampaignGateError,
    )
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'disable-auto-advance' })
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'start' })
    finishWave(1) // next launchable wave is now 2
    assert.throws(
      () => recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'enable-auto-advance', maxWave: 1 }),
      CampaignGateError,
    )
  })

  it('decisions accumulate as an append-only receipt trail with monotonic seq', () => {
    make()
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Carlos', kind: 'start', note: 'go' })
    recordOperatorDecision(campaignsDir, 'camp-gate', { operator: 'Judith', kind: 'pause' })
    const rec = loadCampaign(campaignsDir, 'camp-gate')
    assert.deepEqual(
      rec.decisions.map(d => [d.seq, d.operator, d.kind]),
      [
        [0, 'Carlos', 'start'],
        [1, 'Judith', 'pause'],
      ],
    )
    assert.equal(rec.decisions[0].note, 'go')
  })
})
