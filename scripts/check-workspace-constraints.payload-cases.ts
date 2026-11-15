/** Canonical package payload constraints and their published manifests. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkWorkspaceManifest,
  expectedDshPackageFiles,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

describe('package payload constraints', () => {
  it.each(['./art/icon.svg', 'art/icon.svg'])('includes declared icon %s in the canonical payload', (icon) => {
    expect(expectedDshPackageFiles({ icon, exports: { './locale/*.json': './locale/*.json' } })).toEqual([
      'art/icon.svg', 'locale/*.json', 'lib/index.js', 'lib/types/**/*.d.ts',
    ])
  })

  it('accepts the Agent Team icon payload and rejects its omission', () => {
    const dir = 'packages/experimental/agent-team-profile'
    const manifest = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
    expect(checkWorkspaceManifest({ dir, manifest })).toEqual([])
    expect(checkWorkspaceManifest({ dir, manifest: { ...manifest, files: manifest.files!.filter(file => file !== 'icon.svg') } }))
      .toEqual([expect.stringContaining('package.json files must be')])
  })

  it.each([
    { exports: { './locale/*.json': './locale/*.json' }, resources: ['locale/*.json'] },
    { exports: { './search/locale/*.json': './resources/search/*.json' }, resources: ['resources/search/*.json'] },
    { exports: { './locale/en.json': './locale/en.json', './locale/zh.json': './locale/zh.json' }, resources: ['locale/en.json', 'locale/zh.json'] },
    { exports: { './locale/*.json': { default: './locale/*.json' } }, resources: ['locale/*.json'] },
    { exports: { './locale/*.json': './locale/*.json', './search/locale/*.json': './locale/*.json' }, resources: ['locale/*.json'] },
    { exports: { './search/locale/*.json': './z/*.json', './locale/*.json': './a/*.json' }, resources: ['a/*.json', 'z/*.json'] },
  ])('includes declared locale resources in the canonical payload: $exports', ({ exports, resources }) => {
    expect(expectedDshPackageFiles({ name: '@deepseek-ai/dsh-localized', exports })).toEqual([
      ...resources, 'lib/index.js', 'lib/types/**/*.d.ts',
    ])
  })

  it('does not infer locale payloads from unrelated or non-JSON exports', () => {
    expect(expectedDshPackageFiles({
      exports: {
        './config.json': './config.json',
        './locale/README.md': './locale/README.md',
        './locale/en.json': './metadata.js',
        './locale/zh.json': null,
        './locale/fr.json': { types: './locale/fr.d.ts' },
      },
    })).toEqual(['lib/index.js', 'lib/types/**/*.d.ts'])
  })

  it.each(['agent-team', 'agent-team-profile', 'auto-review', 'client-ui-agent-team', 'tool-agent-team'])(
    'accepts the published locale files for %s and rejects their omission', (name) => {
      const dir = `packages/experimental/${name}`
      const manifest = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
      expect(checkWorkspaceManifest({ dir, manifest })).toEqual([])
      expect(checkWorkspaceManifest({ dir, manifest: {
        ...manifest, files: manifest.files!.filter(file => file !== 'locale/*.json'),
      } })).toEqual([expect.stringContaining('package.json files must be')])
    },
  )

  it('rejects locale publication entries without their resource exports', () => {
    const dir = 'packages/experimental/auto-review'
    const manifest = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
    const exports = { ...manifest.exports }
    delete exports['./locale/*.json']
    expect(checkWorkspaceManifest({ dir, manifest: { ...manifest, exports } }))
      .toEqual([expect.stringContaining('package.json files must be')])
  })

  it('includes a declared profile patch without a package-name allowlist', () => {
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-profile',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })).toEqual([
      'lib/index.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ])
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-profile',
      dsh: { bundle: { patch: ['./cordis.patch.yml', './layers/web.patch.yml'] } },
    })).toEqual([
      'lib/index.js',
      'cordis.patch.yml',
      'layers/web.patch.yml',
      'lib/types/**/*.d.ts',
    ])
  })

  it.each([
    'packages/client/ui-sidebar-documentpreview',
    'packages/client/ui-sidebar-terminal',
  ])('accepts package-local Client chunks from %s', (dir) => {
    const manifest = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
    expect(checkWorkspaceManifest({ dir, manifest })).toEqual([])
  })
})

it('publishes CLI runtime declarations and rejects a payload that omits them', () => {
  const manifest = JSON.parse(readFileSync(new URL('../apps/cli/package.json', import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
  expect(checkWorkspaceManifest({ dir: 'apps/cli', manifest })).toEqual([])
  expect(checkWorkspaceManifest({ dir: 'apps/cli', manifest: { ...manifest, files: ['lib/*.js'] } }))
    .toEqual([expect.stringContaining('@deepseek-ai/dsh: package.json files must be ["lib/*.js","lib/types/*.d.ts"]')])
})

it('requires the shared Web injection entry in the published payload', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/client/web/package.json', import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
  expect(checkWorkspaceManifest({ dir: 'packages/client/web', manifest })).toEqual([])
  expect(checkWorkspaceManifest({ dir: 'packages/client/web', manifest: {
    ...manifest, files: ['lib/index.js', 'lib/**/*.css', 'lib/types/**/*.d.ts'],
  } })).toEqual([expect.stringContaining('package.json files must be')])
})

it('requires Office skill bodies and helpers in the published payload', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/skill/skill-office/package.json', import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
  expect(checkWorkspaceManifest({ dir: 'packages/skill/skill-office', manifest })).toEqual([])
  expect(checkWorkspaceManifest({ dir: 'packages/skill/skill-office', manifest: {
    ...manifest, files: ['lib/index.js', 'lib/types/**/*.d.ts'],
  } })).toEqual([expect.stringContaining('package.json files must be')])
})

it('requires the local speech worker and locked runtime in the published payload', () => {
  const dir = 'packages/experimental/speech-to-text-sensevoice'
  const manifest = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
  expect(checkWorkspaceManifest({ dir, manifest })).toEqual([])
  for (const omitted of ['lib/worker.js', 'runtime/assets.json']) {
    expect(checkWorkspaceManifest({ dir, manifest: { ...manifest, files: manifest.files!.filter(file => file !== omitted) } }))
      .toEqual([expect.stringContaining('package.json files must be')])
  }
})
