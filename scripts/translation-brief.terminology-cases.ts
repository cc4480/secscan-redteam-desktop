/** Terminology cases: row parsing, word-boundary offsets, and per-direction selection. */

import { describe, expect, it } from 'vitest'
import { parseTerminologyRows, relevantTerminologyRows, termOffsets } from './translation-brief.ts'
import { TERMINOLOGY } from './translation-brief.fixtures-cases.ts'

describe('terminology', () => {
  it('parses data rows and skips the header and separator', () => {
    const rows = parseTerminologyRows(TERMINOLOGY)
    expect(rows.map(row => row.english)).toEqual(['agent', 'session log', 'gate', 'registry'])
    expect(rows[0]).toMatchObject({ chinese: 'agent', first: 'agent（智能体）' })
  })

  it('matches English terms on word boundaries with plural inflections', () => {
    expect(termOffsets('two agents met', 'agent', true)).toEqual([4])
    expect(termOffsets('two registries', 'registry', true)).toEqual([4])
    expect(termOffsets('reagents', 'agent', true)).toEqual([])
    expect(termOffsets('', 'agent', true)).toEqual([])
  })

  it('selects rows for the changed text per direction', () => {
    expect(relevantTerminologyRows(TERMINOLOGY, 'en-to-zh', 'All agents write a session log.').map(row => row.english))
      .toEqual(['agent', 'session log'])
    expect(relevantTerminologyRows(TERMINOLOGY, 'zh-to-en', '门禁在提交时运行。').map(row => row.english))
      .toEqual(['gate'])
    expect(relevantTerminologyRows(TERMINOLOGY, 'en-to-zh', 'delegate the work')).toEqual([])
  })
})
