/**
 * Completeness gating for report prose — the regression guard for the
 * defect that shipped "overall posture SECURE" and "No material business
 * risk identified" on a run that halted with 104 of 108 items unverdicted.
 *
 * The rule under test: a posture verdict may only be asserted over a battery
 * that actually concluded. `scoring.ts` derives a RiskLabel from the findings
 * set and returns "SECURE" for zero findings; that label describes the
 * findings, not whether the assessment ran, so every prose surface must gate
 * on completeness.ts instead of printing it directly.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReportDetail, type DetailInput,
} from '../src/report/detail.js'
import {
  gradeAnchorClause, isCoverageComplete, noFindingClause, pendingVerdicts,
  postureClause, type CoverageTotals,
} from '../src/report/completeness.js'

const complete: CoverageTotals = {
  total: 108, confirmed: 0, executedClean: 1, killed: 0, blocked: 3, na: 0, pending: 0,
}
const halted: CoverageTotals = {
  total: 108, confirmed: 0, executedClean: 1, killed: 0, blocked: 3, na: 0, pending: 104,
}

function input(coverage: CoverageTotals, over: Partial<DetailInput> = {}): DetailInput {
  return {
    target: 'Cho-zen1', mode: 'red', dryRun: false,
    // A halted run's label is "SECURE" precisely because nothing was found —
    // the exact value this module exists to keep out of the prose.
    posture: { score: 0, grade: 'N/A', postureRating: 'SECURE' },
    worstConfirmed: null,
    findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    tierCounts: { proven: 0, confirmed: 0, deferred: 0 },
    findings: [],
    coverage: {
      totals: coverage, probesUsed: 15, fullBattery: true,
      notCovered: [], planOnly: [], arms: [],
    },
    surface: {},
    ...over,
  }
}

describe('completeness predicate', () => {
  it('treats an empty battery as incomplete, not as clean', () => {
    assert.equal(isCoverageComplete({ ...complete, total: 0, pending: 0 }), false)
  })
  it('is complete only when nothing is pending', () => {
    assert.equal(isCoverageComplete(complete), true)
    assert.equal(isCoverageComplete(halted), false)
  })
  it('clamps a negative pending count', () => {
    assert.equal(pendingVerdicts({ ...complete, pending: -3 }), 0)
  })
})

describe('posture clause', () => {
  it('keeps the anchored label only over a concluded battery', () => {
    assert.equal(postureClause('SECURE', complete), 'overall posture SECURE')
  })
  it('refuses to assert a posture over an incomplete battery', () => {
    const clause = postureClause('SECURE', halted)
    assert.ok(!clause.includes('posture SECURE'), `must not claim a posture: ${clause}`)
    assert.ok(clause.includes('not determined'), clause)
    assert.ok(clause.includes('104 of 108'), clause)
  })
})

describe('zero-finding impact band', () => {
  it('may say no material risk only when every item concluded', () => {
    assert.match(noFindingClause(complete), /No material business risk identified/)
  })
  it('never says no material risk when items carry no verdict', () => {
    const t = noFindingClause(halted)
    assert.ok(!/No material business risk identified/.test(t), `asserted safety: ${t}`)
    assert.match(t, /absence of evidence/)
    assert.match(t, /104 of 108/)
  })
  it('grade anchor is withheld rather than invented', () => {
    assert.equal(gradeAnchorClause(complete), 'No single finding anchors the grade; it follows the confirmed set.')
    assert.match(gradeAnchorClause(halted), /no grade is anchored/i)
  })
})

describe('report detail surfaces are gated', () => {
  it('halted run: breakdown and impact never assert a clean posture', () => {
    const d = buildReportDetail(input(halted))
    const breakdown = d.breakdown.join('\n')
    assert.ok(!/overall posture SECURE/.test(breakdown), `breakdown claimed SECURE:\n${breakdown}`)
    assert.ok(!/No material business risk identified/.test(breakdown), breakdown)
    assert.ok(!/No material business risk identified/.test(d.impact.text), d.impact.text)
    assert.ok(/not determined/.test(breakdown), breakdown)
  })

  it('complete run: the honest all-clear still renders unchanged', () => {
    const d = buildReportDetail(input(complete))
    const breakdown = d.breakdown.join('\n')
    assert.match(breakdown, /overall posture SECURE/)
    assert.match(d.impact.text, /No material business risk identified/)
  })

  it('the SECURE label can never reach prose while anything is pending', () => {
    for (const pending of [1, 4, 104]) {
      const t = { ...halted, pending }
      const d = buildReportDetail(input(t))
      const all = [d.breakdown.join('\n'), d.impact.text].join('\n')
      assert.ok(!/posture SECURE/.test(all), `pending=${pending} leaked SECURE:\n${all}`)
    }
  })
})
