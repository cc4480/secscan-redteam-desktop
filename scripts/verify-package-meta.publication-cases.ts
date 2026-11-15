/** Publication files: which resolved locale resources must ship in the package. */

import { expect, it } from 'vitest'
import { packageMetaProblems } from './verify-package-meta.ts'
import { json, manifest, root } from './verify-package-meta.fixtures.ts'

it.each([undefined, ['.'], ['./'], ['locale'], ['locale/'], ['./locale'], ['locale/*.json'], ['locale/**'],
  ['locale/en.json', 'locale/zh.json']])(
  'accepts published locale resources: %j',
  (files) => {
    manifest({ files })
    json('locale/en.json', { meta: { title: 'Plugin' } })
    json('locale/zh.json', { meta: { title: '插件' } })
    expect(packageMetaProblems(root)).toEqual([])
  },
)

it.each([
  [[], 'en'],
  [['lib'], 'en'],
  [['locale/en.json'], 'zh'],
  [['locale', '!locale/en.json'], 'en'],
  [['locale', '!locale/*.json'], 'en'],
  [['locale', '!locale'], 'en'],
] as const)('rejects omitted or excluded publication files: %j', (files, language) => {
  manifest({ files })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  json('locale/zh.json', { meta: { title: '插件' } })
  expect(packageMetaProblems(root).join('\n')).toContain(`files must include locale/${language}.json`)
})

it.each([{ files: ['locale'] }, { files: ['resources', '!resources/search/zh.json'] }])(
  'checks publication paths after resolving resource exports: %j',
  ({ files }) => {
    manifest({
      exports: { './search': './lib/search.js', './search/locale/*.json': './resources/search/*.json' },
      files,
    })
    json('resources/search/en.json', { meta: { title: 'Search' } })
    json('resources/search/zh.json', { meta: { title: '搜索' } })
    expect(packageMetaProblems(root).join('\n')).toContain('files must include resources/search/')
  },
)

it.each(['locale', 'resources/search'])('rejects translated metadata without an English resource: %s', (directory) => {
  manifest({
    exports: { '.': './lib/index.js', './package.json': './package.json', './locale/*.json': `./${directory}/*.json` },
    files: [directory],
  })
  json(`${directory}/zh.json`, { meta: { title: '插件' } })
  expect(packageMetaProblems(root).join('\n')).toContain('en.json')
})
