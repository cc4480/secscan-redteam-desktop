/** The profile and input cases: default-profile declarations and the required inputs. */

import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyDefaultProductIsolation } from './verify-default-product-isolation.ts'
import { base, experimental, fixture, manifest, preset, profile, write } from './verify-default-product-isolation.harness-cases.ts'

describe('default product isolation', () => {
  it('checks default profile bundle names and declared config trees', () => {
    const root = fixture()
    write(root, profile, `export const PROFILE_TEMPLATES = { web: { bundles: ['${experimental}'] } }\n`
      + `export const DEFAULT_PROFILE_BUNDLES = ['${base}']\n`)
    manifest(root, 'apps/cli/package.json', { dsh: { configTrees: [{ path: './config' }] } })
    write(root, 'apps/cli/config/extra.cordis.yml', [{ name: experimental }])
    const failures = verifyDefaultProductIsolation(root).failures.join('\n')
    expect(failures).toContain(`${profile} -> ${experimental}`)
    expect(failures).toContain('apps/cli/config/extra.cordis.yml')
  })

  it.each([false, true])('rejects a declared config tree without composition files when its directory exists: %s', (existing) => {
    const root = fixture()
    manifest(root, 'apps/cli/package.json', { dsh: { configTrees: [{ path: './config' }] } })
    if (existing) write(root, 'apps/cli/config/README.i18n.yaml', 'en: test\n')

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain('apps/cli/config')
  })

  it('does not classify ordinary YAML as a Cordis config because of an ancestor directory name', () => {
    const root = fixture()
    write(root, 'packages/core/core/src/cordis/index.ts', "new URL('./ordinary.yml', import.meta.url)\n")
    write(root, 'packages/core/core/src/cordis/ordinary.yml', 'ordinary: data\n')

    expect(verifyDefaultProductIsolation(root).failures).toEqual([])
  })

  it('checks desktop configuration reached through a source URL', () => {
    const root = fixture()
    write(root, 'apps/desktop-host/package.json', { name: '@fixture/desktop-host', private: true })
    write(root, 'apps/desktop-host/src/index.ts', "new URL('../config/desktop.cordis.patch.yml', import.meta.url)")
    write(root, 'apps/desktop-host/config/desktop.cordis.patch.yml', [{ insert: [{ name: experimental }] }])

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('checks installation-owned profile tuples as well as new-profile defaults', () => {
    const root = fixture()
    const source = readFileSync(join(root, profile), 'utf8')
    write(root, profile, `${source}\nconst INSTALLATION_OWNED_PROFILE_TUPLES = { headless: ['${experimental}'] }\n`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it('checks inline modules alongside the default Web script', () => {
    const root = fixture()
    write(root, 'apps/web/index.html', '<script type="module" src="/src/main.ts"></script>'
      + `<script type="module">import '${experimental}'</script>`)

    expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain(experimental)
  })

  it.each(['apps/cli/package.json', 'apps/web/index.html', 'python/sdk-runtime/package.json', preset])(
    'fails closed when required input %s is missing',
    (path) => {
      const root = fixture()
      rmSync(join(root, path))
      expect(verifyDefaultProductIsolation(root).failures.length).toBeGreaterThan(0)
    },
  )

  it.each([
    '',
    'export const PROFILE_TEMPLATES = {}; export const DEFAULT_PROFILE_BUNDLES = []',
    'export const PROFILE_TEMPLATES = computedProfiles(); export const DEFAULT_PROFILE_BUNDLES = []',
  ])('rejects absent, empty, or uninspectable default profile definitions', (source) => {
    const root = fixture()
    write(root, profile, source)
    expect(() => verifyDefaultProductIsolation(root)).toThrow('profile')
  })
})
