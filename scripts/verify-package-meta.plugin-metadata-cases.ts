/** Root and independently exported plugin metadata: locale exposure and English fields. */

import { expect, it } from 'vitest'
import { packageMetaProblems } from './verify-package-meta.ts'
import { json, manifest, root } from './verify-package-meta.fixtures.ts'

it('validates root and multiple exported plugins independently', () => {
  manifest({
    exports: {
      '.': './lib/index.js',
      './search': './lib/search.js',
      './write': './lib/write.js',
      './locale/*.json': './locale/root/*.json',
      './search/locale/*.json': './locale/search/*.json',
      './write/locale/*.json': './locale/write/*.json',
    },
  })
  json('locale/root/en.json', { meta: { title: 'Bundle' } })
  json('locale/search/en.json', { meta: { title: 'Search' } })
  json('locale/search/zh.json', { meta: { title: '搜索' } })
  json('locale/write/en.json', { meta: { description: 'Write files' } })
  json('locale/write/zh.json', { meta: { description: '写入文件' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it('accepts missing English fields in independently exported plugin metadata', () => {
  manifest({
    exports: {
      '.': './lib/index.js',
      './search': './lib/search.js',
      './locale/*.json': './locale/root/*.json',
      './search/locale/*.json': './locale/search/*.json',
    },
  })
  json('locale/root/en.json', { meta: { description: 'Bundle description' } })
  json('locale/search/en.json', { meta: { title: 'Search' } })
  json('locale/search/zh.json', { meta: { description: '搜索文件' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it.each([
  { '.': './lib/index.js' },
  { '.': './lib/index.js', './locale/*.json': null },
  { '.': './lib/index.js', './locale/*.json': { require: './locale/*.json' } },
  { '.': './lib/index.js', './locale/*.json': './locale/*.json', './locale/en.json': null },
])('rejects a locale file that package exports do not expose: %j', (exports) => {
  manifest({ exports: { ...exports, './package.json': './package.json' } })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('locale/en.json')
  expect(problems).toContain('exports')
})

it('requires exports for every translated resource', () => {
  manifest({ exports: { '.': './lib/index.js', './locale/en.json': './locale/en.json' } })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  json('locale/zh.json', { meta: { title: '插件' } })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('locale/zh.json')
  expect(problems).toContain('exports')
})

it.each(['locale/search', 'search/locale'])('discovers child metadata without its resource export: %s', (directory) => {
  manifest({ exports: { './search': './lib/search.js' }, files: [directory] })
  json(`${directory}/en.json`, { meta: { title: 'Search' } })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain(`${directory}/en.json`)
  expect(problems).toContain('exports')
})
