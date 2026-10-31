/**
 * Campaign executor battery (Q-CAMPAIGN, Agent A half).
 *
 * The executor-level proofs the pair owes (the gate/store battery in
 * campaign-gate/store/integration covers B's half):
 *
 *  1. GATED ADVANCE THROUGH THE EXECUTOR — launchCampaignWave refuses
 *     wave 1 with no recorded decision, refuses wave 2 with no advance
 *     decision, and launches each wave only once its decision exists.
 *     This is Decision C-1 proven at the surface that actually starts
 *     engagements, not just at the gate function.
 *  2. WAVE-TO-ENGAGEMENT BINDING — the engagement the fake runner
 *     receives carries the campaign's verified scope as its target and
 *     ROE scope, the campaign objective plus the wave aim as its
 *     objective, and the deterministic engagement id.
 *  3. BRIEF ACCUMULATION — wave 2's brief demonstrably contains wave
 *     1's outcome (aim + counts) and the caller-supplied history
 *     digest; a garbage planner reply lands on the deterministic
 *     fallback roster with the reason on the plan.
 *  4. FAILURE SETTLES — a throwing engagement call leaves the wave
 *     "failed" (never stuck "running") and the error propagates.
 *  5. KIND REGISTRY — exactly one v1 kind; "ad" can never resolve.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CampaignGateError, recordOperatorDecision } from '../src/campaign/gate.js'
import { createCampaign, loadCampaign } from '../src/campaign/store.js'
import { getCampaignKind, listCampaignKinds, validateCampaignKind } from '../src/campaign/kinds.js'
import { planNextWave } from '../src/campaign/planner.js'
import { launchCampaignWave } from '../src/campaign/executor.js'
import { pauseCampaign } from '../src/campaign/lifecycle.js'
import type { EngagementInput, EngagementResult, Finding } from '../src/types.js'

let root: string
let campaignsDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'campaign-executor-'))
  campaignsDir = join(root, 'campaigns')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function finding(id: string, status: Finding['status'], severity: Finding['severity'], title: string): Finding {
  return { id, severity, title, attackIds: [], evidence: 'fixture evidence', fix: 'fixture fix', retest: 'fixture retest', status }
}

function makeCampaign(id = 'camp-exec', maxWaves = 2): void {
  createCampaign(campaignsDir, {
    id,
    name: 'Executor fixture',
    kind: 'web-hunt',
    objective: 'Prove the campaign executor end to end',
    scope: { hosts: ['app.example.test'], verificationRef: 'dns-txt:fixture' },
    caps: { maxWaves },
    createdBy: 'Carlos',
  })
}

/** A fake engagement runner: captures every input, returns canned results in order. */
function fakeRunner(results: EngagementResult[]) {
  const inputs: EngagementInput[] = []
  const runFn = async (input: EngagementInput): Promise<EngagementResult> => {
    inputs.push(input)
    const next = results.shift()
    if (!next) throw new Error('fake runner exhausted')
    return next
  }
  return { inputs, runFn }
}

const wave1Result: EngagementResult = {
  engagementId: 'ignored-by-executor',
  status: 'complete',
  reportPath: 'engagements/live/x/report.md',
  findings: [
    finding('F-1', 'confirmed', 'high', 'Stored XSS in profile bio'),
    finding('F-2', 'killed', 'low', 'SQL injection in id parameter'),
  ],
}
const wave2Result: EngagementResult = {
  engagementId: 'ignored-by-executor',
  status: 'complete',
  findings: [finding('F-1', 'confirmed', 'critical', 'IDOR on invoice download')],
}

