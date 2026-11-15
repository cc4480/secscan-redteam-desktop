/** Brief-rendering cases: unit, mechanical, section, and document scopes plus fences. */

import { describe, expect, it } from 'vitest'
import { relevantTerminologyRows, renderTranslationBrief } from './translation-brief.ts'
import { TERMINOLOGY } from './translation-brief.fixtures-cases.ts'

describe('brief rendering', () => {
  const base = {
    sourcePath: 'docs/foo.md',
    counterpartPath: 'docs/foo.zh.md',
    direction: 'en-to-zh' as const,
    diff: '@@ -5 +5 @@\n-old text about the agent\n+new text about the agent',
    terminology: relevantTerminologyRows(TERMINOLOGY, 'en-to-zh', 'the agent'),
  }
  const bundle = {
    index: 4,
    label: 'paragraph',
    confirmedSourceText: 'old text about the agent\n',
    currentSourceText: 'new text about the agent\n',
    counterpartText: '关于 agent 的旧文本\n',
    counterpartStartLine: 9,
  }

  it('renders unit bundles with three-way context and line anchors', () => {
    const brief = renderTranslationBrief({
      ...base,
      scope: { kind: 'units', bundles: [bundle], firstOccurrenceNotes: ['agent: the document-wide first occurrence moved from #2 to #1; the agent（智能体） form moves with it (later occurrences drop the annotation).'] },
    })
    expect(brief).toContain('# Translation update briefing: docs/foo.md')
    expect(brief).toContain('## Changed units')
    expect(brief).toContain('### #4 paragraph — counterpart at docs/foo.zh.md:9')
    expect(brief).toContain('Last-confirmed English:')
    expect(brief).toContain('Current Chinese (bring this along):')
    expect(brief).toContain('## First-occurrence notes')
    expect(brief).toContain('agent（智能体）')
    expect(brief).toContain('首次出现 annotations attach to the document-wide first occurrence only')
    expect(brief).toContain('targets in the active bilingual corpus use `.zh.md` for Chinese')
    expect(brief).toContain('a missing in-scope counterpart is an error')
    expect(brief).toContain('verify-translation-pairing --write docs/foo.md')
  })

  it('marks first-occurrence bundles and omits their unchanged confirmed text', () => {
    const brief = renderTranslationBrief({
      ...base,
      scope: {
        kind: 'units',
        bundles: [{ ...bundle, reason: 'first-occurrence', confirmedSourceText: bundle.currentSourceText }],
        firstOccurrenceNotes: [],
      },
    })
    expect(brief).toContain('unchanged; included for a first-occurrence move')
    expect(brief).not.toContain('Last-confirmed English:')
  })

  it('renders the mechanical scope with the --apply command', () => {
    const brief = renderTranslationBrief({ ...base, scope: { kind: 'mechanical' } })
    expect(brief).toContain('## Mechanical update — no translation judgment involved')
    expect(brief).toContain('gen-translation-brief --apply docs/foo.md')
    expect(brief).not.toContain('## Changed units')
  })

  it('renders the section fallback under its own heading', () => {
    const brief = renderTranslationBrief({
      ...base,
      scope: { kind: 'sections', bundles: [bundle], firstOccurrenceNotes: [] },
    })
    expect(brief).toContain('## Changed sections')
    expect(brief).toContain('fine-grained units do not align')
  })

  it('renders the document fallback with its reason and no bundles', () => {
    const brief = renderTranslationBrief({
      ...base,
      scope: { kind: 'document', reason: 'BOTH sides changed since the pair was last confirmed consistent, so no side is a trustworthy mapping anchor; decide which side owns each divergence.' },
    })
    expect(brief).toContain('## Whole-document update required')
    expect(brief).toContain('BOTH sides changed')
    expect(brief).toContain('locate the affected regions yourself')
  })

  it('renders the English-target digest for zh-to-en updates', () => {
    const brief = renderTranslationBrief({
      ...base,
      direction: 'zh-to-en',
      sourcePath: 'docs/foo.zh.md',
      counterpartPath: 'docs/foo.md',
      scope: { kind: 'units', bundles: [bundle], firstOccurrenceNotes: [] },
    })
    expect(brief).toContain('exactly what the new Chinese states')
    expect(brief).toContain('targets in the active bilingual corpus use `.md` for English')
    expect(brief).toContain('targets outside the corpus keep the authored path')
    expect(brief).toContain('verify-translation-pairing --write docs/foo.md')
  })

  it('grows bundle fences past tilde runs in the text', () => {
    const brief = renderTranslationBrief({
      ...base,
      scope: {
        kind: 'units',
        bundles: [{ ...bundle, counterpartText: '~~~~\ninner\n~~~~\n' }],
        firstOccurrenceNotes: [],
      },
    })
    expect(brief).toContain('~~~~~markdown')
  })
})
