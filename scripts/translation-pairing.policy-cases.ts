/** Regression cases for translation pairing policy: manifest, switchers, records, scope. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixturePairSource, signature } from './translation-pairing.fixtures.ts'
import {
  parseTranslationPairingRecord,
  renderTranslationPairingRecord,
  translationPairPaths,
} from './translation-pairing-record.ts'
import {
  isTranslationPairingManifestExcluded,
  isTranslationScopeFile,
  languageSwitcherTargets,
  parseTranslationMarkdown,
  parseTranslationPairingManifest,
  requiresSourceLanguageSwitcher,
  translationPairSourcePredicate,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'

describe('translation pairing manifest', () => {
  it('accepts an exclusions-only manifest', () => {
    const manifest = parseTranslationPairingManifest(JSON.stringify({
      excluded: ['docs/generated/'],
    }))
    expect(manifest).toEqual({
      excluded: ['docs/generated/'],
    })
    expect(isTranslationPairingManifestExcluded('docs/generated/page.md', manifest)).toBe(true)
    expect(translationPairSourcePredicate(manifest)('docs/generated/page.md')).toBe(false)
    expect(translationPairSourcePredicate(manifest)('docs/guide.md')).toBe(true)
    expect(translationPairSourcePredicate(manifest)('packages/example/guide.md')).toBe(false)
  })

  it.each([
    ['required', ['packages/README.md']],
    ['requiredClasses', ['readme']],
    ['requiredSince', '2026-07-14'],
  ] as const)('rejects obsolete policy field %s instead of accepting an inert requirement', (field, value) => {
    expect(() => parseTranslationPairingManifest(JSON.stringify({
      excluded: [],
      [field]: value,
    }))).toThrow(`unsupported field(s): ${field}; every in-scope document is required`)
  })

  it('rejects a missing or non-string exclusion list', () => {
    expect(() => parseTranslationPairingManifest('{}')).toThrow('excluded must be an array of strings')
    expect(() => parseTranslationPairingManifest(JSON.stringify({
      excluded: [42],
    }))).toThrow('excluded must be an array of strings')
  })
})

describe('translation pairing switchers', () => {
  it('exempts only paired generated English sources from reciprocal switchers', () => {
    expect(requiresSourceLanguageSwitcher('docs/config-catalog.md')).toBe(false)
    expect(requiresSourceLanguageSwitcher('docs/cordis-api/context.md')).toBe(false)
    expect(requiresSourceLanguageSwitcher('docs/cordis-api/inherited.md')).toBe(false)
    expect(requiresSourceLanguageSwitcher('docs/architecture.md')).toBe(true)
    expect(requiresSourceLanguageSwitcher('packages/core/session/README.md')).toBe(true)
  })

  it('accepts only the canonical public URL for an absolute switcher', () => {
    const targets = languageSwitcherTargets('python/sdk/README.zh.md')
    const canonicalMarkdown = '# README\n\nEnglish | [中文](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.zh.md)\n'
    const canonical = parseTranslationMarkdown(canonicalMarkdown)
    const wrongMarkdown = '# README\n\nEnglish | [中文](https://github.com/deepseek-ai/deepseek-harness/blob/master/other/README.zh.md)\n'
    const wrongPath = parseTranslationMarkdown(wrongMarkdown)

    expect(translationStructureSignature(canonical, targets, {
      repoRoot: process.cwd(),
      sourcePath: 'python/sdk/README.md',
      isTranslationPairSource: fixturePairSource,
      markdown: canonicalMarkdown,
    }).links).toEqual([])
    expect(translationStructureSignature(wrongPath, targets, {
      repoRoot: process.cwd(),
      sourcePath: 'python/sdk/README.md',
      isTranslationPairSource: fixturePairSource,
      markdown: wrongMarkdown,
    }).links).toEqual([
      'https://github.com/deepseek-ai/deepseek-harness/blob/master/other/README.zh.md',
    ])
  })

  it('excludes only the header switcher from the structural links', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-translation-switcher-'))
    try {
      writeFileSync(join(root, 'guide.md'), '# Guide\n')
      writeFileSync(join(root, 'guide.zh.md'), '# 指南\n')
      const markdown = '# 指南\n\n[English](guide.md) | 中文\n\n[正文](guide.md)\n'
      expect(translationStructureSignature(
        parseTranslationMarkdown(markdown),
        languageSwitcherTargets('guide.md'),
        {
          repoRoot: root, sourcePath: 'guide.zh.md',
          isTranslationPairSource: fixturePairSource, markdown,
        },
      ).links).toEqual(['dsh-translation-target:guide.md'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('translation pairing link language parity', () => {
  it('compares a .zh.md target and its .md sibling as the same document', () => {
    const en = 'See [docs](persistence.md) and [notes](note.md#anchor).'
    const zh = '参见[文档](persistence.zh.md)与[笔记](note.zh.md#anchor)。'
    expect(
      translationStructureDiff(
        signature(en),
        signature(zh),
      ),
    ).toEqual([])
  })

  it('still rejects a genuinely different target', () => {
    const en = 'See [docs](persistence.md).'
    const zh = '参见[文档](other.md)。'
    expect(
      translationStructureDiff(
        signature(en),
        signature(zh),
      ),
    ).not.toEqual([])
  })
})

describe('translation pairing records', () => {
  const paths = translationPairPaths('docs/foo.md')
  const record = {
    sourceHash: '1'.repeat(40),
    zhHash: '2'.repeat(40),
  }

  it('round-trips the canonical two-hash record', () => {
    expect(parseTranslationPairingRecord(renderTranslationPairingRecord(paths, record), paths)).toEqual(record)
  })

  it('rejects duplicate or unexpected keys', () => {
    expect(parseTranslationPairingRecord([
      `foo.md: ${'1'.repeat(40)}`,
      `foo.md: ${'3'.repeat(40)}`,
      `foo.zh.md: ${'2'.repeat(40)}`,
      '',
    ].join('\n'), paths)).toBeUndefined()
    expect(parseTranslationPairingRecord([
      `foo.md: ${'1'.repeat(40)}`,
      `bar.zh.md: ${'2'.repeat(40)}`,
      '',
    ].join('\n'), paths)).toBeUndefined()
  })
})

describe('translation scope discovery', () => {
  it.each([
    'README.md',
    'CONTRIBUTING.md',
    'CONTRIBUTING.zh.md',
    'CONTRIBUTING.i18n.yaml',
    'BRAND_GUIDELINES.md',
    'BRAND_GUIDELINES.zh.md',
    'BRAND_GUIDELINES.i18n.yaml',
    'SAFETY.md',
    'SAFETY.zh.md',
    'SAFETY.i18n.yaml',
    'apps/cli/README.md',
    'future/subtree/readme.md',
    'packages/example/README.zh.md',
    'native/example/README.i18n.yaml',
    '.agents/notes/proposed/feature.md',
    'docs/guide.md',
    'python/guide.md',
    'python/sdk-runtime/README.md',
    'python/sdk-runtime/src/deepseek_harness_runtime/README.md',
  ])('includes %s', (file) => {
    expect(isTranslationScopeFile(file)).toBe(true)
  })

  it.each([
    'packages/example/guide.md',
    'packages/example/CONTRIBUTING.md',
    'packages/example/BRAND_GUIDELINES.md',
    'other/tutorial.md',
    'website/reference.md',
    'packages/example/README.txt',
    'vendor/example/README.md',
    'packages/example/node_modules/dependency/README.md',
    'packages/example/lib/README.md',
    'coverage/report/README.md',
    'python/sdk-runtime/src/deepseek_harness_runtime/runtime/deepseek-harness-sdk-runtime-macos-arm64/README.md',
    'python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/README.md',
    'python/sdk-runtime/src/deepseek_harness_runtime/runtime/macos-arm64/office-skills/office-docx/SKILL.md',
  ])('excludes non-source or non-README path %s', (file) => {
    expect(isTranslationScopeFile(file)).toBe(false)
  })
})
