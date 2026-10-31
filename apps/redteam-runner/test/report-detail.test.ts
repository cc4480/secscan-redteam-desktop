/**
 * Q-REPORT-DETAIL — Agent A's unit tests for the pure derivations
 * (spec §12.1/2/4/5/6/7/8). Phase-level predecessor selection (§12.3)
 * is pinned in report-predecessor.test.ts; the rendered anatomy
 * (§12.9–13) in report-detail-render.test.ts. Fixtures are local so
 * this suite's verdicts attribute to detail.ts alone.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReportDetail, diffFindings, firstSentence,
  type BaselineInput, type DetailFindingInput, type DetailInput,
} from '../src/report/detail.js'

function f(over: Partial<DetailFindingInput> & { id: string }): DetailFindingInput {
  return {
    title: `Finding ${over.id}`, severity: 'medium', tier: 'confirmed',
    attackIds: [], sourceLabel: '', signals: [], fix: 'Fix it. Then verify.',
    ...over,
  }
}

function input(over: Partial<DetailInput> = {}): DetailInput {
  return {
    target: 'https://example.test', mode: 'red', dryRun: false,
    posture: { score: 80, grade: 'B', postureRating: 'GUARDED' },
    worstConfirmed: null,
    findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    tierCounts: { proven: 0, confirmed: 0, deferred: 0 },
    findings: [],
    coverage: {
      totals: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
      probesUsed: 36, fullBattery: true, notCovered: [], planOnly: [], arms: [],
    },
    surface: {},
    ...over,
  }
}

function baseline(over: Partial<BaselineInput> = {}): BaselineInput {
  return {
    engagementId: 'eng-base', startedAt: '2026-10-20T09:00:00.000Z',
    dryRun: false, score: 80, grade: 'B', findings: [],
    ...over,
  }
}

describe('detail diff (§12.1)', () => {
  it('identical sets are all unchanged with zero deltas', () => {
    const cur = [f({ id: 'F-1' }), f({ id: 'F-2', severity: 'low' })]
    const d = diffFindings(cur, baseline({ findings: cur.map(x => ({ ...x })) }), 80)
    assert.equal(d.unchangedCount, 2)
    assert.equal(d.newFindings.length + d.resolved.length + d.worsened.length + d.improved.length, 0)
    assert.equal(d.scoreDelta, 0)
    assert.equal(d.findingsDelta, 0)
  })

  it('new-only and resolved-only sets land in the right buckets', () => {
    const d = diffFindings(
      [f({ id: 'F-1', title: 'Brand new' })],
      baseline({ findings: [f({ id: 'F-9', title: 'Long gone', severity: 'high' })] }),
      80,
    )
    assert.deepEqual(d.newFindings.map(e => e.title), ['Brand new'])
    assert.deepEqual(d.resolved.map(e => e.title), ['Long gone'])
    assert.equal(d.resolved[0]!.severity, 'high', 'resolved carries the severity it had')
    assert.equal(d.findingsDelta, 0)
  })

  it('severity up is worsened, severity down is improved (listed, not unchanged)', () => {
    const before = [f({ id: 'F-1', title: 'Same', severity: 'low' }), f({ id: 'F-2', title: 'Other', severity: 'high' })]
    const after = [f({ id: 'F-1', title: 'Same', severity: 'high' }), f({ id: 'F-2', title: 'Other', severity: 'medium' })]
    const d = diffFindings(after, baseline({ findings: before }), 80)
    assert.equal(d.worsened.length, 1)
    assert.equal(d.worsened[0]!.fromSeverity, 'low')
    assert.equal(d.worsened[0]!.severity, 'high')
    assert.equal(d.improved.length, 1)
    assert.equal(d.improved[0]!.fromSeverity, 'high')
    assert.equal(d.unchangedCount, 0)
  })

  it('tier escalation CONFIRMED → PROVEN worsens; de-escalation improves', () => {
    const before = [f({ id: 'F-1', title: 'A' }), f({ id: 'F-2', title: 'B', tier: 'proven' })]
    const after = [f({ id: 'F-1', title: 'A', tier: 'proven' }), f({ id: 'F-2', title: 'B', tier: 'confirmed' })]
    const d = diffFindings(after, baseline({ findings: before }), 80)
    assert.equal(d.worsened.length, 1)
    assert.equal(d.worsened[0]!.fromTier, 'confirmed')
    assert.equal(d.worsened[0]!.toTier, 'proven')
    assert.equal(d.improved.length, 1)
  })

  it('a predecessor CONFIRMED now DEFERRED resolves with the deferred note', () => {
    const before = [f({ id: 'F-1', title: 'Shaky', attackIds: ['T1190'] })]
    const after = [f({ id: 'F-1', title: 'Shaky', attackIds: ['T1190'], tier: 'deferred' })]
    const d = diffFindings(after, baseline({ findings: before }), 80)
    assert.equal(d.resolved.length, 1)
    assert.match(d.resolved[0]!.note ?? '', /now deferred — verification outstanding/)
    assert.equal(d.newFindings.length, 0, 'deferred findings never enter the diff as new')
  })

  it('deferred findings are excluded from both sets entirely', () => {
    const d = diffFindings(
      [f({ id: 'F-1', title: 'Now' })],
      baseline({ findings: [f({ id: 'F-2', title: 'Was deferred', tier: 'deferred' })] }),
      80,
    )
    assert.equal(d.resolved.length, 0)
    assert.equal(d.findingsDelta, 1)
  })

  it('counts-only mode: no score on the baseline, no score delta', () => {
    const d = diffFindings([f({ id: 'F-1' })], baseline({ score: undefined, grade: undefined, findings: [] }), 42)
    assert.equal(d.scoreDelta, undefined)
    const detail = buildReportDetail(input({ baseline: baseline({ score: undefined, findings: [] }) }))
    assert.equal(detail.countsOnly, true)
    assert.match(detail.breakdown.join('\n'), /Against eng-base: findings 0 —/)
  })
})

describe('detail diff identity (§12.2)', () => {
  it('same title, different attackId → NOT matched (one new + one resolved)', () => {
    const d = diffFindings(
      [f({ id: 'F-1', title: 'Same title', attackIds: ['T1190'] })],
      baseline({ findings: [f({ id: 'F-1', title: 'Same title', attackIds: ['T1059'] })] }),
      80,
    )
    assert.equal(d.newFindings.length, 1)
    assert.equal(d.resolved.length, 1)
    assert.equal(d.unchangedCount, 0)
  })

  it('retitled finding with the same attackId → NOT matched (the pinned rule)', () => {
    const d = diffFindings(
      [f({ id: 'F-1', title: 'New wording', attackIds: ['T1190'] })],
      baseline({ findings: [f({ id: 'F-1', title: 'Old wording', attackIds: ['T1190'] })] }),
      80,
    )
    assert.equal(d.newFindings.length, 1)
    assert.equal(d.resolved.length, 1)
  })

  it('a ref-less baseline twin matches its labeled current finding by title', () => {
    const d = diffFindings(
      [f({ id: 'F-2', title: 'Missing CSP header', sourceLabel: 'Injection Defense', signals: ['WSTG-CONF-12'] })],
      baseline({ findings: [f({ id: 'F-2', title: 'Missing CSP header' })] }),
      80,
    )
    assert.equal(d.unchangedCount, 1, 'same severity + tier once the title pair is made')
    assert.equal(d.newFindings.length + d.resolved.length, 0)
  })
})

describe('detail risk areas (§12.5)', () => {
  const mixed = input({
    findings: [
      f({ id: 'F-1', severity: 'critical', sourceLabel: 'bola-idor', signals: ['CWE-79'] }),
      f({ id: 'F-2', severity: 'low', sourceLabel: 'Injection Defense', signals: ['WSTG-CONF-12', 'CWE-79'] }),
      f({ id: 'F-3', severity: 'info', sourceLabel: 'Information Disclosure' }),
      f({ id: 'F-4', severity: 'high', sourceLabel: 'Mystery Category' }),
      f({ id: 'F-5', severity: 'high', tier: 'deferred', sourceLabel: 'bola' }),
    ],
    tierCounts: { proven: 0, confirmed: 4, deferred: 1 },
  })

  it('every actionable finding is in exactly one area; sums reconcile', () => {
    const d = buildReportDetail(mixed)
    const sum = d.riskAreas.reduce((n, a) => n + a.findings.length, 0)
    assert.equal(sum, d.actionableCount)
    assert.equal(d.actionableCount, 4)
    assert.equal(d.deferredCount, 1)
  })

  it('the arm table beats the family table', () => {
    const d = buildReportDetail(mixed)
    const bola = d.riskAreas.find(a => a.findings.some(x => x.id === 'F-1'))
    assert.equal(bola!.name, 'API & Object Access')
  })

  it('engine categories route by family; the unfamiliar lands in General', () => {
    const d = buildReportDetail(mixed)
    const areaOf = (id: string) => d.riskAreas.find(a => a.findings.some(x => x.id === id))!.name
    assert.equal(areaOf('F-2'), 'Security Headers & Configuration')
    assert.equal(areaOf('F-3'), 'Information Exposure')
    assert.equal(areaOf('F-4'), 'General')
  })

  it('areas order by worst severity, then finding count', () => {
    const d = buildReportDetail(mixed)
    assert.equal(d.riskAreas[0]!.name, 'API & Object Access', "the critical's area leads")
    assert.equal(d.riskAreas[0]!.worst, 'critical')
  })
})

describe('detail impact (§12.6)', () => {
  it('rule 1: confirmed critical in API area carries the incident sentence', () => {
    const d = buildReportDetail(input({
      findings: [f({ id: 'F-1', severity: 'critical', sourceLabel: 'bola' })],
    }))
    assert.equal(d.impact.level, 'critical')
    assert.match(d.impact.text, /^Material business risk: F-1 \(/)
    assert.match(d.impact.text, /Treat as an incident until the fix is verified by retest\./)
  })

  it('rule 1: a critical outside the two named areas gets no incident sentence', () => {
    const d = buildReportDetail(input({
      findings: [f({ id: 'F-1', severity: 'critical', sourceLabel: 'csrf' })],
    }))
    assert.equal(d.impact.level, 'critical')
    assert.ok(!/Treat as an incident/.test(d.impact.text))
  })

  it('rule 2: highs are counted and the most serious is named', () => {
    const d = buildReportDetail(input({
      findings: [
        f({ id: 'F-1', severity: 'high', title: 'Weak session', sourceLabel: 'weak-session' }),
        f({ id: 'F-2', severity: 'high', title: 'No rate limit', sourceLabel: 'auth-rate-limit' }),
      ],
    }))
    assert.equal(d.impact.level, 'high')
    assert.match(
      d.impact.text,
      /Elevated business risk: 2 high-severity findings confirmed, the most serious being Weak session \(Authentication & Session\)\./,
    )
  })

  it('rule 3: medium-only is moderate; rule 4: low/info only is low', () => {
    const med = buildReportDetail(input({ findings: [f({ id: 'F-1', severity: 'medium', sourceLabel: 'csrf' })] }))
    assert.equal(med.impact.level, 'medium')
    assert.match(med.impact.text, /^Moderate business risk: the confirmed findings are exploitable weaknesses/)
    const low = buildReportDetail(input({ findings: [f({ id: 'F-1', severity: 'info', sourceLabel: 'Information Disclosure' })] }))
    assert.equal(low.impact.level, 'low')
    assert.match(low.impact.text, /1 item listed under Priority Actions\./)
  })

  it('rule 5: zero findings renders the zero sentence verbatim', () => {
    const d = buildReportDetail(input({ findings: [] }))
    assert.equal(d.impact.level, 'none')
    assert.equal(
      d.impact.text,
      'No material business risk identified from this pass; continued monitoring is still recommended as the application evolves.',
    )
  })
})

describe('detail priority (§12.7)', () => {
  it('orders by tier, then deduction weight, then numeric F-id', () => {
    const d = buildReportDetail(input({
      findings: [
        f({ id: 'F-10', severity: 'high' }),
        f({ id: 'F-2', severity: 'high' }),
        f({ id: 'F-1', severity: 'low', tier: 'proven' }),
        f({ id: 'F-3', severity: 'critical' }),
      ],
    }))
    assert.deepEqual(
      d.priority.actions.map(a => a.id),
      ['F-1', 'F-3', 'F-2', 'F-10'],
      'proven first (any weight), then weight, then F-2 before F-10',
    )
  })

  it('deferred findings form the Verify next list in severity order', () => {
    const d = buildReportDetail(input({
      findings: [
        f({ id: 'F-1', severity: 'low', tier: 'deferred' }),
        f({ id: 'F-2', severity: 'critical', tier: 'deferred' }),
        f({ id: 'F-3', severity: 'info' }),
      ],
    }))
    assert.deepEqual(d.priority.verifyNext.map(a => a.id), ['F-2', 'F-1'])
    assert.equal(d.priority.zeroNote, undefined)
  })

  it('fix text truncates at the first sentence, never mid-clause', () => {
    assert.equal(firstSentence('Enforce per-object authorization. Verify ownership.'), 'Enforce per-object authorization.')
    assert.equal(firstSentence('Rotate the key'), 'Rotate the key')
    const d = buildReportDetail(input({ findings: [f({ id: 'F-1' })] }))
    assert.equal(d.priority.actions[0]!.fixSentence, 'Fix it.')
  })

  it('zero actionable + zero deferred renders the coverage-figure zero note', () => {
    const d = buildReportDetail(input({ findings: [] }))
    assert.match(d.priority.zeroNote ?? '', /17 of 22 battery items executed/)
  })

  it('zero actionable with deferred outstanding shows Verify next, not the zero note', () => {
    const d = buildReportDetail(input({
      findings: [f({ id: 'F-1', tier: 'deferred' })],
    }))
    assert.equal(d.priority.zeroNote, undefined)
    assert.equal(d.priority.verifyNext.length, 1)
  })
})

describe('detail pillars (§12.8)', () => {
  const ARMS_RAN = [
    'bola', 'api', 'webhook', 'redteam',
    'aggressive_ssti', 'aggressive_nosql', 'aggressive_xxe', 'aggressive_crlf', 'aggressive_host_header',
    'csrf', 'dom_xss', 'deserialization', 'prototype_pollution', 'price_manipulation',
    'auth_rate_limit', 'i18n', 'edge_function', 'secscan-engine',
  ]
  const parityLike = input({
    findings: [
      f({ id: 'F-1', severity: 'critical', sourceLabel: 'bola-idor' }),
      f({ id: 'F-2', severity: 'low', sourceLabel: 'Injection Defense', signals: ['WSTG-CONF-12'] }),
      f({ id: 'F-3', severity: 'info', sourceLabel: 'Information Disclosure' }),
    ],
    coverage: {
      totals: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
      probesUsed: 36, fullBattery: true,
      notCovered: ['credential_chain', 'stored_xss', 'weak_session', 'llm'], planOnly: [],
      arms: ARMS_RAN.map(name => ({ name, state: 'ran' as const })),
    },
    surface: { tlsGrade: 'A', servedVia: 'Cloudflare', technologies: ['Cloudflare'] },
  })

  it('attribution sums equal the actionable total; engine findings split EASM/DAST', () => {
    const d = buildReportDetail(parityLike)
    const sum = d.pillars.reduce((n, p) => n + p.findingCount, 0)
    assert.equal(sum, d.actionableCount)
    const byName = new Map(d.pillars.map(p => [p.pillar, p]))
    assert.equal(byName.get('API SEC')!.findingCount, 1)
    assert.equal(byName.get('DAST')!.findingCount, 1, 'headers finding is DAST per §7.2')
    assert.equal(byName.get('EASM')!.findingCount, 1, 'exposure finding is EASM per §7.2')
    assert.equal(byName.get('EASM')!.status, 'MAPPED')
  })

  it('SAST/IAST/SCA are NO ARM in every fixture and never SECURE', () => {
    const d = buildReportDetail(parityLike)
    for (const name of ['SAST', 'IAST', 'SCA']) {
      const card = d.pillars.find(p => p.pillar === name)!
      assert.equal(card.status, 'NO ARM')
      assert.ok(card.reason && card.reason.length > 0, 'the NO ARM card states its reason')
    }
    assert.equal(d.pillars.length, 7)
    assert.deepEqual(d.pillars.map(p => p.pillar), ['SAST', 'DAST', 'IAST', 'SCA', 'EASM', 'API SEC', 'RED TEAM'])
  })

  it('a clean pillar that ran reads SECURE with the arms-executed footnote', () => {
    const d = buildReportDetail(parityLike)
    const rt = d.pillars.find(p => p.pillar === 'RED TEAM')!
    assert.equal(rt.status, 'SECURE')
    assert.equal(rt.footnote, '6 of 7 arms executed; 1 did not run — see Coverage.')
  })

  it('a pillar whose arms all failed to run is NOT COVERED with recorded reasons', () => {
    const d = buildReportDetail(input({
      findings: [],
      coverage: {
        totals: { total: 3, confirmed: 0, executedClean: 0, killed: 0, blocked: 3, na: 0, pending: 0 },
        probesUsed: 0, fullBattery: true, notCovered: [], planOnly: [],
        arms: [
          { name: 'bola', state: 'blocked', reason: 'ownership verification required' },
          { name: 'api', state: 'not-covered', reason: 'ownership verification required' },
          { name: 'webhook', state: 'blocked', reason: 'no webhook surface' },
        ],
      },
    }))
    const api = d.pillars.find(p => p.pillar === 'API SEC')!
    assert.equal(api.status, 'NOT COVERED')
    assert.match(api.reason ?? '', /ownership verification required/)
    assert.match(api.reason ?? '', /no webhook surface/)
  })

  it('EASM with no surface facts and no findings is NO DATA', () => {
    const d = buildReportDetail(input({ findings: [] }))
    assert.equal(d.pillars.find(p => p.pillar === 'EASM')!.status, 'NO DATA')
  })

  it('an unknown single-token arm label is a build error, never a silent drop', () => {
    assert.throws(
      () => buildReportDetail(input({ findings: [f({ id: 'F-1', sourceLabel: 'hyperdrive_scanner' })] })),
      /not a known arm/,
    )
  })
})

describe('detail breakdown + surface (§§3/8)', () => {
  it('composes the parity breakdown lines exactly', () => {
    const d = buildReportDetail(input({
      target: 'https://secscan.us',
      posture: { score: 20, grade: 'F', postureRating: 'CRITICAL' },
      worstConfirmed: { id: 'F-1', severity: 'critical', title: 'Cross-tenant object access (BOLA)' },
      findingsBySeverity: { critical: 1, high: 0, medium: 0, low: 1, info: 1 },
      tierCounts: { proven: 0, confirmed: 3, deferred: 0 },
      findings: [
        f({ id: 'F-1', severity: 'critical', title: 'Cross-tenant object access (BOLA)', sourceLabel: 'bola-idor', attackIds: ['T1190'] }),
        f({ id: 'F-2', severity: 'low', title: 'Missing CSP', sourceLabel: 'Injection Defense', signals: ['WSTG-CONF-12'] }),
        f({ id: 'F-3', severity: 'info', title: 'robots.txt paths', sourceLabel: 'Information Disclosure' }),
      ],
      coverage: {
        totals: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
        probesUsed: 36, fullBattery: true,
        notCovered: ['credential_chain', 'stored_xss', 'weak_session', 'llm'], planOnly: [],
        arms: [],
      },
    }))
    assert.deepEqual(d.breakdown, [
      'Automated red assessment of https://secscan.us: 3 active findings across 3 areas; overall posture CRITICAL.',
      'The grade is anchored by F-1 (critical · Cross-tenant object access (BOLA)) — one confirmed critical caps the score at 20.',
      '1 critical · 0 high · 0 medium · 1 low · 1 info — 0 proven · 3 confirmed · 0 deferred.',
      '17 of 22 battery items executed; 4 blocked and 0 not-applicable, each with its recorded reason under Coverage.',
      '4 arms did not run: credential_chain, stored_xss, weak_session, llm — reasons under Coverage.',
    ])
    assert.equal(d.diff, null)
    assert.equal(d.baselineLabel, undefined)
  })

  it('surface rows render only what the record carries', () => {
    const empty = buildReportDetail(input({ surface: {} }))
    assert.equal(empty.surfaceNetwork, null)
    const full = buildReportDetail(input({
      surface: { ips: ['203.0.113.7'], tlsGrade: 'A', technologies: ['Cloudflare', 'Rails'] },
      coverage: {
        totals: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
        probesUsed: 36, fullBattery: true, notCovered: [], planOnly: [],
        arms: [{ name: 'bola', state: 'ran' }],
      },
    }))
    const labels = full.surfaceNetwork!.map(r => r.label)
    assert.deepEqual(labels, ['Resolved IP', 'TLS grade', 'Technologies'])
    const armsRow = full.surfaceDynamic.find(r => r.label === 'Arms')!
    assert.match(armsRow.value, /^1 of 21 arms executed — not run: /)
    assert.ok(!full.surfaceDynamic.some(r => r.label === 'Pages discovered'), 'absent figures stay absent')
  })
})
