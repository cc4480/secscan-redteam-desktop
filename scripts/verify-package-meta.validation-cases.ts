/** Locale document validation: display fields, language filenames, and JSON syntax. */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { packageMetaProblems } from './verify-package-meta.ts'
import { dir, file, json, manifest, root, usePluginDirectory } from './verify-package-meta.fixtures.ts'

it.each([
  { field: 'title', packageInfo: true },
  { field: 'description', packageInfo: true },
  { field: 'title', packageInfo: false },
  { field: 'description', packageInfo: false },
])('accepts a missing English $field with package metadata $packageInfo', ({ field, packageInfo }) => {
  manifest({
    exports: {
      '.': './lib/index.js',
      './locale/*.json': './locale/*.json',
      ...packageInfo ? { './package.json': './package.json' } : {},
    },
  })
  json('locale/en.json', { meta: {} })
  json('locale/zh.json', { meta: { [field]: '译文' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it.each([null, [], false, 1, 'text'])('rejects malformed meta: %j', (meta) => {
  manifest()
  json('locale/en.json', { meta })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('en.json')
  expect(problems).toContain('meta')
})

it.each([null, [], false, 1, 'text'])('rejects a non-object English locale document: %j', (contents) => {
  manifest()
  json('locale/en.json', contents)
  expect(packageMetaProblems(root).join('\n')).toContain('en.json')
})

it.each([null, false, 1, {}, [], '', '  '])('rejects a malformed display field: %j', (value) => {
  manifest()
  json('locale/en.json', { meta: { title: 'Plugin', description: 'About it' } })
  json('locale/zh.json', { meta: { title: value } })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('zh.json')
  expect(problems).toContain('title')
})

it.each(['en', 'zh'])('rejects malformed JSON in %s.json', (language) => {
  manifest()
  json('locale/en.json', { meta: { title: 'Plugin' } })
  file(`locale/${language}.json`, '{')
  expect(packageMetaProblems(root).join('\n')).toContain(`${language}.json`)
})

it('rejects invalid language filenames', () => {
  manifest()
  json('locale/en.json', { meta: { title: 'Plugin' } })
  json('locale/not_a_language.json', { meta: { title: 'Other' } })
  expect(packageMetaProblems(root).join('\n')).toContain('not_a_language.json')
})

it('rejects case-equivalent language files when the filesystem can hold both', (context) => {
  manifest()
  json('locale/en.json', { meta: { title: 'Plugin' } })
  json('locale/EN.json', { meta: { title: 'Other' } })
  if (readdirSync(join(dir, 'locale')).length !== 2) context.skip()
  expect(packageMetaProblems(root).join('\n')).toContain('duplicates locale en')
})

it('accepts locale files without metadata alongside an English introduction', () => {
  manifest()
  json('locale/en.json', { meta: { title: 'Plugin' } })
  json('locale/zh.json', { buttons: { save: '保存' }, other: null })
  expect(packageMetaProblems(root)).toEqual([])
})

it('reports metadata failures from more than one workspace package', () => {
  manifest()
  json('locale/en.json', { meta: { title: false } })
  usePluginDirectory(join(root, 'packages', 'another', 'second'))
  manifest({ name: '@test/second' })
  json('locale/en.json', { meta: { title: 'Second' } })
  json('locale/zh.json', { meta: { description: '' } })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('@test/plugin')
  expect(problems).toContain('@test/second')
})
