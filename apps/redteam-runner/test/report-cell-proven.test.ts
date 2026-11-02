/**
 * Q-PROVEN receipts — the exploit-cell PROVEN verdict reaches the report.
 *
 * The cell stamps LiveFinding.cellState = 'proven' after challenger critique
 * + verification signatures + a passing negative control, but that verdict
 * used to be consumed only by foundry/capture: web findings could never
 * render in the report's PROVEN tier. These tests pin the carry at each
 * joint (report join, renderer, halted path) and the §5 attackId-relaxed
 * bundle fallback. Fakes only — no network, no live engagements.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyBundleIntegrity, type PocBundle } from '../src/proof/bundle.js'
import { buildProofSection } from '../src/report/proof.js'
import { applyCellVerdicts, haltedFindingFromLive, mergeReporterFindings } from '../src/report/phase.js'
import { cellReceiptBlock, findingCard, tierOf } from '../src/report/html/cards.js'
import { renderEngagementReportHtml, type EngagementReportInput } from '../src/report/html/render.js'
import { gradeBanner, gradeFindings } from '../src/report/grading.js'
import type { ReportMeta } from '../src/report/html.js'
import type { Ctx, LiveFinding } from '../src/context.js'
import type { EngagementEvent, Finding } from '../src/types.js'

function ev(partial: Partial<EngagementEvent> & { action: string; result: string }): EngagementEvent {
  return {
    ts: '2026-10-03T06:00:00.000Z',
    seq: 1,
    engagementId: 'eng-1',
    phase: 'exploit',
    actor: 'exploiter',
    target: 'target.example',
    ...partial,
  } as EngagementEvent
}

function confirmedFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'F-1',
    severity: 'critical',
    title: 'EternalBlue RCE',
    attackIds: ['T1190'],
    evidence: 'marker echoed',
    fix: 'patch',
    retest: 're-run',
    status: 'confirmed',
    ...over,
  }
}

/** Marker echo recorded under a DRIFTED attackId (T1059), not the finding's T1190. */
const DRIFT_MARKER_EVENT = ev({
  seq: 10,
  action: 'msf_exec',
  attackId: 'T1059',
  result:
    'msf exploit/windows/smb/ms17_010_eternalblue vs target.example: MARKER ECHOED — command execution validated. ' +
    '[CVE-2017-0144] Output: REDTEAM-MARKER-drift1',
})

/** The same marker echo under the finding's own attackId — the strict path. */
const STRICT_MARKER_EVENT = ev({ ...DRIFT_MARKER_EVENT, attackId: 'T1190' })

/** Read-only evidence output on the target, under a drifted attackId. */
const OBS_EVENT = ev({
  seq: 3,
  action: 'ad_enum',
  attackId: 'T1553',
  result: 'ad target.example: 1 certificate template(s) with ESC1 flags (CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT)',
})