describe('campaign executor — gated advance (C-1)', () => {
  it('refuses wave 1 without a start decision, wave 2 without an advance decision, and binds scope + brief when authorized', async () => {
    makeCampaign()
    const { inputs, runFn } = fakeRunner([wave1Result, wave2Result])

    // No decision on record: the executor refuses before any launch.
    // (Planning the wave is not launching it — the record legitimately
    // shows the standing plan as "armed"; the C-1 invariant is that no
    // engagement runs and no wave is marked launched.)
    await assert.rejects(
      () => launchCampaignWave({ campaignsDir, campaignId: 'camp-exec', runFn }),
      (err: unknown) => err instanceof CampaignGateError,
    )
    assert.equal(inputs.length, 0, 'a refused launch must never reach the engagement runner')
    const refused = loadCampaign(campaignsDir, 'camp-exec')
    assert.equal(refused.status, 'armed')
    assert.equal(refused.waves[0]?.status, 'planned')
    assert.equal(refused.waves[0]?.launchedAt, undefined)

    // Wave 1 under a recorded start decision.
    recordOperatorDecision(campaignsDir, 'camp-exec', { operator: 'Carlos', kind: 'start' })
    const r1 = await launchCampaignWave({ campaignsDir, campaignId: 'camp-exec', runFn })
    assert.equal(r1.wave.index, 1)
    assert.equal(r1.wave.status, 'complete')
    assert.equal(r1.wave.engagementId, 'camp-exec-wave-1')
    assert.equal(r1.campaign.status, 'awaiting-advance')
    assert.equal(r1.wave.outcome?.rollup.confirmed, 1)
    assert.equal(r1.wave.outcome?.rollup.killed, 1)
    assert.equal(r1.gate.via, 'operator-decision')

    // Binding: target + ROE scope come from the campaign's verified
    // scope; the objective carries the campaign objective and the aim.
    assert.equal(inputs.length, 1)
    assert.equal(inputs[0]?.target, 'app.example.test')
    assert.deepEqual(inputs[0]?.roe.scope, ['app.example.test'])
    assert.match(inputs[0]?.objective ?? '', /Prove the campaign executor end to end/)
    assert.match(inputs[0]?.objective ?? '', /Wave 1 aim:/)

    // Wave 2 is gated too — the start decision does not carry it.
    await assert.rejects(
      () => launchCampaignWave({ campaignsDir, campaignId: 'camp-exec', runFn }),
      (err: unknown) => err instanceof CampaignGateError,
    )
    assert.equal(inputs.length, 1)

    // Wave 2 under its advance decision. The standing plan from the
    // refused attempt is the plan that launches — a plan made is a
    // plan kept (an operator may have reviewed it between the refusal
    // and the decision); it is a fallback plan because that attempt
    // ran with no planner completion configured. The brief still
    // carries wave 1's outcome plus the supplied history digest.
    recordOperatorDecision(campaignsDir, 'camp-exec', { operator: 'Carlos', kind: 'advance', waveIndex: 2 })
    const r2 = await launchCampaignWave({
      campaignsDir,
      campaignId: 'camp-exec',
      runFn,
      completion: async () => 'the planner rambles on with no json at all',
      historyDigest: 'Wave 1 confirmed: Stored XSS in profile bio (high). Wave 1 killed: SQL injection in id parameter.',
    })
    assert.equal(r2.plan.source, 'fallback')
    assert.match(r2.plan.fallbackReason ?? '', /no coordinator completion configured/)
    assert.equal(r2.campaign.status, 'complete', 'wave cap 2 reached — campaign completes')
    assert.equal(inputs.length, 2)
    assert.match(inputs[1]?.objective ?? '', /Wave 1/)
    assert.match(inputs[1]?.objective ?? '', /1 confirmed, 1 killed/)
    assert.match(inputs[1]?.objective ?? '', /Stored XSS in profile bio/)
    assert.equal(inputs[1]?.target, 'app.example.test')
  })

  it('an operator pause holds launches even with a decision on record', async () => {
    makeCampaign()
    recordOperatorDecision(campaignsDir, 'camp-exec', { operator: 'Carlos', kind: 'start' })
    pauseCampaign(campaignsDir, 'camp-exec')
    const { inputs, runFn } = fakeRunner([wave1Result])
    await assert.rejects(() => launchCampaignWave({ campaignsDir, campaignId: 'camp-exec', runFn }), /paused/)
    assert.equal(inputs.length, 0)
  })

  it('a throwing engagement call settles the wave as failed and rethrows', async () => {
    makeCampaign()
    recordOperatorDecision(campaignsDir, 'camp-exec', { operator: 'Carlos', kind: 'start' })
    const runFn = async (): Promise<EngagementResult> => {
      throw new Error('router exploded')
    }
    await assert.rejects(() => launchCampaignWave({ campaignsDir, campaignId: 'camp-exec', runFn }), /router exploded/)
    const rec = loadCampaign(campaignsDir, 'camp-exec')
    assert.equal(rec.waves[0]?.status, 'failed')
    assert.equal(rec.waves[0]?.outcome?.engagementStatus, 'error')
    assert.match(rec.waves[0]?.outcome?.blockedReason ?? '', /router exploded/)
    assert.equal(rec.status, 'awaiting-advance')
  })

  it('a non-terminal engagement result fails the harvest — and still settles the wave (X-8)', async () => {
    makeCampaign()
    recordOperatorDecision(campaignsDir, 'camp-exec', { operator: 'Carlos', kind: 'start' })
    // "running" is a legal EngagementStatus, but a wave outcome is only
    // ever recorded for a FINISHED engagement: recordWaveOutcome
    // refuses it, and that harvest failure must not strand the wave.
    const runFn = async (): Promise<EngagementResult> => ({ engagementId: 'x', status: 'running', findings: [] })
    await assert.rejects(() => launchCampaignWave({ campaignsDir, campaignId: 'camp-exec', runFn }), /not terminal/)
    const rec = loadCampaign(campaignsDir, 'camp-exec')
    assert.equal(rec.waves[0]?.status, 'failed', 'the wave settles as failed — never stuck running')
    assert.equal(rec.status, 'awaiting-advance', 'the campaign is not stuck in wave-running')
  })
})

