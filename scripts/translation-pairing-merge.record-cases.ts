/** Record composition: paths, corpus scope, owner content, language switchers, divergence, and the owner strategy. */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { gitBlobHash } from './translation-pairing-git.ts'
import {
  baseSource,
  baseZh,
  createDivergedPair,
  currentSource,
  currentZh,
  generatedBaseSource,
  generatedBaseZh,
  generatedCurrentSource,
  generatedCurrentZh,
  generatedOtherSource,
  generatedOtherZh,
  mergedSource,
  mergedZh,
  otherSource,
  otherZh,
} from './translation-pairing-merge.corpus.ts'
import {
  createFixture,
  git,
  mergeTranslationPairingRecords,
  pairingMergeSuite,
  record,
  write,
} from './translation-pairing-merge.fixtures.ts'
import { mergeTranslationPairingRecords as mergeTranslationPairingRecordsWithScope } from './translation-pairing-merge.ts'

pairingMergeSuite(() => {
  it('rejects a pairing-record path outside the repository', () => {
    const fixture = createFixture(false)

    expect(() => mergeTranslationPairingRecords(
      fixture.root,
      '../guide.i18n.yaml',
      '',
      '',
      '',
    )).toThrow('pairing record escapes the repository')
  })

  it('rejects a pairing record excluded from the active corpus', () => {
    const fixture = createFixture(false)

    expect(() => mergeTranslationPairingRecordsWithScope(
      fixture.root,
      'docs/guide.i18n.yaml',
      '',
      '',
      '',
      () => false,
    )).toThrow('docs/guide.i18n.yaml is excluded from the active bilingual documentation corpus')
  })

  it('merges the owner blobs named by three valid records', () => {
    const fixture = createFixture(false)
    git(fixture, ['config', 'merge.default', 'text'])
    const records = createDivergedPair(fixture)

    const result = mergeTranslationPairingRecords(
      fixture.root,
      'docs/guide.i18n.yaml',
      records.ancestor,
      records.current,
      records.other,
    )

    expect(result.sourceContent.toString('utf8')).toBe(mergedSource)
    expect(result.zhContent.toString('utf8')).toBe(mergedZh)
    expect(result.sourceHash).toBe(gitBlobHash(Buffer.from(mergedSource)))
    expect(result.zhHash).toBe(gitBlobHash(Buffer.from(mergedZh)))
  })

  it('accepts locale-specific paths to the same paired document', () => {
    const fixture = createFixture(false)
    write(fixture.root, 'docs/reference.md', '# Overview\n')
    write(fixture.root, 'docs/reference.zh.md', '# 概览\n')
    git(fixture, ['add', 'docs/reference.md', 'docs/reference.zh.md'])
    const source = baseSource.replace('Alpha base.', '[Reference](reference.md#overview)')
    const zh = baseZh.replace('甲基础。', '[参考](reference.zh.md#overview)')
    const ancestor = record(fixture.root, 'docs/guide.md', source, zh)
    const current = record(fixture.root, 'docs/guide.md', source, zh)
    const other = record(fixture.root, 'docs/guide.md', source, zh)
    rmSync(join(fixture.root, 'docs/reference.md'))
    rmSync(join(fixture.root, 'docs/reference.zh.md'))

    expect(mergeTranslationPairingRecords(
      fixture.root,
      'docs/guide.i18n.yaml',
      ancestor,
      current,
      other,
    ).zhContent.toString('utf8')).toBe(zh)
  })

  it('rejects a clean merge whose Chinese link uses the English sibling', () => {
    const fixture = createFixture(false)
    write(fixture.root, 'docs/reference.md', '# Overview\n')
    write(fixture.root, 'docs/reference.zh.md', '# 概览\n')
    git(fixture, ['add', 'docs/reference.md', 'docs/reference.zh.md'])
    const source = baseSource.replace('Alpha base.', '[Reference](reference.md)')
    const zh = baseZh.replace('甲基础。', '[参考](reference.md)')
    const ancestor = record(fixture.root, 'docs/guide.md', source, zh)
    const current = record(fixture.root, 'docs/guide.md', source, zh)
    const other = record(fixture.root, 'docs/guide.md', source, zh)

    expect(() => mergeTranslationPairingRecords(
      fixture.root,
      'docs/guide.i18n.yaml',
      ancestor,
      current,
      other,
    )).toThrow('docs/guide.zh.md:5 clean merge uses "reference.md"; expected "reference.zh.md"')
  })

  it('merges a generated source without an English language switcher', () => {
    const fixture = createFixture(false)
    const ancestor = record(fixture.root, 'docs/module-graph.md', generatedBaseSource, generatedBaseZh)
    const current = record(fixture.root, 'docs/module-graph.md', generatedCurrentSource, generatedCurrentZh)
    const other = record(fixture.root, 'docs/module-graph.md', generatedOtherSource, generatedOtherZh)

    const result = mergeTranslationPairingRecords(
      fixture.root,
      'docs/module-graph.i18n.yaml',
      ancestor,
      current,
      other,
    )

    expect(result.sourceContent.toString('utf8')).toBe(
      generatedCurrentSource.replace('Beta base.', 'Beta other.'),
    )
    expect(result.zhContent.toString('utf8')).toBe(generatedCurrentZh.replace('乙基础。', '乙对侧。'))
  })

  it('rejects an authored source without an English language switcher', () => {
    const fixture = createFixture(false)
    const source = baseSource.replace('English | [中文](guide.zh.md)\n\n', '')
    const ancestor = record(fixture.root, 'docs/guide.md', source, baseZh)
    const current = record(fixture.root, 'docs/guide.md', source, baseZh)
    const other = record(fixture.root, 'docs/guide.md', source, baseZh)

    expect(() => mergeTranslationPairingRecords(
      fixture.root,
      'docs/guide.i18n.yaml',
      ancestor,
      current,
      other,
    )).toThrow('docs/guide.md clean merge lost its language-switcher link to guide.zh.md')
  })

  it('rejects generated Chinese content without its English backlink', () => {
    const fixture = createFixture(false)
    const zh = generatedBaseZh.replace('[English](module-graph.md) | 中文\n\n', '')
    const ancestor = record(fixture.root, 'docs/module-graph.md', generatedBaseSource, zh)
    const current = record(fixture.root, 'docs/module-graph.md', generatedBaseSource, zh)
    const other = record(fixture.root, 'docs/module-graph.md', generatedBaseSource, zh)

    expect(() => mergeTranslationPairingRecords(
      fixture.root,
      'docs/module-graph.i18n.yaml',
      ancestor,
      current,
      other,
    )).toThrow(
      'docs/module-graph.zh.md clean merge lost its language-switcher link to module-graph.md',
    )
  })

  it('leaves owner-content conflicts for a human', () => {
    const fixture = createFixture(false)
    const ancestor = record(fixture.root, 'docs/guide.md', baseSource, baseZh)
    const current = record(
      fixture.root,
      'docs/guide.md',
      baseSource.replace('Alpha base.', 'Alpha current.'),
      baseZh.replace('甲基础。', '甲当前。'),
    )
    const other = record(
      fixture.root,
      'docs/guide.md',
      baseSource.replace('Alpha base.', 'Alpha other.'),
      baseZh.replace('甲基础。', '甲对侧。'),
    )

    expect(() => mergeTranslationPairingRecords(
      fixture.root,
      'docs/guide.i18n.yaml',
      ancestor,
      current,
      other,
    )).toThrow('docs/guide.md has content conflicts')
  })

  it('rejects structurally divergent clean owner merges', () => {
    const fixture = createFixture(false)
    const ancestor = record(fixture.root, 'docs/guide.md', baseSource, baseZh)
    const current = record(fixture.root, 'docs/guide.md', currentSource, currentZh)
    const other = record(
      fixture.root,
      'docs/guide.md',
      `${otherSource}\n## Extra\n`,
      otherZh,
    )

    expect(() => mergeTranslationPairingRecords(
      fixture.root,
      'docs/guide.i18n.yaml',
      ancestor,
      current,
      other,
    )).toThrow('clean merges diverge structurally')
  })

  it('refuses owners assigned to another merge strategy', () => {
    const fixture = createFixture(false)
    write(fixture.root, '.gitattributes', 'docs/*.md merge=custom-owner\n')
    const records = createDivergedPair(fixture)

    expect(() => mergeTranslationPairingRecords(
      fixture.root,
      'docs/guide.i18n.yaml',
      records.ancestor,
      records.current,
      records.other,
    )).toThrow('docs/guide.md uses merge=custom-owner')
  })

  it('refuses unspecified owners affected by merge.default', () => {
    const fixture = createFixture(false)
    git(fixture, ['config', 'merge.default', 'custom-owner'])
    const records = createDivergedPair(fixture)

    expect(() => mergeTranslationPairingRecords(
      fixture.root,
      'docs/guide.i18n.yaml',
      records.ancestor,
      records.current,
      records.other,
    )).toThrow('merge.default=custom-owner')
  })
})