function runSection(events: EngagementEvent[], findings: Finding[]) {
  const dir = mkdtempSync(join(tmpdir(), 'proven-cell-'))
  writeFileSync(join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n')
  const appended: unknown[] = []
  const ctx = {
    events: { dir, engagementId: 'eng-1', append: (e: unknown) => appended.push(e) },
    input: { target: 'target.example', operatorName: 'op' },
    killedLive: [],
  } as unknown as Ctx
  const pocBundleMap = new Map<string, PocBundle>()
  const section = buildProofSection(ctx, findings, pocBundleMap)
  return { section, pocBundleMap, dir }
}

describe('§5 attackId-relaxed fallback (report/proof.ts)', () => {
  it('drifted attackId + marker echo on the same target → execution bundle, fallback recorded', () => {
    const { section, pocBundleMap, dir } = runSection([DRIFT_MARKER_EVENT], [confirmedFinding()])
    const bundle = pocBundleMap.get('F-1')
    assert.ok(bundle, 'expected a bundle via the relaxed fallback')
    assert.equal(bundle!.validationTier, 'execution')
    assert.match(bundle!.proves, /attackId-relaxed fallback/)
    assert.match(section.markdown, /attackId-relaxed fallback/)
    // The fallback note lives inside the integrity digest: the recorded
    // digest must still verify against the bundle exactly as written.
    assert.equal(verifyBundleIntegrity(bundle!), null)
    assert.ok(existsSync(join(dir, 'poc', 'F-1.json')), 'bundle written under poc/')
  })

  it('drifted attackId + observation-only signal on target → no bundle, strict reason preserved', () => {
    const { section, pocBundleMap } = runSection([OBS_EVENT], [confirmedFinding()])
    assert.equal(pocBundleMap.size, 0, 'an observation-tier retry result is discarded')
    assert.match(section.noBundleReasons.get('F-1') ?? '', /no correlated tool execution/)
    assert.doesNotMatch(section.markdown, /attackId-relaxed fallback/)
  })

  it('strict correlation under the finding attackId → bundle with NO fallback note', () => {
    const { section, pocBundleMap } = runSection([STRICT_MARKER_EVENT], [confirmedFinding()])
    const bundle = pocBundleMap.get('F-1')
    assert.ok(bundle, 'expected a bundle via the strict path')
    assert.equal(bundle!.validationTier, 'execution')
    assert.doesNotMatch(bundle!.proves, /attackId-relaxed/)
    assert.doesNotMatch(section.markdown, /attackId-relaxed fallback/)
    assert.equal(verifyBundleIntegrity(bundle!), null)
  })

  it('finding with no attackIds already correlates by target → bundle, no fallback involved', () => {
    const { pocBundleMap } = runSection([DRIFT_MARKER_EVENT], [confirmedFinding({ attackIds: [] })])
    const bundle = pocBundleMap.get('F-1')
    assert.ok(bundle, 'expected a bundle via the target-only strict branch')
    assert.equal(bundle!.validationTier, 'execution')
    assert.doesNotMatch(bundle!.proves, /attackId-relaxed/)
  })
})

/*
 * Steps 3/4 receipts below are RECONSTRUCTIONS (2026-10-31, H8): Agent B's
 * pre-drafted tests for the join + renderer were parked in an agent-side
 * /tmp file and lost to the /tmp namespace split. These are re-derived
 * from the build brief's Step 3/Step 4 test prescriptions and acceptance
 * receipts §4.1–§4.4/§4.6 — they are not B's original text. (The §5 block
 * above IS B's surviving original.)
 */

function liveFinding(over: Partial<LiveFinding> = {}): LiveFinding {
  return {
    severity: 'high',
    title: 'Reflected XSS in search',
    attackId: 'T1059',
    evidence: 'marker reflected unencoded',
    ...over,
  }
}

const PROVEN_LIVE = liveFinding({
  cellState: 'proven',
  provenClaim: { expectedMarker: 'REDTEAM-MARKER-cell1', targetUrl: 'https://target.example/search' },
  cellDetail: 'Challenger critique + verification signed, negative control passed.',
})

describe('§3 report join (report/phase.ts applyCellVerdicts)', () => {
  it('a both-keys match stamps all three fields', () => {
    const f = confirmedFinding({ title: 'Reflected XSS in search', attackIds: ['T1059'] })
    applyCellVerdicts([f], [PROVEN_LIVE])
    assert.equal(f.cellState, 'proven')
    assert.deepEqual(f.provenClaim, { expectedMarker: 'REDTEAM-MARKER-cell1', targetUrl: 'https://target.example/search' })
    assert.equal(f.cellDetail, 'Challenger critique + verification signed, negative control passed.')
  })

  it('a title-only match does NOT stamp (attackId is a required key)', () => {
    const f = confirmedFinding({ title: 'Reflected XSS in search', attackIds: ['T1190'] })
    applyCellVerdicts([f], [PROVEN_LIVE])
    assert.equal(f.cellState, undefined)
    assert.equal(f.provenClaim, undefined)
    assert.equal(f.cellDetail, undefined)
  })

  it('an attackId-only match does NOT stamp (title is a required key)', () => {
    const f = confirmedFinding({ title: 'Something else entirely', attackIds: ['T1059'] })
    applyCellVerdicts([f], [PROVEN_LIVE])
    assert.equal(f.cellState, undefined)
    assert.equal(f.provenClaim, undefined)
  })

  it('case/whitespace title drift and attackId case drift still stamp', () => {
    const f = confirmedFinding({ title: '  reflected xss in SEARCH ', attackIds: ['t1059'] })
    applyCellVerdicts([f], [PROVEN_LIVE])
    assert.equal(f.cellState, 'proven')
  })

  it("proven wins across multiple live matches", () => {
    const detected = liveFinding({
      cellState: 'detected',
      provenClaim: { expectedMarker: 'M-det', targetUrl: 'https://target.example/search' },
      cellDetail: 'Control also reflected — falsified.',
    })
    const f = confirmedFinding({ title: 'Reflected XSS in search', attackIds: ['T1059'] })
    applyCellVerdicts([f], [detected, PROVEN_LIVE])
    assert.equal(f.cellState, 'proven')
    assert.deepEqual(f.provenClaim, { expectedMarker: 'REDTEAM-MARKER-cell1', targetUrl: 'https://target.example/search' })
  })

  it('one live finding stamps only the first parsed finding that matches it', () => {
    const f1 = confirmedFinding({ id: 'F-1', title: 'Reflected XSS in search', attackIds: ['T1059'] })
    const f2 = confirmedFinding({ id: 'F-2', title: 'Reflected XSS in search', attackIds: ['T1059'] })
    applyCellVerdicts([f1, f2], [PROVEN_LIVE])
    assert.equal(f1.cellState, 'proven')
    assert.equal(f2.cellState, undefined)
  })

  it('a complete miss leaves the finding unstamped', () => {
    const f = confirmedFinding({ title: 'Unrelated title', attackIds: ['T9999'] })
    applyCellVerdicts([f], [PROVEN_LIVE])
    assert.deepEqual(
      { cellState: f.cellState, provenClaim: f.provenClaim, cellDetail: f.cellDetail },
      { cellState: undefined, provenClaim: undefined, cellDetail: undefined },
    )
  })
})

describe('§3 halted path (haltedFindingFromLive)', () => {
  it('carries the three cell fields with positional id', () => {
    const f = haltedFindingFromLive(PROVEN_LIVE, 2)
    assert.equal(f.id, 'F-3')
    assert.equal(f.cellState, 'proven')
    assert.deepEqual(f.provenClaim, { expectedMarker: 'REDTEAM-MARKER-cell1', targetUrl: 'https://target.example/search' })
    assert.equal(f.cellDetail, 'Challenger critique + verification signed, negative control passed.')
    assert.deepEqual(f.attackIds, ['T1059'])
    assert.equal(f.status, 'confirmed')
  })

  it('an unadjudicated live finding keeps the fields absent; severity coerces', () => {
    const f = haltedFindingFromLive(liveFinding({ severity: 'bogus', attackId: '' }), 0)
    assert.equal(f.id, 'F-1')
    assert.equal(f.severity, 'info')
    assert.deepEqual(f.attackIds, [])
    assert.equal(f.cellState, undefined)
    assert.equal(f.provenClaim, undefined)
    assert.equal(f.cellDetail, undefined)
  })
})

function pocBundle(over: Partial<PocBundle> = {}): PocBundle {
  return {
    version: 1,
    bundleId: 'b-1',
    engagementId: 'eng-1',
    findingId: 'F-1',
    attackIds: ['T1059'],
    severity: 'high',
    title: 'Reflected XSS in search',
    target: 'https://target.example',
    operator: 'op',
    generatedAt: '2026-10-31T00:00:00.000Z',
    steps: [],
    validationTier: 'execution',
    proves: 'The marker was executed and echoed by the target.',
    doesNotProve: 'It does not prove data beyond the canary was reachable.',
    reverifyCommand: 'node reverify.mjs --finding F-1',
    ...over,
  } as PocBundle
}

const CELL_PROVEN_FINDING = confirmedFinding({
  title: 'Reflected XSS in search',
  attackIds: ['T1059'],
  cellState: 'proven',
  provenClaim: { expectedMarker: 'REDTEAM-MARKER-cell1', targetUrl: 'https://target.example/search' },
  cellDetail: 'Challenger critique + verification signed, negative control passed.',
})

describe('§4 tierOf (report/html/cards.ts)', () => {
  it('cellState proven + no bundle → proven', () => {
    assert.equal(tierOf(CELL_PROVEN_FINDING), 'proven')
  })

  it('cellState detected + confirmed status → confirmed, never proven', () => {
    assert.equal(tierOf(confirmedFinding({ cellState: 'detected' })), 'confirmed')
  })

  it('cellState proven + execution bundle → proven (both stamps, one tier)', () => {
    assert.equal(tierOf(CELL_PROVEN_FINDING, pocBundle({ validationTier: 'execution' })), 'proven')
  })

  it('no cellState + execution bundle → proven (pre-existing path, regression)', () => {
    assert.equal(tierOf(confirmedFinding(), pocBundle({ validationTier: 'execution' })), 'proven')
  })

  it('no cellState + no bundle → confirmed (unchanged)', () => {
    assert.equal(tierOf(confirmedFinding()), 'confirmed')
  })
})

describe('§4 finding cards — the Cell Receipt', () => {
  it('a bundle-less cell-proven finding renders the Cell Receipt, never a no-bundle line', () => {
    const card = findingCard({ finding: CELL_PROVEN_FINDING, noBundleReason: 'no correlated tool execution' })
    assert.match(card, /class="card proven"/)
    assert.match(card, /Cell Receipt — Proven Live/)
    assert.match(card, /REDTEAM-MARKER-cell1/)
    assert.match(card, /https:\/\/target\.example\/search/)
    assert.match(card, /negative control passed/)
    assert.doesNotMatch(card, /No replayable bundle/)
  })

  it('a detected finding keeps its honest no-bundle line and no Cell Receipt', () => {
    const card = findingCard({
      finding: confirmedFinding({ cellState: 'detected' }),
      noBundleReason: 'no correlated tool execution',
    })
    assert.match(card, /class="card confirmed"/)
    assert.match(card, /No replayable bundle/)
    assert.doesNotMatch(card, /Cell Receipt/)
  })

  it('observation bundle + cell stamp → bundle block AND Cell Receipt appended', () => {
    const card = findingCard({
      finding: CELL_PROVEN_FINDING,
      bundle: pocBundle({ validationTier: 'observation' }),
    })
    assert.match(card, /Observation Receipt/)
    assert.match(card, /Cell Receipt — Proven Live/)
  })

  it('execution bundle + cell stamp → bundle block alone, no Cell Receipt', () => {
    const card = findingCard({
      finding: CELL_PROVEN_FINDING,
      bundle: pocBundle({ validationTier: 'execution' }),
    })
    assert.match(card, /Exploit Receipt — Proven Live/)
    assert.doesNotMatch(card, /Cell Receipt/)
  })

  it('marker text is escaped in the Cell Receipt — agent-chosen text never injects raw', () => {
    const evil = confirmedFinding({
      cellState: 'proven',
      provenClaim: { expectedMarker: '<script>alert(1)</script>', targetUrl: 'https://target.example/x' },
      cellDetail: 'detail',
    })
    const block = cellReceiptBlock(evil)
    assert.doesNotMatch(block, /<script>alert\(1\)<\/script>/)
    assert.match(block, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })
})

describe('§4 rendered report — a cell-proven web finding lands in the Proven group', () => {
  const meta: ReportMeta = {
    engagementId: 'eng-cell-1',
    target: 'https://target.example',
    mode: 'red',
    environment: 'production',
    tier: 1,
    operator: 'op',
    client: 'SecScan',
    status: 'complete',
    phase: 'done',
    verified: true,
    objective: 'Assess the public surface',
    startedAt: '2026-10-31T09:00:00.000Z',
    generatedAt: '2026-10-31T10:00:00.000Z',
    findings: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    battery: { total: 1, confirmed: 1, executedClean: 0, killed: 0, blocked: 0, na: 0, pending: 0 },
  }

  it('accuracy line counts it proven; the card shows the Cell Receipt; no no-bundle line', () => {
    const findings = [CELL_PROVEN_FINDING]
    const input: EngagementReportInput = {
      meta,
      title: 'Penetration Test Report',
      narrativeMd: 'The team tested the search surface.',
      posture: gradeFindings(findings),
      banner: gradeBanner(findings),
      findings,
      bundles: new Map(),
      noBundleReasons: new Map([['F-1', 'no correlated tool execution']]),
      negativeProof: [],
      findingMeta: new Map(),
      coverage: {
        fullBattery: false,
        cells: [],
        totals: { total: 1, confirmed: 1, executedClean: 0, killed: 0, blocked: 0, na: 0, pending: 0 },
        probesUsed: 3,
        planOnly: [],
        notCovered: [],
      },
      activity: { eventCount: 3, rows: [], totalActions: 0, decisions: [], danglingCauses: [] },
    }
    const html = renderEngagementReportHtml(input)
    assert.match(html, /1 proven/)
    assert.match(html, /Cell Receipt — Proven Live/)
    assert.doesNotMatch(html, /No replayable bundle/)
  })
})

describe('H3 normal-path reconciliation (mergeReporterFindings)', () => {
  const liveA = liveFinding({
    title: 'SQL injection in login',
    attackId: 'T1190',
    severity: 'critical',
    evidence: 'runner-side evidence A',
  })
  const liveB = liveFinding({
    title: 'Reflected XSS in search',
    attackId: 'T1059',
    severity: 'high',
    evidence: 'runner-side evidence B',
  })

  it('a live finding the reporter omits still reaches the record, with runner-side evidence', () => {
    const reporter = [
      confirmedFinding({
        id: 'F-1',
        title: 'SQL injection in login',
        attackIds: ['T1190'],
        evidence: 'reporter prose A',
        fix: 'parameterize the query',
        retest: 'replay the payload',
      }),
    ]
    const dropped: Finding[] = []
    const out = mergeReporterFindings([liveA, liveB], reporter, (f) => dropped.push(f))
    assert.equal(out.length, 2, 'both live findings reach the record — the omission deletes nothing')
    assert.deepEqual(dropped, [])
    const [a, b] = out
    assert.equal(a!.id, 'F-1')
    assert.equal(a!.evidence, 'reporter prose A', 'matched finding carries the reporter\u2019s narrative')
    assert.equal(a!.fix, 'parameterize the query')
    assert.equal(a!.retest, 'replay the payload')
    assert.equal(b!.id, 'F-2')
    assert.equal(b!.title, 'Reflected XSS in search')
    assert.equal(b!.severity, 'high', 'identity fields are the live record\u2019s, not the reporter\u2019s')
    assert.equal(b!.status, 'confirmed')
    assert.equal(b!.evidence, 'runner-side evidence B', 'omitted finding keeps the runner-side evidence')
    assert.match(b!.fix, /reporter omitted/)
    assert.match(b!.retest, /reporter omitted/)
  })

  it('a reporter item matching no live finding is dropped and reported, never silently', () => {
    const invented = confirmedFinding({ id: 'F-9', title: 'Invented catastrophe', attackIds: ['T9999'] })
    const dropped: Finding[] = []
    const out = mergeReporterFindings([liveA], [invented], (f) => dropped.push(f))
    assert.equal(out.length, 1)
    assert.equal(out[0]!.title, 'SQL injection in login')
    assert.deepEqual(dropped, [invented], 'the unmatched reporter item is surfaced through the drop callback')
  })

  it('matches by ATT&CK id when the reporter renumbers, and keeps the live title', () => {
    const reporter = [
      confirmedFinding({
        id: 'F-7',
        title: 'SQLi (reporter retitle)',
        attackIds: ['t1190'],
        evidence: 'reporter prose',
        fix: 'fix prose',
        retest: 'retest prose',
      }),
    ]
    const out = mergeReporterFindings([liveA, liveB], reporter)
    assert.equal(out[0]!.evidence, 'reporter prose', 'the prose joined by attackId despite the renumbering')
    assert.equal(out[0]!.title, 'SQL injection in login', 'the live title stands — peer/cell joins key on it')
    assert.equal(out[1]!.evidence, 'runner-side evidence B')
  })

  it('an empty reporter JSON still yields the full live set', () => {
    const out = mergeReporterFindings([liveA, liveB], [])
    assert.equal(out.length, 2)
    assert.equal(out[0]!.evidence, 'runner-side evidence A')
    assert.equal(out[1]!.evidence, 'runner-side evidence B')
  })

  it('the cell verdict rides the merged record from the live finding, not the reporter text', () => {
    const out = mergeReporterFindings([PROVEN_LIVE], [
      confirmedFinding({ id: 'F-1', title: 'Reflected XSS in search', attackIds: ['T1059'] }),
    ])
    assert.equal(out[0]!.cellState, 'proven')
    assert.deepEqual(out[0]!.provenClaim, {
      expectedMarker: 'REDTEAM-MARKER-cell1',
      targetUrl: 'https://target.example/search',
    })
  })
})
