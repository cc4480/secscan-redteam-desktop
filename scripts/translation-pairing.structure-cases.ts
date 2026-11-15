/** Regression cases for the translation structural signature and pair diff. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixturePairSource, fixtureSignature, signature } from './translation-pairing.fixtures.ts'
import {
  parseTranslationMarkdown,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'

describe('translation structural signature', () => {
  it('retains external GFM autolinks without parsing inline-link syntax', () => {
    const markdown = '<https://example.com/reference.md>\n'
    expect(signature(markdown).links).toEqual(['https://example.com/reference.md'])
  })

  it('retains exact authored bytes for ordinary external link targets', () => {
    const escaped = signature('[External](https://example.com/?x=1&amp;y=2)\n')
    const literal = signature('[External](https://example.com/?x=1&y=2)\n')
    expect(escaped.links).toEqual(['https://example.com/?x=1&amp;y=2'])
    expect(translationStructureDiff(escaped, literal)).toEqual([
      'link target #1 diverges between the pair: "https://example.com/?x=1&amp;y=2" vs "https://example.com/?x=1&y=2"',
    ])
  })

  it('treats target-locale siblings as one semantic link target', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-structure-'))
    try {
      writeFileSync(join(root, 'reference.md'), '# Reference\n')
      writeFileSync(join(root, 'reference.zh.md'), '# 参考\n')
      const sourceMarkdown = '[Reference](reference.md?view=full#section)\n'
      const counterpartMarkdown = '[参考](reference.zh.md?view=full#section)\n'
      const source = fixtureSignature(root, 'guide.md', sourceMarkdown, 'guide.zh.md')
      const counterpart = fixtureSignature(root, 'guide.zh.md', counterpartMarkdown, 'guide.md')
      expect(translationStructureDiff(source, counterpart)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('includes reference-style document links but excludes image-only definitions', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-structure-'))
    try {
      writeFileSync(join(root, 'reference.md'), '# Reference\n')
      writeFileSync(join(root, 'reference.zh.md'), '# 参考\n')
      const markdown = [
        '[Reference][doc]',
        '',
        '![Preview][asset]',
        '',
        '[doc]: reference.md',
        '[asset]: reference.zh.md',
        '',
      ].join('\n')
      expect(translationStructureSignature(
        parseTranslationMarkdown(markdown),
        'guide.zh.md',
        {
          repoRoot: root, sourcePath: 'guide.md',
          isTranslationPairSource: fixturePairSource, markdown,
        },
      ).links).toEqual(['dsh-translation-target:reference.md'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('compares the first duplicate reference definition that CommonMark resolves', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-structure-'))
    try {
      for (const name of ['reference', 'different', 'other']) {
        writeFileSync(join(root, `${name}.md`), `# ${name}\n`)
        writeFileSync(join(root, `${name}.zh.md`), `# ${name} zh\n`)
      }
      const sourceMarkdown = '[Reference][ref]\n\n[ref]: reference.md\n[ref]: other.md\n'
      const counterpartMarkdown = '[参考][ref]\n\n[ref]: different.zh.md\n[ref]: other.zh.md\n'
      const source = fixtureSignature(root, 'guide.md', sourceMarkdown, 'guide.zh.md')
      const counterpart = fixtureSignature(root, 'guide.zh.md', counterpartMarkdown, 'guide.md')
      expect(translationStructureDiff(source, counterpart)).toEqual([
        'link target #1 diverges between the pair: "dsh-translation-target:reference.md" vs "dsh-translation-target:different.md"',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts matching list kinds, starts, and item counts', () => {
    const source = signature('3. One\n4. Two\n\n- A\n- B\n')
    const counterpart = signature('3. 一\n4. 二\n\n- 甲\n- 乙\n')
    expect(translationStructureDiff(source, counterpart)).toEqual([])
  })

  it('rejects an altered ordered-list start', () => {
    const source = signature('3. One\n4. Two\n\n- A\n- B\n')
    const counterpart = signature('1. 一\n2. 二\n\n- 甲\n- 乙\n')
    expect(translationStructureDiff(source, counterpart)).toEqual([
      'list (kind, start, item count) #1 diverges between the pair: "ordered:start=3:items=2" vs "ordered:start=1:items=2"',
    ])
  })

  it('rejects a missing list item', () => {
    const source = signature('- A\n- B\n')
    const counterpart = signature('- 甲\n')
    expect(translationStructureDiff(source, counterpart)).toEqual([
      'list (kind, start, item count) #1 diverges between the pair: "bullet:items=2" vs "bullet:items=1"',
    ])
  })

  it('rejects altered table row or column counts', () => {
    const source = signature('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n')
    const counterpart = signature('| 甲 | 乙 |\n|---|---|\n| 一 | 二 |\n')
    expect(translationStructureDiff(source, counterpart)).toEqual([
      'table (row x column count) #1 diverges between the pair: "3x2" vs "2x2"',
    ])
  })
})
