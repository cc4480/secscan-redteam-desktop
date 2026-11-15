/** The composition cases: which plugin rows the composed default product contains. */

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { verifyDefaultProductIsolation } from './verify-default-product-isolation.ts'
import { base, core, experimental, fixture, profile, patch, write } from './verify-default-product-isolation.harness-cases.ts'

describe('default product isolation', () => {
  it.each([
    [{ name: experimental, disabled: true }],
    [{ group: true, config: [{ name: experimental }] }],
    [{ insert: [{ name: experimental }] }],
    [{ name: '@deepseek-ai/cordis-plugin-group', config: [{ name: experimental }] }],
    [{ name: '@deepseek-ai/cordis-plugin-include', config: { patches: [{ insert: [{ name: experimental }] }] } }],
  ].map(entries => ({ entries })))('rejects experimental plugin rows in $entries', ({ entries }) => {
    const root = fixture()
    write(root, patch, entries)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('follows Include files while ignoring ordinary plugin config data', () => {
    const root = fixture()
    write(root, patch, [{ insert: [{ name: core, config: { name: experimental, insert: [{ name: experimental }] } }] }])
    expect(verifyDefaultProductIsolation(root).failures).toEqual([])
    write(root, patch, [{ name: '@deepseek-ai/cordis-plugin-include', config: { path: './nested.yml' } }])
    write(root, 'packages/bundle/base/nested.yml', [{ name: experimental }])
    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it.each([false, true])('checks Include.initial when its file exists: %s', (existing) => {
    const root = fixture()
    const included = join(root, 'included.yml')
    if (existing) write(root, 'included.yml', [{ name: core }])
    write(root, patch, [{ insert: [{ name: 'cordis:include', config: {
      path: pathToFileURL(included).href,
      initial: [{ name: experimental }],
    } }] }])

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('accepts a missing Include file initialized with stable entries and applies its patches', () => {
    const root = fixture()
    write(root, patch, [{ insert: [{ name: 'cordis:include', config: {
      path: pathToFileURL(join(root, 'included.yml')).href,
      initial: [{ id: 'feature', group: true, config: [{ name: core }] }],
    } }] }])
    expect(verifyDefaultProductIsolation(root).failures).toEqual([])
    write(root, patch, [{ insert: [{ name: 'cordis:include', config: {
      path: pathToFileURL(join(root, 'included.yml')).href,
      initial: [{ id: 'feature', group: true, config: [{ name: core }] }],
      patches: [{ id: 'feature', config: [{ name: experimental }] }],
    } }] }])
    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('rejects an Include.initial tree that includes its own generated file', () => {
    const root = fixture()
    const path = pathToFileURL(join(root, 'included.yml')).href
    write(root, patch, [{ insert: [{ name: 'cordis:include', config: {
      path, initial: [{ name: 'cordis:include', config: { path } }],
    } }] }])

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain('cyclic Include path included.yml')
  })

  it('checks group contents after an id-only patch changes the composed Web tree', () => {
    const root = fixture()
    const web = '@deepseek-ai/dsh-web-app'
    write(root, 'packages/bundle/web-app/package.json', { name: web, dsh: { bundle: { patch: './cordis.patch.yml' } } })
    write(root, patch, [{ insert: [{ id: 'feature-group', group: true, config: [{ name: core }] }] }])
    write(root, 'packages/bundle/web-app/cordis.patch.yml', [
      { id: 'feature-group', config: [{ name: experimental }] },
    ])
    write(root, profile, `export const PROFILE_TEMPLATES = { web: { bundles: ['${base}', '${web}'] } }\n`
      + `export const DEFAULT_PROFILE_BUNDLES = ['${base}']\n`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`${profile} -> ${experimental}`)
  })

  it('composes Include patches before checking their effective plugin rows', () => {
    const root = fixture()
    const included = join(root, 'included tree', 'cordis.yml')
    write(root, 'included tree/cordis.yml', [{ id: 'feature-group', group: true, config: [{ name: core }] }])
    write(root, patch, [{ insert: [{ name: 'cordis:include', config: {
      path: pathToFileURL(included).href,
      patches: [{ id: 'feature-group', config: [{ name: experimental }] }],
    } }] }])

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`included tree/cordis.yml -> ${experimental}`)
  })

  it('checks the replacement Include path after an id-only Web patch', () => {
    const root = fixture()
    write(root, 'original.yml', [{ name: core }])
    write(root, 'replacement.yml', [{ name: experimental }])
    write(root, patch, [
      { insert: [{ id: 'feature-include', name: 'cordis:include', config: { path: pathToFileURL(join(root, 'original.yml')).href } }] },
      { id: 'feature-include', config: { path: pathToFileURL(join(root, 'replacement.yml')).href } },
    ])

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`replacement.yml -> ${experimental}`)
  })

  it('reports an empty effective Web tree even when the raw patch names a package', () => {
    const root = fixture()
    write(root, patch, [{ id: 'missing-target', name: core }])

    expect(verifyDefaultProductIsolation(root).failures).toContain(`${profile}: composed Web profile contains no plugins`)
  })

  it('rejects a file-URL plugin name anchored by the real patch loader', () => {
    const root = fixture()
    write(root, patch, [{ insert: [{ name: '../../experimental/prototype/src/index.ts' }] }])
    write(root, 'packages/experimental/prototype/src/index.ts', 'export {}\n')

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`${profile} -> ${experimental}`)
  })
})
