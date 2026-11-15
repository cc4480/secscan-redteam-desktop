/** The per-slot report budget: a projection whose prose a model could not finish reading. */

import { describe, expect, it } from 'vitest'
import { oversizedSlotReports, resolveSlotEntries } from './gen-client-catalog.ts'
import { declaration, OWNER_TYPES } from './gen-client-catalog.fixtures-cases.ts'

describe('the per-slot report budget', () => {
  it('rejects a slot whose report a model could not finish reading', () => {
    // Truncation already bounds one declaration, so the remaining runaway is
    // prose: a contract that grew into a manual costs exactly what narrowing to
    // one slot was supposed to save.
    const manual = ['/**', ...Array.from({ length: 150 }, (_, i) => ` * Paragraph ${String(i)} about this seat.`), ' */']
    const entries = resolveSlotEntries([declaration({ jsDoc: manual.join('\n') })], [], OWNER_TYPES, new Map())
    const problems = oversizedSlotReports(entries)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("slot 'demo.seat'")
    expect(problems[0]).toContain('tighten')
  })

  it('passes a slot whose report stays within the budget', () => {
    const entries = resolveSlotEntries([declaration({ ownerType: 'DemoOwnerProps' })], [], OWNER_TYPES, new Map())
    expect(oversizedSlotReports(entries)).toEqual([])
  })
})
