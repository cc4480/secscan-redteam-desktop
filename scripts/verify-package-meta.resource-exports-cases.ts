/** Resource export resolution: conditions, arrays, wildcards, and physical directories. */

import { expect, it } from 'vitest'
import { packageMetaProblems } from './verify-package-meta.ts'
import { json, manifest, root } from './verify-package-meta.fixtures.ts'

it('rejects an inaccessible resource declared outside a locale directory', () => {
  manifest({
    exports: { './search/locale/*.json': { require: './resources/search/*.json' } },
    files: ['resources/search'],
  })
  json('resources/search/en.json', { meta: { title: 'Search' } })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('resources/search/en.json')
  expect(problems).toContain('exports')
})

it.each([
  './resources/search/*.json',
  { types: './missing/*.json', import: './resources/search/*.json', require: './missing/*.json' },
  { node: { import: './resources/search/*.json' }, default: './missing/*.json' },
  ['./resources/search/*.json'],
])('accepts resource exports to an independent physical directory: %j', (target) => {
  manifest({
    exports: { './search': './lib/search.js', './search/locale/*.json': target },
    files: ['resources/search'],
  })
  json('resources/search/en.json', { meta: { title: 'Search' } })
  json('resources/search/zh.json', { meta: { title: '搜索' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it('accepts individually exported resources in an independent physical directory', () => {
  manifest({
    exports: {
      './search': './lib/search.js',
      './search/locale/en.json': './resources/search/en.json',
      './search/locale/zh.json': './resources/search/zh.json',
    },
    files: ['resources'],
  })
  json('resources/search/en.json', { meta: { title: 'Search' } })
  json('resources/search/zh.json', { meta: { title: '搜索' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it('ignores metadata in an unselected exports condition', () => {
  manifest({
    exports: { './locale/*.json': { import: './esm/*.json', require: './cjs/*.json' } },
    files: ['esm'],
  })
  json('esm/en.json', { meta: { title: 'ESM plugin' } })
  json('cjs/en.json', { meta: { title: false } })
  expect(packageMetaProblems(root)).toEqual([])
})

it.each([
  { default: './locale/*.json', import: './missing/*.json' },
  [null, './locale/*.json'],
  ['../invalid/*.json', './locale/*.json'],
])('uses Node condition order and export-array fallback: %j', (target) => {
  manifest({ exports: { './locale/*.json': target } })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it('does not fall through a valid exports target just because its file is missing', () => {
  manifest({ exports: { './locale/*.json': ['./missing/*.json', './locale/*.json'] } })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  expect(packageMetaProblems(root).join('\n')).toContain('locale/en.json')
})

it('discovers root and child locale resources through a general export wildcard', () => {
  manifest({ exports: { './*': './resources/*' }, files: ['resources'] })
  json('resources/locale/en.json', { meta: { title: 'Bundle' } })
  json('resources/search/locale/en.json', { meta: { title: 'Search' } })
  json('resources/review/locale/en.json', { meta: { title: 'Review' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it('rejects an exact resource exclusion under a general export wildcard', () => {
  manifest({ exports: { './*': './resources/*', './search/locale/en.json': null }, files: ['resources'] })
  json('resources/locale/en.json', { meta: { title: 'Bundle' } })
  json('resources/search/locale/en.json', { meta: { title: 'Search' } })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('search/locale/en.json')
  expect(problems).toContain('exports')
})

it('discovers plugin wildcards with repeated target substitutions', () => {
  manifest({ exports: { './*/locale/en.json': './resources/*/copy-*/en.json' }, files: ['resources'] })
  json('resources/search/copy-search/en.json', { meta: { title: 'Search' } })
  json('resources/review/copy-review/en.json', { meta: { title: 'Review' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it('rejects files that do not share the repeated export-target substitution', () => {
  manifest({ exports: { './*/locale/en.json': './locale/*/copy-*/en.json' }, files: ['locale'] })
  json('locale/search/copy-other/en.json', { meta: { title: 'Search' } })
  expect(packageMetaProblems(root).join('\n')).toContain('locale/search/copy-other/en.json')
})

it('rejects a missing exported locale target even when a conventional locale file exists', () => {
  manifest({ exports: { '.': './lib/index.js', './locale/*.json': './missing/*.json' } })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  expect(packageMetaProblems(root).join('\n')).toContain('en.json')
})

it('rejects language resources mapped outside the English resource directory', () => {
  manifest({
    exports: {
      '.': './lib/index.js',
      './locale/en.json': './locale/en.json',
      './locale/zh.json': './elsewhere/zh.json',
    },
    files: ['locale', 'elsewhere'],
  })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  json('locale/zh.json', { meta: { title: '插件' } })
  json('elsewhere/zh.json', { meta: { title: '其他' } })
  expect(packageMetaProblems(root).join('\n')).toContain('zh.json')
})
