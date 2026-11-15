/** Workspace package discovery: which manifests and JSON documents the gate reads. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { packageMetaProblems } from './verify-package-meta.ts'
import { dir, file, json, manifest, root } from './verify-package-meta.fixtures.ts'

it('rejects an empty workspace package corpus', () => {
  expect(packageMetaProblems(root).join('\n')).toContain('no workspace package manifests')
})

it('excludes tests, installed dependencies, and build output from metadata discovery', () => {
  manifest({ exports: { '.': './lib/index.js' }, files: ['lib'] })
  json('tests/fixtures/locale/en.json', { meta: { title: false } })
  json('node_modules/dependency/locale/en.json', { meta: { title: false } })
  file('lib/locale/en.json', '{')
  expect(packageMetaProblems(root)).toEqual([])
})

it('ignores unrelated locale content without requiring metadata exports', () => {
  manifest({ exports: { '.': './lib/index.js' }, files: ['lib'] })
  json('locale/zh.json', { buttons: { save: '保存' }, enabled: true, other: null })
  expect(packageMetaProblems(root)).toEqual([])
})

it('ignores ordinary JSON metadata outside locale directories and resource exports', () => {
  manifest({ exports: { '.': './lib/index.js', './data.json': './data.json' } })
  json('data.json', { meta: { title: false, schemaVersion: 1 } })
  json('resources/search/en.json', { meta: { description: 'Business data' } })
  expect(packageMetaProblems(root)).toEqual([])
})

it('accepts direct root metadata and per-field English fallback without built entries', () => {
  manifest()
  json('locale/en.json', { meta: { title: 'Plugin', description: '%literal%' }, buttons: { save: 'Save' } })
  json('locale/zh.json', { meta: { title: '插件' }, nested: [1, null] })
  json('locale/pt-BR.json', { meta: { description: 'Descrição' } })
  file('locale/README.txt', 'Not a JSON resource.')
  expect(packageMetaProblems(root)).toEqual([])
  expect(existsSync(join(dir, 'lib'))).toBe(false)
})

it.each(['en', 'zh'])('rejects %s metadata resolved into build output without reading that JSON', (language) => {
  manifest({
    exports: {
      './locale/*.json': './locale/*.json',
      [`./locale/${language}.json`]: `./lib/locale/${language}.json`,
    },
  })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  json('locale/zh.json', { meta: { title: '插件' } })
  file(`lib/locale/${language}.json`, '{')
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain(`${language}.json`)
  expect(problems).toContain('source JSON')
  expect(problems).not.toContain('Plugin metadata for')
})

it('does not read built locale JSON while checking a source icon declaration', () => {
  manifest({
    icon: './icon.svg', files: ['icon.svg'],
    exports: { './package.json': './package.json', './locale/en.json': './lib/locale/en.json' },
  })
  file('icon.svg', '<svg/>')
  file('lib/locale/en.json', '{')
  json('locale/en.json', { meta: { title: 'Plugin' } })
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('exports must expose locale/en.json')
  expect(problems).not.toContain('Plugin metadata for')
})

it.each(['lib', 'tests'])('rejects an icon declaration when its only locale is excluded source: %s', (directory) => {
  manifest({
    icon: './missing.svg', files: ['lib'],
    exports: { './package.json': './package.json', './locale/en.json': `./${directory}/locale/en.json` },
  })
  file(`${directory}/locale/en.json`, '{}')
  const problems = packageMetaProblems(root).join('\n')
  expect(problems).toContain('@test/plugin: icon metadata requires locale resources to resolve to source JSON')
  expect(problems).not.toContain('Plugin metadata for')
})

it('reads static metadata without evaluating the plugin entry', () => {
  manifest({ exports: { '.': './entry.js', './locale/*.json': './locale/*.json' } })
  file('entry.js', "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('./executed', import.meta.url), 'yes'); throw new Error('plugin entry executed')")
  json('locale/en.json', { meta: { title: 'Plugin' } })
  expect(packageMetaProblems(root)).toEqual([])
  expect(existsSync(join(dir, 'executed'))).toBe(false)
})

it('accepts metadata from an unscoped package self-reference', () => {
  manifest({ name: 'plugin' })
  json('locale/en.json', { meta: { title: 'Plugin' } })
  expect(packageMetaProblems(root)).toEqual([])
})