describe('campaign planner validation', () => {
  it('keeps valid focus vectors, drops invalid ones with reasons, and falls back on unreadable output', async () => {
    makeCampaign('camp-plan', 3)
    const rec = loadCampaign(campaignsDir, 'camp-plan')
    const kind = getCampaignKind('web-hunt')
    const planned = await planNextWave(rec, kind, 1, {
      completion: async () =>
        JSON.stringify({ aim: 'Hit auth first', focusVectors: ['auth-session', 'not-a-vector', 'injection', 'auth-session'], rationale: 'auth pays' }),
    })
    assert.equal(planned.source, 'coordinator')
    assert.deepEqual(planned.focusVectors, ['auth-session', 'injection'])
    assert.equal(planned.dropped.length, 2)
    assert.match(planned.dropped[0]?.reason ?? '', /not a vector/)

    const fallback = await planNextWave(rec, kind, 1, { completion: async () => 'no json here' })
    assert.equal(fallback.source, 'fallback')
    assert.match(fallback.fallbackReason ?? '', /could not be read as JSON/)
    assert.ok(fallback.focusVectors.length > 0, 'fallback always yields a roster')
  })
})

describe('campaign kind registry', () => {
  it('ships exactly one v1 kind and never resolves the forbidden kind', () => {
    assert.deepEqual(
      listCampaignKinds().map(k => k.name),
      ['web-hunt'],
    )
    assert.equal(getCampaignKind('web-hunt').defaults.mode, 'red')
    assert.throws(() => getCampaignKind('ad'), /forbidden/)
    assert.throws(() => getCampaignKind('nope'), /unknown campaign kind/)
    assert.throws(
      () => validateCampaignKind({ ...getCampaignKind('web-hunt'), name: 'ad' }),
      /forbidden/,
    )
  })
})
