/**
 * Campaign integration battery (Q-CAMPAIGN).
 *
 * Three layers, in order:
 *
 *  1. THE "/ad" GUARD — the donor's AD kind is forbidden in this product
 *     (canonical manifest, Part C). The binding controls are runtime:
 *     campaign creation and record validation both reject kind "ad".
 *     The source scan is the receipt: no file under src/campaign may
 *     register a kind named "ad".
 *
 *  2. TWO-WAVE CONTRACT FLOW — the full campaign-layer sequence over
 *     the real store + gate + harvest: gate refuses wave 1 before a
 *     start decision, refuses wave 2 before an advance decision, and
 *     the campaign completes at its cap with per-wave rollups that
 *     match the harvested engagement results mechanically. The wave
 *     executor here returns EngagementResult-shaped values; the LIVE
 *     machinery run is layer 3, named separately so this layer never
 *     impersonates it.
 *
 *  3. LIVE TWO-WAVE RUN (env-gated: CAMPAIGN_LIVE_TEST=1) — the same
 *     flow driven through the real runEngagement in dry-run mode
 *     against a loopback fixture server the test itself starts. Gated
 *     because a live engagement asserts dist freshness and takes
 *     minutes; when the gate is off the test reports itself skipped
 *     with the reason, never silently absent.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertLaunchAllowed, evaluateLaunch, recordOperatorDecision } from '../src/campaign/gate.js'
import {
  beginWave,
  createCampaign,
  loadCampaign,
  recordWaveOutcome,
  type EngagementResultLike,
} from '../src/campaign/store.js'
import { validateCampaignRecord } from '../src/campaign/schema.js'

let root: string
let campaignsDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'campaign-integration-'))
  campaignsDir = join(root, 'campaigns')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeCampaign(id = 'camp-flow', maxWaves = 2): void {
  createCampaign(campaignsDir, {
    id,
    name: 'Flow',
    kind: 'web-hunt',
    objective: 'Two-wave flow fixture',
    scope: { hosts: ['127.0.0.1'], verificationRef: 'dns-txt:fixture' },
    caps: { maxWaves },
    createdBy: 'Carlos',
  })
}

describe('the "/ad" guard', () => {
  it('creation and record validation both reject kind "ad"', () => {
    assert.throws(() =>
      createCampaign(campaignsDir, {
        id: 'camp-ad',
        name: 'Nope',
        kind: 'ad',
        objective: 'forbidden',
        scope: { hosts: ['127.0.0.1'], verificationRef: 'x' },
        caps: { maxWaves: 1 },
        createdBy: 'Carlos',
      }),
    )
    makeCampaign('camp-ok')
    const rec = loadCampaign(campaignsDir, 'camp-ok')
    assert.throws(() => validateCampaignRecord({ ...rec, kind: 'ad' }))
    assert.throws(() => validateCampaignRecord({ ...rec, kind: ' AD ' }))
  })

  it('no source under src/campaign registers a kind named "ad" (grep receipt)', () => {
    const dir = join(process.cwd(), 'src', 'campaign')
    const files = readdirSync(dir).filter(f => f.endsWith('.ts'))
    assert.ok(files.length > 0, 'campaign module sources must exist to scan')
    const registrationPatterns = [
      /kind\s*[:=]\s*["']ad["']/i,
      /name\s*:\s*["']ad["']/,
      /registerKind\s*\(\s*["']ad["']/,
      /id\s*:\s*["']ad["']/,
    ]
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8')
      for (const pattern of registrationPatterns) {
        assert.ok(!pattern.test(text), `${file} appears to register the forbidden "ad" kind (${pattern})`)
      }
    }
  })
})

describe('two-wave campaign contract flow', () => {
  const wave1: EngagementResultLike = {
    status: 'complete',
    reportPath: 'engagements/live/eng-w1/report.md',
    findings: [
      { status: 'confirmed', severity: 'high' },
      { status: 'confirmed', severity: 'medium' },
      { status: 'killed', severity: 'low' },
    ],
  }
  const wave2: EngagementResultLike = {
    status: 'complete',
    findings: [{ status: 'confirmed', severity: 'critical' }],
  }

  it('gates both waves on recorded decisions and completes at the cap with per-wave rollups', () => {
    makeCampaign()
    // Wave 1 cannot launch before a recorded start decision.
    assert.throws(() => assertLaunchAllowed(loadCampaign(campaignsDir, 'camp-flow'), 1))
    recordOperatorDecision(campaignsDir, 'camp-flow', { operator: 'Carlos', kind: 'start' })
    assertLaunchAllowed(loadCampaign(campaignsDir, 'camp-flow'), 1)
    beginWave(campaignsDir, 'camp-flow', 1, { engagementId: 'eng-w1' })
    recordWaveOutcome(campaignsDir, 'camp-flow', 1, wave1)

    let rec = loadCampaign(campaignsDir, 'camp-flow')
    assert.equal(rec.status, 'awaiting-advance')
    // Wave 2 cannot launch before a recorded advance decision names it.
    assert.equal(evaluateLaunch(rec, 2).allowed, false)
    recordOperatorDecision(campaignsDir, 'camp-flow', { operator: 'Carlos', kind: 'advance', waveIndex: 2 })
    assertLaunchAllowed(loadCampaign(campaignsDir, 'camp-flow'), 2)
    beginWave(campaignsDir, 'camp-flow', 2, { engagementId: 'eng-w2' })
    recordWaveOutcome(campaignsDir, 'camp-flow', 2, wave2)

    rec = loadCampaign(campaignsDir, 'camp-flow')
    assert.equal(rec.status, 'complete')
    assert.equal(rec.waves.length, 2)
    assert.deepEqual(rec.waves[0].outcome?.rollup, {
      totalFindings: 3,
      confirmed: 2,
      killed: 1,
      deferred: 0,
      bySeverity: { critical: 0, high: 1, medium: 1, low: 1, info: 0 },
    })
    assert.deepEqual(rec.waves[1].outcome?.rollup, {
      totalFindings: 1,
      confirmed: 1,
      killed: 0,
      deferred: 0,
      bySeverity: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
    })
    // The audit spine shows the whole story: create, launch, harvest,
    // launch, harvest-to-complete — plus the two recorded decisions.
    assert.deepEqual(
      rec.transitions.map(t => t.to),
      ['draft', 'wave-running', 'awaiting-advance', 'wave-running', 'complete'],
    )
    assert.deepEqual(
      rec.decisions.map(d => d.kind),
      ['start', 'advance'],
    )
  })
})

const LIVE = process.env.CAMPAIGN_LIVE_TEST === '1'

describe('live two-wave run through runEngagement (dry-run)', { skip: !LIVE && 'CAMPAIGN_LIVE_TEST!=1 — live machinery run not requested' }, () => {
  it(
    'completes two dry-run waves over the real engagement machinery with per-wave rollups',
    { timeout: 15 * 60_000 },
    async () => {
      const { runEngagement } = await import('../src/phases/run.js')
      const server: Server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><title>campaign fixture</title><body>fixture</body></html>')
      })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const addr = server.address()
      assert.ok(addr && typeof addr === 'object')
      const target = `http://127.0.0.1:${addr.port}`
      try {
        makeCampaign('camp-live', 2)
        const runWave = async (waveIndex: number) => {
          const engagementId = `campaign-live-w${waveIndex}`
          // Launch bookkeeping first: if the run dies, the wave stays
          // "running" on the record — the honest state, which a later
          // resumeCampaigns would mark interrupted.
          beginWave(campaignsDir, 'camp-live', waveIndex, { engagementId })
          const result = await runEngagement(
            {
              target,
              mode: 'red',
              objective: `Campaign live fixture, wave ${waveIndex}`,
              operatorName: 'Campaign Test',
              environment: 'staging',
              roe: { scope: [target] },
            },
            {
              dryRunAgents: true,
              localSandbox: true,
              maxActions: 5,
              engagementId,
              engagementsDir: join(root, 'live-engagements'),
              registryPath: join(root, 'registry.json'),
            },
          )
          return recordWaveOutcome(campaignsDir, 'camp-live', waveIndex, result)
        }

        recordOperatorDecision(campaignsDir, 'camp-live', { operator: 'Campaign Test', kind: 'start' })
        assertLaunchAllowed(loadCampaign(campaignsDir, 'camp-live'), 1)
        const w1 = await runWave(1)
        assert.ok(w1.outcome, 'wave 1 must harvest an outcome')
        assert.equal(w1.outcome.rollup.totalFindings, w1.outcome.rollup.confirmed + w1.outcome.rollup.killed + w1.outcome.rollup.deferred)

        // The gate holds between live waves too: no advance, no wave 2.
        assert.equal(evaluateLaunch(loadCampaign(campaignsDir, 'camp-live'), 2).allowed, false)
        recordOperatorDecision(campaignsDir, 'camp-live', { operator: 'Campaign Test', kind: 'advance', waveIndex: 2 })
        assertLaunchAllowed(loadCampaign(campaignsDir, 'camp-live'), 2)
        const w2 = await runWave(2)
        assert.ok(w2.outcome, 'wave 2 must harvest an outcome')

        const rec = loadCampaign(campaignsDir, 'camp-live')
        assert.equal(rec.status, 'complete')
        assert.equal(rec.waves.length, 2)
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    },
  )
})
