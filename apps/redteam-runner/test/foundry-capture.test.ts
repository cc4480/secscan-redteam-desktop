/**
 * Foundry capture tests: tiering, sanitizer drops, idempotency, and —
 * the load-bearing one — failure isolation at the real completion hook:
 * a sabotaged Foundry store must not stop trajectory capture or the
 * engagement's completion path, and the failure must be noted in the
 * engagement's own event log.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { captureFoundryCases } from '../src/foundry/capture.js'
import { listCases, loadRegistry, readSanitizerNotes } from '../src/foundry/store.js'
import { captureEngagementTrajectory } from '../src/harness2/trajectory.js'
import { EventLog } from '../src/events.js'
import type { Ctx } from '../src/context.js'
import type { Finding } from '../src/types.js'

function tmpRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function stateFinding(title: string, status: Finding['status'] = 'confirmed'): Finding {
  return {
    id: 'F-1',
    severity: 'high',
    title,
    attackIds: ['T1190'],
    evidence: 'GET https://shop.example.test/search?q=1 returned the hidden row',
    fix: 'parameterize',
    retest: 'replay',
    status,
  }
}

const BASE_INPUT = {
  engagementId: 'eng-cap',
  target: 'shop.example.test',
  techFingerprints: ['wordpress'],
  autoLoop: false as const,
}

describe('foundry capture', () => {
  it('tiers a plain confirmed finding BRONZE and a cell-proven + independently confirmed finding SILVER', () => {
    const store = join(tmpRoot('foundry-cap-'), 'foundry-store')
    const bronze = captureFoundryCases({
      ...BASE_INPUT,
      storeDir: store,
      stateFindings: [stateFinding('SQL injection in search')],
      liveFindings: [
        { severity: 'high', title: 'SQL injection in search', vulnClass: 'sql-injection', attackId: 'T1190', evidence: 'https://shop.example.test/search?q=x', payload: "' OR '1'='1' -- " },
      ],
    })
    assert.equal(bronze.added, 1)
    assert.equal(bronze.error, null)
    const cases = listCases(store)
    assert.equal(cases[0]?.tier, 'BRONZE')
    assert.equal(cases[0]?.family, 'sqli')
    assert.equal(cases[0]?.payloadClass, 'tautology-quote')
    // The raw target host must not survive into the stored case.
    assert.ok(!JSON.stringify(cases[0]).includes('shop.example.test'))

    const silver = captureFoundryCases({
      ...BASE_INPUT,
      engagementId: 'eng-cap-2',
      storeDir: store,
      stateFindings: [stateFinding('SQL injection in login')],
      liveFindings: [
        { severity: 'high', title: 'SQL injection in login', vulnClass: 'sql-injection', attackId: 'T1190', evidence: 'https://shop.example.test/login?u=x', payload: "' OR '1'='1' -- ", cellState: 'proven' as const },
      ],
    })
    assert.equal(silver.added, 1)
    const silverCase = listCases(store).find(c => c.sourceEngagementId === 'eng-cap-2')
    assert.equal(silverCase?.tier, 'SILVER')
    assert.ok(silverCase?.mechanisms.includes('dual-exploiter-cell'))
    assert.ok(silverCase?.mechanisms.includes('state-confirmation'))
  })

  it('keeps a cell-proven finding BRONZE when no independent signal agrees', () => {
    const store = join(tmpRoot('foundry-cap-'), 'foundry-store')
    const result = captureFoundryCases({
      ...BASE_INPUT,
      storeDir: store,
      stateFindings: [],
      liveFindings: [
        { severity: 'high', title: 'SSRF in preview', vulnClass: 'ssrf', attackId: 'T1190', evidence: '', payload: 'http://127.0.0.1/admin', cellState: 'proven' as const },
      ],
    })
    assert.equal(result.added, 1)
    assert.equal(listCases(store)[0]?.tier, 'BRONZE')
  })

  it('drops a case the sanitizer cannot clean, recording counts/reasons only', () => {
    const store = join(tmpRoot('foundry-cap-'), 'foundry-store')
    const result = captureFoundryCases({
      ...BASE_INPUT,
      storeDir: store,
      stateFindings: [],
      liveFindings: [
        // The severity slot carries an email — the projected pattern trips
        // the DLP re-scan, so the case must be dropped, never repaired.
        { severity: 'admin@evil.example.com', title: 'SQL injection in search', vulnClass: 'sql-injection', attackId: 'T1190', evidence: '', payload: "' OR '1'='1' -- " },
      ],
    })
    assert.equal(result.added, 0)
    assert.equal(result.dropped, 1)
    assert.ok(result.dropReasons.some(r => r.startsWith('dlp:')))
    assert.equal(listCases(store).length, 0)
    const notes = readSanitizerNotes(store, 10)
    assert.equal(notes.length, 1)
    assert.ok(!JSON.stringify(notes).includes('evil.example.com'))
  })

  it('is idempotent across re-processing of the same engagement', () => {
    const store = join(tmpRoot('foundry-cap-'), 'foundry-store')
    const input = {
      ...BASE_INPUT,
      storeDir: store,
      stateFindings: [stateFinding('Reflected XSS in search')],
      liveFindings: [
        { severity: 'medium', title: 'Reflected XSS in search', vulnClass: 'cross-site-scripting', attackId: 'T1190', evidence: 'https://shop.example.test/search?q=x', payload: '<script>alert(1)</script>' },
      ],
    }
    const first = captureFoundryCases(input)
    const second = captureFoundryCases(input)
    assert.equal(first.added, 1)
    assert.equal(second.added, 0)
    assert.equal(second.skippedDuplicates, 1)
    assert.equal(loadRegistry(store).entries.length, 1)
  })

  it('buckets a finding with no class signal as unclassified, never forced', () => {
    const store = join(tmpRoot('foundry-cap-'), 'foundry-store')
    const result = captureFoundryCases({
      ...BASE_INPUT,
      storeDir: store,
      stateFindings: [stateFinding('Verbose banner disclosure')],
      liveFindings: [],
    })
    assert.equal(result.added, 1)
    assert.equal(listCases(store)[0]?.family, 'unclassified')
  })

  it('never throws when the store is unwritable — the error rides the result', () => {
    const root = tmpRoot('foundry-cap-blocked-')
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'x')
    const result = captureFoundryCases({
      ...BASE_INPUT,
      storeDir: join(blocker, 'foundry-store'),
      stateFindings: [stateFinding('SQL injection in search')],
      liveFindings: [],
    })
    assert.equal(result.added, 0)
    assert.ok(result.error !== null || result.dropped > 0)
  })
})

describe('completion-hook failure isolation', () => {
  function fakeCtx(liveFindings: Ctx['liveFindings']): Ctx {
    return {
      fingerprint: { host: 'shop.example.test', stack: [], appType: 'wordpress' },
      itemLedger: new Map(),
      hostKill: { aborted: false, controllers: new Set() },
      safety: { killSwitchAborts: 0 },
      actions: 2,
      startedAt: Date.now() - 1000,
      liveFindings,
      killedLive: [],
    } as unknown as Ctx
  }

  it('a sabotaged Foundry store cannot stop trajectory capture or completion', () => {
    const root = tmpRoot('foundry-iso-')
    const dir = join(root, 'live', 'eng-iso')
    mkdirSync(dir, { recursive: true })
    // Sabotage: the foundry-store path is a regular file, so every store
    // write fails inside the capture pipeline.
    writeFileSync(join(root, 'foundry-store'), 'not a directory')
    const events = new EventLog(dir, 'eng-iso', { target: 'shop.example.test', mode: 'red', objective: 'test' })
    events.updateState({ status: 'complete', phase: 'done', findings: [stateFinding('SQL injection in search')] })
    let metrics: ReturnType<typeof captureEngagementTrajectory> = null
    assert.doesNotThrow(() => {
      metrics = captureEngagementTrajectory({
        engagementDir: dir,
        engagementId: 'eng-iso',
        target: 'shop.example.test',
        ctx: fakeCtx([
          { severity: 'high', title: 'SQL injection in search', vulnClass: 'sql-injection', attackId: 'T1190', evidence: 'https://shop.example.test/search?q=x', payload: "' OR '1'='1' -- ", cellState: 'proven' },
        ]),
        events,
        environment: { REDTEAM_FOUNDRY_AUTO_LOOP: '0' },
      })
    })
    // The engagement's own capture completed normally...
    assert.notEqual(metrics, null)
    assert.equal(metrics!.vulnsFound, 1)
    assert.equal(existsSync(join(dir, 'metrics.json')), true)
    // ...and the Foundry failure was noted in the engagement's event log.
    const log = readFileSync(join(dir, 'events.jsonl'), 'utf8')
    const note = log.split('\n').find(l => l.includes('foundry_capture'))
    assert.ok(note, 'expected a foundry_capture event in events.jsonl')
    assert.ok(note.includes('failure-isolated') || note.includes('0 case(s) added'))
  })

  it('a healthy store receives the case through the same completion hook', () => {
    const root = tmpRoot('foundry-hook-')
    const dir = join(root, 'live', 'eng-hook')
    mkdirSync(dir, { recursive: true })
    const events = new EventLog(dir, 'eng-hook', { target: 'shop.example.test', mode: 'red', objective: 'test' })
    events.updateState({ status: 'complete', phase: 'done', findings: [stateFinding('SQL injection in search')] })
    const metrics = captureEngagementTrajectory({
      engagementDir: dir,
      engagementId: 'eng-hook',
      target: 'shop.example.test',
      ctx: fakeCtx([
        { severity: 'high', title: 'SQL injection in search', vulnClass: 'sql-injection', attackId: 'T1190', evidence: 'https://shop.example.test/search?q=x', payload: "' OR '1'='1' -- ", cellState: 'proven' },
      ]),
      events,
      environment: { REDTEAM_FOUNDRY_AUTO_LOOP: '0' },
    })
    assert.notEqual(metrics, null)
    const store = join(root, 'foundry-store')
    const cases = listCases(store)
    assert.equal(cases.length, 1)
    assert.equal(cases[0]?.tier, 'SILVER')
    assert.equal(cases[0]?.sourceEngagementId, 'eng-hook')
    const log = readFileSync(join(dir, 'events.jsonl'), 'utf8')
    assert.ok(log.includes('foundry_capture'))
    assert.ok(log.includes('1 case(s) added'))
  })
})
