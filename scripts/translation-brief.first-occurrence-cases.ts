/** First-occurrence cases: when a moved 首次出现 rendering is flagged and what it pulls in. */

import { describe, expect, it } from 'vitest'
import { firstOccurrenceContext, markdownUnits, parseTerminologyRows } from './translation-brief.ts'
import { TERMINOLOGY } from './translation-brief.fixtures-cases.ts'

describe('first-occurrence tracking', () => {
  const before = '# T\n\nAlpha paragraph.\n\nThe agent runs.\n'
  const after = '# T\n\nAlpha paragraph with an agent.\n\nThe agent runs.\n'
  const rows = parseTerminologyRows(TERMINOLOGY).filter(row => row.english === 'agent')

  it('flags a moved first occurrence and pulls the vacated span in', () => {
    const context = firstOccurrenceContext(
      before, after, markdownUnits(before), markdownUnits(after), rows, new Set([1]),
    )
    expect(context.notes).toHaveLength(1)
    expect(context.notes[0]).toContain('moved from #2 to #1')
    expect(context.extraSpanIndices).toEqual([2])
  })

  it('stays silent when the first occurrence does not move', () => {
    const unmoved = before.replace('Alpha paragraph.', 'Alpha paragraph, revised.')
    const context = firstOccurrenceContext(
      before, unmoved, markdownUnits(before), markdownUnits(unmoved), rows, new Set([1]),
    )
    expect(context.notes).toEqual([])
    expect(context.extraSpanIndices).toEqual([])
  })

  it('ignores rows without a first-occurrence rendering', () => {
    const bare = parseTerminologyRows(TERMINOLOGY).filter(row => row.english === 'gate')
    const withGate = after.replace('The agent runs.', 'The gate runs.')
    const context = firstOccurrenceContext(
      before, withGate, markdownUnits(before), markdownUnits(withGate), bare, new Set([2]),
    )
    expect(context.notes).toEqual([])
  })
})
