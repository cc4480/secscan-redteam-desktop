/**
 * The plan-step text ceiling.
 *
 * The failure these guard against is silent: a step statement clipped to a few
 * hundred characters still persists and still looks like a plan, but the sign-off
 * gate rejects truncated steps, so the plan→recon transition becomes unsatisfiable.
 * The assertions below pin the boundary at both ends — a realistic statement
 * survives, a runaway generation is still bounded.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clampPlanStepText } from '../src/phases/plan.js'

/** Build a statement of `chars` characters whose length is easy to assert. */
const text = (chars: number): string => 'x'.repeat(chars)

describe('clampPlanStepText', () => {
  it('keeps a realistic step statement intact', () => {
    // The plan that failed review carried statements around 500-700 characters.
    for (const chars of [120, 480, 500, 501, 700, 1500]) {
      const statement = text(chars)
      assert.equal(clampPlanStepText(statement, undefined).description, statement, `${chars} chars must survive`)
    }
  })

  it('still bounds a runaway generation', () => {
    const clamped = clampPlanStepText(text(10_000), undefined)
    assert.equal(clamped.description.length, 4000)
  })

  it('keeps a realistic stealth note intact and bounds a runaway one', () => {
    assert.equal(clampPlanStepText('d', text(300)).stealthNote, text(300))
    assert.equal(clampPlanStepText('d', text(5000)).stealthNote?.length, 1000)
  })

  it('omits the stealth note when the step supplied none', () => {
    const clamped = clampPlanStepText('d', undefined)
    assert.equal('stealthNote' in clamped, false)
  })
})
