/** The dependency cases: which package edges reach the default product. */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyDefaultProductIsolation } from './verify-default-product-isolation.ts'
import { base, core, experimental, fixture, manifest, profile, write } from './verify-default-product-isolation.harness-cases.ts'

describe('default product isolation', () => {
  it.each(['@deepseek-ai/libreoffice-kit'])(
    'accepts independently published %s but rejects unknown workspace packages', (name) => {
      const root = fixture()
      const file = 'packages/core/core/package.json'
      write(root, 'packages/core/core/src/index.ts', `import '${name}'\n`)
      manifest(root, file, { dependencies: { [name]: '0.0.1' } })
      expect(verifyDefaultProductIsolation(root).failures).toEqual([])
      manifest(root, file, { dependencies: { [`${name}-unknown`]: '0.0.1' } })
      expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain('unknown workspace package')
    },
  )

  it.each(['wasm', 'darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'])(
    'rejects a direct dependency on the %s engine', (engine) => {
      const root = fixture()
      const name = `@deepseek-ai/libreoffice-kit-${engine}`
      manifest(root, 'packages/core/core/package.json', { dependencies: { [name]: '0.0.1' } })
      expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`unknown workspace package ${name}`)
    },
  )

  it('allows development dependencies, type imports, and separate experimental preview entries', () => {
    const root = fixture()
    manifest(root, 'apps/cli/package.json', { devDependencies: { [experimental]: 'workspace:^' } })
    write(root, 'apps/cli/src/bin.ts', `import type { Options } from '${experimental}'\nexport type { Options }\n`)
    write(root, 'apps/web/src/preview.ts', `import '${experimental}'\n`)
    write(root, 'packages/experimental/prototype/cordis.patch.yml', [{ name: experimental }])

    expect(verifyDefaultProductIsolation(root)).toMatchObject({ failures: [], packageCount: 6, configCount: 2 })
  })

  it('ignores dependency trees and directories whose names end in a source extension', () => {
    const root = fixture()
    mkdirSync(join(root, 'python/sdk-runtime/src/vendor.js'), { recursive: true })
    write(root, 'python/sdk-runtime/src/node_modules/vendor/index.js', `import '${experimental}'\n`)

    expect(verifyDefaultProductIsolation(root).failures).toEqual([])
  })

  it('ships an optional bundle switched off: its graph is outside the product, its name stays out of imports and defaults', () => {
    const root = fixture()
    const layer = '@deepseek-ai/dsh-experimental-layer'
    write(root, 'packages/experimental/layer/package.json', {
      name: layer, dependencies: { [experimental]: 'workspace:^' }, dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    write(root, 'packages/experimental/layer/cordis.patch.yml', [{ insert: [{ name: experimental }] }])
    manifest(root, 'apps/cli/package.json', { dependencies: { [core]: 'workspace:^', [layer]: 'workspace:^' } })
    write(root, profile, `export const PROFILE_TEMPLATES = { web: { bundles: ['${base}'] } }\n`
      + `export const DEFAULT_PROFILE_BUNDLES = ['${base}']\n`
      + `export const OPTIONAL_BUNDLES = ['${layer}']\n`)
    expect(verifyDefaultProductIsolation(root)).toMatchObject({ failures: [], packageCount: 6 })

    // The exception covers the dependency edge alone: a runtime import or a default template still names the product.
    write(root, 'apps/cli/src/bin.ts', `import '${layer}'\n`)
    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`apps/cli/src/bin.ts -> ${layer}`)
    write(root, 'apps/cli/src/bin.ts', 'export {}\n')
    write(root, profile, `export const PROFILE_TEMPLATES = { web: { bundles: ['${base}', '${layer}'] } }\n`
      + `export const DEFAULT_PROFILE_BUNDLES = ['${base}']\n`
      + `export const OPTIONAL_BUNDLES = ['${layer}']\n`)
    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`optional bundle ${layer} must not be a default bundle`)
  })

  it('requires each optional bundle to be a runtime dependency that declares a bundle patch', () => {
    const root = fixture()
    write(root, profile, `export const PROFILE_TEMPLATES = { web: { bundles: ['${base}'] } }\n`
      + `export const DEFAULT_PROFILE_BUNDLES = ['${base}']\n`
      + `export const OPTIONAL_BUNDLES = ['${experimental}']\n`)
    const failures = verifyDefaultProductIsolation(root).failures.join('\n')
    expect(failures).toContain(`optional bundle ${experimental} must be a runtime dependency of apps/cli`)
    expect(failures).toContain(`optional bundle ${experimental} must declare dsh.bundle.patch`)

    // An experimental runtime dependency the list does not name is still a product requirement.
    write(root, profile, `export const PROFILE_TEMPLATES = { web: { bundles: ['${base}'] } }\n`
      + `export const DEFAULT_PROFILE_BUNDLES = ['${base}']\n`)
    manifest(root, 'apps/cli/package.json', { dependencies: { [core]: 'workspace:^', [experimental]: 'workspace:^' } })
    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`@deepseek-ai/dsh dependencies -> ${experimental}`)
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])(
    'rejects transitive experimental %s',
    (section) => {
      const root = fixture()
      manifest(root, 'packages/core/core/package.json', { [section]: { [experimental]: 'workspace:^' } })

      expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(`${core} ${section} -> ${experimental}`)
    },
  )

  it.each([
    `npm:${experimental}@1.0.0`, `workspace:${experimental}@*`,
    'file:../../experimental/prototype', 'link:../../experimental/prototype',
    'workspace:../../experimental/prototype',
  ])('rejects a safe-looking dependency alias targeting %s', (range) => {
    const root = fixture()
    manifest(root, 'packages/core/core/package.json', { dependencies: { safe: range } })

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('rejects experimental names absent from the inventory and paths with another package name', () => {
    const root = fixture()
    manifest(root, 'apps/cli/package.json', { dependencies: { '@deepseek-ai/dsh-experimental-missing': '*' } })
    manifest(root, 'packages/experimental/prototype/package.json', { name: '@fixture/innocent' })
    manifest(root, 'python/sdk-runtime/package.json', { dependencies: { '@fixture/innocent': '*' } })

    const failures = verifyDefaultProductIsolation(root).failures.join('\n')
    expect(failures).toContain('@deepseek-ai/dsh-experimental-missing')
    expect(failures).toContain('@fixture/innocent')
  })

  it('follows private application intermediaries and terminates cycles', () => {
    const root = fixture()
    write(root, 'apps/desktop/package.json', { name: '@fixture/desktop', private: true,
      dependencies: { [core]: '*', [experimental]: '*' } })
    manifest(root, 'packages/core/core/package.json', { peerDependencies: { '@fixture/desktop': '*' } })

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })
})
