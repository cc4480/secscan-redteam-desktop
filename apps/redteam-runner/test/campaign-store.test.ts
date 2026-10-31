/**
 * Campaign store (Q-CAMPAIGN, scoping N2) — persistence battery.
 *
 * Pins: creation discipline (verified scope or nothing, no overwrite,
 * the forbidden kind rejected), validating loads that fail loud on
 * corrupt records, transact atomicity (a throwing mutator writes
 * nothing), wave bookkeeping with mechanical rollups, and — the core
 * honesty property — restart-resume fidelity: a wave stranded by a
 * process death is marked "interrupted" with its engagement id intact,
 * never silently counted complete, and the repair is idempotent.
 * Everything runs on temp dirs; no operator data home is touched.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CampaignStoreError,
  beginWave,
  campaignFile,
  computeRollup,
  createCampaign,
  listCampaignIds,
  loadCampaign,
  recordTransition,
  recordWaveOutcome,
  resolveCampaignsDir,
  resumeCampaigns,
  settleFailedWave,
  transactCampaign,
  type CreateCampaignInput,
  type EngagementResultLike,
} from '../src/campaign/store.js'
import { CampaignSchemaError } from '../src/campaign/schema.js'

let root: string
let campaignsDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'campaign-store-'))
  campaignsDir = join(root, 'campaigns')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function input(over: Partial<CreateCampaignInput> = {}): CreateCampaignInput {
  return {
    id: 'camp-alpha',
    name: 'Alpha',
    kind: 'web-hunt',
    objective: 'Assess the loopback fixture surface',
    scope: { hosts: ['127.0.0.1'], verificationRef: 'dns-txt:fixture-2026-10-31' },
    caps: { maxWaves: 2 },
    createdBy: 'Carlos',
    ...over,
  }
}

function result(over: Partial<EngagementResultLike> = {}): EngagementResultLike {
  return {
    status: 'complete',
    findings: [
      { status: 'confirmed', severity: 'critical' },
      { status: 'confirmed', severity: 'low' },
      { status: 'killed', severity: 'medium' },
      { status: 'deferred', severity: 'info' },
    ],
    ...over,
  }
}

describe('createCampaign', () => {
  it('creates a draft campaign with auto-advance OFF and the creation transition recorded', () => {
    const rec = createCampaign(campaignsDir, input())
    assert.equal(rec.status, 'draft')
    assert.equal(rec.autoAdvance.enabled, false)
    assert.deepEqual(rec.waves, [])
    assert.deepEqual(rec.decisions, [])
    assert.equal(rec.transitions.length, 1)
    assert.equal(rec.transitions[0].from, null)
    assert.equal(rec.transitions[0].to, 'draft')
    assert.equal(rec.createdBy, 'Carlos')
    assert.ok(existsSync(campaignFile(campaignsDir, 'camp-alpha')))
  })

  it('refuses to overwrite an existing campaign', () => {
    createCampaign(campaignsDir, input())
    assert.throws(() => createCampaign(campaignsDir, input()), CampaignStoreError)
  })

  it('rejects the forbidden "ad" kind at creation', () => {
    assert.throws(() => createCampaign(campaignsDir, input({ kind: 'ad' })), CampaignStoreError)
    assert.throws(() => createCampaign(campaignsDir, input({ kind: ' AD ' })), CampaignStoreError)
  })

  it('rejects unverified or malformed creation input', () => {
    assert.throws(() => createCampaign(campaignsDir, input({ scope: { hosts: [], verificationRef: 'x' } })), CampaignStoreError)
    assert.throws(() => createCampaign(campaignsDir, input({ scope: { hosts: ['h'], verificationRef: ' ' } })), CampaignStoreError)
    assert.throws(() => createCampaign(campaignsDir, input({ createdBy: ' ' })), CampaignStoreError)
    assert.throws(() => createCampaign(campaignsDir, input({ caps: { maxWaves: 0 } })), CampaignStoreError)
    assert.throws(() => createCampaign(campaignsDir, input({ id: '../escape' })), CampaignStoreError)
    assert.throws(() => createCampaign(campaignsDir, input({ id: 'has space' })), CampaignStoreError)
  })
})

describe('load + validation', () => {
  it('round-trips a created record exactly', () => {
    const created = createCampaign(campaignsDir, input())
    assert.deepEqual(loadCampaign(campaignsDir, 'camp-alpha'), created)
  })

  it('fails loud on a corrupt record instead of inventing an empty campaign', () => {
    createCampaign(campaignsDir, input())
    const file = campaignFile(campaignsDir, 'camp-alpha')
    const good = readFileSync(file, 'utf8')
    writeFileSync(file, good.slice(0, 40)) // torn JSON
    assert.throws(() => loadCampaign(campaignsDir, 'camp-alpha'), CampaignSchemaError)
    const parsed = JSON.parse(good)
    parsed.status = 'bogus-status'
    writeFileSync(file, JSON.stringify(parsed))
    assert.throws(() => loadCampaign(campaignsDir, 'camp-alpha'), CampaignSchemaError)
    parsed.status = 'draft'
    parsed.version = 2
    writeFileSync(file, JSON.stringify(parsed))
    assert.throws(() => loadCampaign(campaignsDir, 'camp-alpha'), CampaignSchemaError)
  })

  it('lists campaign ids sorted, and an absent store lists empty', () => {
    assert.deepEqual(listCampaignIds(join(root, 'nope')), [])
    createCampaign(campaignsDir, input({ id: 'camp-beta' }))
    createCampaign(campaignsDir, input())
    assert.deepEqual(listCampaignIds(campaignsDir), ['camp-alpha', 'camp-beta'])
  })
})

describe('transactCampaign', () => {
  it('persists mutations and refreshes updatedAt', () => {
    createCampaign(campaignsDir, input())
    const t0 = new Date('2026-10-31T10:00:00.000Z')
    transactCampaign(campaignsDir, 'camp-alpha', (rec) => {
      rec.name = 'Alpha Prime'
    }, t0)
    const rec = loadCampaign(campaignsDir, 'camp-alpha')
    assert.equal(rec.name, 'Alpha Prime')
    assert.equal(rec.updatedAt, t0.toISOString())
  })

  it('writes nothing when the mutator throws (byte-identical file)', () => {
    createCampaign(campaignsDir, input())
    const file = campaignFile(campaignsDir, 'camp-alpha')
    const before = readFileSync(file, 'utf8')
    assert.throws(
      () =>
        transactCampaign(campaignsDir, 'camp-alpha', (rec) => {
          rec.name = 'Should Not Land'
          throw new Error('boom')
        }),
      /boom/,
    )
    assert.equal(readFileSync(file, 'utf8'), before)
  })

  it('leaves no tmp files behind after writes', () => {
    createCampaign(campaignsDir, input())
    recordTransition(campaignsDir, 'camp-alpha', 'armed', 'operator armed the campaign')
    const names = readdirSync(join(campaignsDir, 'camp-alpha'))
    assert.deepEqual(names.filter(n => n.includes('.tmp-')), [])
  })
})

describe('wave bookkeeping', () => {
  it('beginWave marks the wave running and the campaign wave-running', () => {
    createCampaign(campaignsDir, input())
    const wave = beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-1' })
    assert.equal(wave.status, 'running')
    assert.equal(wave.engagementId, 'eng-1')
    assert.ok(wave.launchedAt)
    const rec = loadCampaign(campaignsDir, 'camp-alpha')
    assert.equal(rec.status, 'wave-running')
    assert.equal(rec.transitions.at(-1)?.to, 'wave-running')
  })

  it('beginWave refuses a second launch of the same wave', () => {
    createCampaign(campaignsDir, input())
    beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-1' })
    assert.throws(() => beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-2' }), CampaignStoreError)
  })

  it('recordWaveOutcome harvests a mechanical rollup and awaits advance below the cap', () => {
    createCampaign(campaignsDir, input())
    beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-1' })
    const wave = recordWaveOutcome(campaignsDir, 'camp-alpha', 1, result())
    assert.equal(wave.status, 'complete')
    assert.deepEqual(wave.outcome?.rollup, {
      totalFindings: 4,
      confirmed: 2,
      killed: 1,
      deferred: 1,
      bySeverity: { critical: 1, high: 0, medium: 1, low: 1, info: 1 },
    })
    assert.equal(loadCampaign(campaignsDir, 'camp-alpha').status, 'awaiting-advance')
  })

  it('recordWaveOutcome completes the campaign when the wave cap is reached', () => {
    createCampaign(campaignsDir, input({ caps: { maxWaves: 1 } }))
    beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-1' })
    recordWaveOutcome(campaignsDir, 'camp-alpha', 1, result())
    assert.equal(loadCampaign(campaignsDir, 'camp-alpha').status, 'complete')
  })

  it('maps blocked engagements to a halted wave and keeps the blocked reason', () => {
    createCampaign(campaignsDir, input())
    beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-1' })
    const wave = recordWaveOutcome(
      campaignsDir,
      'camp-alpha',
      1,
      result({ status: 'blocked', blockedReason: 'outside ROE window', findings: [] }),
    )
    assert.equal(wave.status, 'halted')
    assert.equal(wave.outcome?.blockedReason, 'outside ROE window')
  })

  it('refuses outcomes for non-terminal engagements and non-running waves', () => {
    createCampaign(campaignsDir, input())
    assert.throws(() => recordWaveOutcome(campaignsDir, 'camp-alpha', 1, result()), CampaignStoreError)
    beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-1' })
    assert.throws(
      () => recordWaveOutcome(campaignsDir, 'camp-alpha', 1, result({ status: 'running' })),
      CampaignStoreError,
    )
  })

  it('computeRollup counts an empty findings set as all zeros', () => {
    assert.deepEqual(computeRollup([]), {
      totalFindings: 0,
      confirmed: 0,
      killed: 0,
      deferred: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    })
  })
})

describe('resumeCampaigns — restart fidelity', () => {
  function strandedCampaign(): void {
    createCampaign(campaignsDir, input())
    beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-done' })
    recordWaveOutcome(campaignsDir, 'camp-alpha', 1, result())
    beginWave(campaignsDir, 'camp-alpha', 2, { engagementId: 'eng-stranded' })
    // process "dies" here: wave 2 running, campaign wave-running
  }

  it('marks a stranded wave interrupted — never complete — and returns the campaign to awaiting-advance', () => {
    strandedCampaign()
    const now = new Date('2026-10-31T15:00:00.000Z')
    const report = resumeCampaigns(campaignsDir, now)
    assert.equal(report.scanned, 1)
    assert.deepEqual(report.errors, [])
    assert.equal(report.repaired.length, 1)
    assert.deepEqual(report.repaired[0].interruptedWaves, [2])

    const rec = loadCampaign(campaignsDir, 'camp-alpha')
    const [w1, w2] = rec.waves
    assert.equal(w1.status, 'complete') // finished wave untouched
    assert.ok(w1.outcome)
    assert.equal(w2.status, 'interrupted')
    assert.equal(w2.interruptedAt, now.toISOString())
    assert.equal(w2.interruptReason, 'process-restart')
    assert.equal(w2.engagementId, 'eng-stranded') // what was launched stays on the record
    assert.equal(w2.outcome, undefined) // and no outcome was invented for it
    assert.equal(rec.status, 'awaiting-advance')
    assert.match(rec.transitions.at(-1)?.reason ?? '', /resume-repair/)
  })

  it('is idempotent: a second resume changes nothing', () => {
    strandedCampaign()
    resumeCampaigns(campaignsDir)
    const file = campaignFile(campaignsDir, 'camp-alpha')
    const afterFirst = readFileSync(file, 'utf8')
    const second = resumeCampaigns(campaignsDir)
    assert.deepEqual(second.repaired, [])
    assert.equal(readFileSync(file, 'utf8'), afterFirst)
  })

  it('reports a corrupt campaign in errors and still repairs the healthy ones', () => {
    strandedCampaign()
    createCampaign(campaignsDir, input({ id: 'camp-broken' }))
    writeFileSync(campaignFile(campaignsDir, 'camp-broken'), '{not json')
    const report = resumeCampaigns(campaignsDir)
    assert.equal(report.scanned, 2)
    assert.equal(report.errors.length, 1)
    assert.equal(report.errors[0].id, 'camp-broken')
    assert.equal(report.repaired.length, 1)
    assert.equal(report.repaired[0].id, 'camp-alpha')
  })

  it('treats a missing store as empty, and leaves settled campaigns untouched', () => {
    assert.deepEqual(resumeCampaigns(join(root, 'absent')), { scanned: 0, repaired: [], errors: [] })
    createCampaign(campaignsDir, input())
    const file = campaignFile(campaignsDir, 'camp-alpha')
    const before = readFileSync(file, 'utf8')
    const report = resumeCampaigns(campaignsDir)
    assert.deepEqual(report.repaired, [])
    assert.equal(readFileSync(file, 'utf8'), before)
  })
})

describe('settleFailedWave + transition seq invariant', () => {
  it('settles a thrown launch as a failed wave with the error on the record', () => {
    createCampaign(campaignsDir, input())
    beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-boom' })
    const wave = settleFailedWave(campaignsDir, 'camp-alpha', 1, 'router exploded')
    assert.equal(wave?.status, 'failed')
    assert.equal(wave?.outcome?.engagementStatus, 'error')
    assert.equal(wave?.outcome?.blockedReason, 'router exploded')
    assert.equal(wave?.outcome?.rollup.totalFindings, 0)
    assert.ok(wave?.finishedAt)
    assert.equal(loadCampaign(campaignsDir, 'camp-alpha').status, 'awaiting-advance')
  })

  it('returns null for a wave that is not running and changes nothing', () => {
    createCampaign(campaignsDir, input())
    const file = campaignFile(campaignsDir, 'camp-alpha')
    const before = readFileSync(file, 'utf8')
    assert.equal(settleFailedWave(campaignsDir, 'camp-alpha', 1, 'nope'), null)
    assert.equal(readFileSync(file, 'utf8'), before)
  })

  it('transition seqs are exactly their indices across every store writer', () => {
    createCampaign(campaignsDir, input())
    recordTransition(campaignsDir, 'camp-alpha', 'armed', 'operator armed')
    beginWave(campaignsDir, 'camp-alpha', 1, { engagementId: 'eng-1' })
    settleFailedWave(campaignsDir, 'camp-alpha', 1, 'boom')
    const rec = loadCampaign(campaignsDir, 'camp-alpha')
    assert.deepEqual(
      rec.transitions.map(t => t.seq),
      rec.transitions.map((_t, i) => i),
    )
    assert.deepEqual(
      rec.transitions.map(t => t.to),
      ['draft', 'armed', 'wave-running', 'awaiting-advance'],
    )
  })
})

describe('resolveCampaignsDir', () => {
  it('resolves opts, then env override, then REDTEAM_HOME, then cwd', () => {
    assert.equal(resolveCampaignsDir({ campaignsDir: '/x/y', env: {} }), '/x/y')
    assert.equal(
      resolveCampaignsDir({ env: { REDTEAM_CAMPAIGNS_DIR: '/env/camps', REDTEAM_HOME: '/home' } }),
      '/env/camps',
    )
    assert.equal(
      resolveCampaignsDir({ env: { REDTEAM_HOME: '/home' } }),
      join('/home', 'engagements', 'campaigns'),
    )
    assert.equal(
      resolveCampaignsDir({ env: {}, cwd: '/work' }),
      join('/work', 'engagements', 'campaigns'),
    )
  })
})
