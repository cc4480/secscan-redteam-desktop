/** Span-mapping cases: unit kinds, heading sections, and change detection. */

import { describe, expect, it } from 'vitest'
import {
  changedSpanIndices,
  markdownUnits,
  sectionSpans,
  spansAligned,
} from './translation-brief.ts'
import { DOC } from './translation-brief.fixtures-cases.ts'

describe('markdown spans', () => {
  it('lists units with container-scoped kinds in document order', () => {
    const kinds = markdownUnits(DOC).map(span => span.kind)
    expect(kinds).toEqual([
      'root.0:paragraph',
      'root.1:heading:1',
      'root.2:paragraph',
      'root.3:heading:2',
      'root.4:paragraph',
      'root.5:code',
      'root.6:heading:2',
      'root.7.0:tableRow',
      'root.7.1:tableRow',
      'root.8.0:listItem',
      'root.8.1:listItem',
    ])
  })

  it('lists heading sections with a preamble span and heading labels', () => {
    const sections = sectionSpans(DOC)
    expect(sections.map(span => span.label)).toEqual([
      '(preamble before the first heading)',
      'Title',
      'First',
      'Second',
    ])
    expect(sections[0]).toMatchObject({ startLine: 1, endLine: 2 })
    expect(sections[2]).toMatchObject({ startLine: 7, endLine: 14 })
  })

  it('labels units by their node type', () => {
    const units = markdownUnits(DOC)
    expect(units[0]!.label).toBe('paragraph')
    expect(units[1]!.label).toBe('heading')
    expect(units[7]!.label).toBe('tableRow')
  })

  it('aligns sections by depth only, so translated heading text still maps', () => {
    const zh = DOC.replace('## First', '## 第一节').replace('## Second', '## 第二节').replace('# Title', '# 标题')
    expect(spansAligned(sectionSpans(DOC), sectionSpans(zh))).toBe(true)
  })

  it('aligns span lists only on equal non-empty kind sequences', () => {
    const zh = DOC.replace('First body.', '第一段。').replace('item one', '第一项').replace('Intro paragraph.', '导语。')
    expect(spansAligned(markdownUnits(DOC), markdownUnits(zh))).toBe(true)
    const reshaped = DOC.replace('- item one\n- item two', 'merged paragraph')
    expect(spansAligned(markdownUnits(DOC), markdownUnits(reshaped))).toBe(false)
    expect(spansAligned([], [])).toBe(false)
  })

  it('reports the indices whose text changed', () => {
    const edited = DOC.replace('First body.', 'First body, revised.').replace('| 1 | 2 |', '| 1 | 3 |')
    expect(changedSpanIndices(markdownUnits(DOC), markdownUnits(edited))).toEqual([4, 8])
  })
})
