/** Package icon declarations: target validity, exports, and publication. */

import { expect, it } from 'vitest'
import { packageMetaProblems } from './verify-package-meta.ts'
import { file, json, manifest, root } from './verify-package-meta.fixtures.ts'

it('does not require locale resources for exported package name and description', () => {
  manifest({ exports: { '.': './lib/index.js', './package.json': './package.json' }, files: ['lib'] })
  expect(packageMetaProblems(root)).toEqual([])
})

it.each([undefined, ['art'], ['art/*.svg'], ['./art/icon.svg']])('accepts a published package icon without locale resources: %j', (files) => {
  manifest({ icon: './art/icon.svg', files })
  file('art/icon.svg', '<svg/>')
  expect(packageMetaProblems(root)).toEqual([])
})

it.each([{ files: ['lib'] }, { files: ['art', '!art/icon.svg'] }])('rejects an icon omitted from package publication: %j', ({ files }) => {
  manifest({ icon: './art/icon.svg', files })
  file('art/icon.svg', '<svg/>')
  expect(packageMetaProblems(root).join('\n')).toContain('files must include art/icon.svg')
})

it.each([null, false, 1, '', './icon.gif', '/tmp/icon.svg', './missing.png', '../outside.svg'])('validates icon declarations without locale resources: %j', (icon) => {
  manifest({ icon })
  file('../outside.svg', '<svg/>')
  expect(packageMetaProblems(root).join('\n')).toContain('Plugin metadata for @test/plugin:')
})

it('requires the root icon declaration to be exported', () => {
  manifest({ icon: './icon.svg', exports: { '.': './entry.js' }, files: ['icon.svg'] })
  file('icon.svg', '<svg/>')
  expect(packageMetaProblems(root).join('\n')).toContain('exports must expose its icon declaration through @test/plugin/package.json')
})

it.each([
  { './search/package.json': './resources/search/manifest.json' },
  { './*/package.json': './resources/*/manifest.json' },
  { './*': './resources/*' },
])('validates icons of independent exported manifests: %j', (exports) => {
  manifest({ exports, files: ['resources'] })
  const document = './*' in exports ? 'resources/search/package.json' : 'resources/search/manifest.json'
  json(document, { icon: './icon.webp' })
  file('resources/search/icon.webp', 'webp')
  expect(packageMetaProblems(root)).toEqual([])
  json(document, { icon: './missing.png' })
  expect(packageMetaProblems(root).join('\n')).toContain('missing.png')
})

it('requires publication of both an exported icon manifest and its image', () => {
  manifest({ exports: { './search/package.json': './resources/search.json' }, files: ['resources/icon.svg'] })
  json('resources/search.json', { icon: './icon.svg' })
  file('resources/icon.svg', '<svg/>')
  expect(packageMetaProblems(root).join('\n')).toContain('files must include resources/search.json')
})

it('ignores icon-like fields in unrelated source JSON', () => {
  manifest()
  json('data.json', { icon: false })
  expect(packageMetaProblems(root)).toEqual([])
})
