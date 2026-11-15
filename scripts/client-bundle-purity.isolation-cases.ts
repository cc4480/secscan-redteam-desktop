/**
 * The experimental input-isolation cases: module-record checks and bundles that
 * must reject experimental inputs and source maps.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { build, type TsdownBundle, type UserConfig } from 'tsdown'
import { describe, expect, it, onTestFinished } from 'vitest'
import { staticLinked } from '../packages/client/tsdown.client.ts'
import {
  clientConfigs,
  REQUESTING_PACKAGE,
  type InputIsolationPlugin,
} from './client-bundle-purity.harness-cases.ts'

describe('client bundle experimental input isolation', () => {
  const experimental = '@deepseek-ai/dsh-experimental-client-ui-agent-team'

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'dsh-client-inputs-'))
    onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
    const owner = join(root, 'client')
    const entry = join(owner, 'lib/types/client/index.js')
    const prototype = join(root, 'prototype/src/index.js')
    for (const file of [entry, prototype]) mkdirSync(dirname(file), { recursive: true })
    writeFileSync(join(owner, 'package.json'), JSON.stringify({ name: REQUESTING_PACKAGE, type: 'module' }))
    writeFileSync(join(root, 'prototype/package.json'), JSON.stringify({ name: experimental, type: 'module' }))
    writeFileSync(prototype, 'export const marker = "experimental sentinel"\n')
    return { root, owner, entry, prototype }
  }

  function config(kind: 'static' | 'dynamic', id = REQUESTING_PACKAGE): UserConfig {
    const configs = kind === 'static'
      ? staticLinked(id, ['lib/types/client/index.js'])({ env: { DSH_BUILD_FACE: 'client' } })
      : clientConfigs(id)
    const browser = configs.find(config => config.platform === 'browser')
    if (browser === undefined) throw new Error('client config missing')
    return browser
  }

  async function bundle(owner: string, config: UserConfig): Promise<string> {
    let builds: TsdownBundle[] = []
    try {
      builds = await build({
        ...config, cwd: owner, config: false, tsconfig: false,
        write: false, clean: false, exports: false, report: false, logLevel: 'silent',
      })
      return builds.flatMap(build => build.chunks.filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code)).join('\n')
    } finally {
      for (const build of builds) await build[Symbol.asyncDispose]()
    }
  }

  function importPath(from: string, to: string): string {
    return relative(dirname(from), to).replaceAll('\\', '/')
  }

  function checkCompilerModule(module: string, imports?: string[]): void {
    const plugins = config('dynamic').plugins as InputIsolationPlugin[]
    const plugin = plugins.find(plugin => plugin.name === 'dsh-client-input-isolation')
    if (plugin === undefined) throw new Error('client input isolation plugin missing')
    plugin.generateBundle.call({
      getModuleInfo: () => imports === undefined ? null : { importedIds: imports, dynamicallyImportedIds: [] },
    }, {}, {
      'client.js': { type: 'chunk', modules: { [module]: {} }, imports: [], dynamicImports: [] },
    })
  }

  it('accepts the exact compiler runtime helper without a source module record', () => {
    expect(() => { checkCompilerModule('\0rolldown/runtime.js') }).not.toThrow()
  })

  it.each(['\0rolldown/other.js', '\0rolldown/runtime.js?user', '\0other/runtime.js'])(
    'rejects the unrecorded module %j',
    (module) => {
      expect(() => { checkCompilerModule(module) }).toThrow(/has no bundler module record/)
    },
  )

  it('checks runtime helper dependencies when the compiler supplies a module record', () => {
    expect(() => { checkCompilerModule('\0rolldown/runtime.js', [experimental]) })
      .toThrow(/client bundle isolation.*experimental/)
  })

  it.each(['static', 'dynamic'] as const)('rejects experimental files folded into a %s client artifact', async (kind) => {
    const { owner, entry, prototype } = fixture()
    writeFileSync(entry, `export { marker } from ${JSON.stringify(importPath(entry, prototype))}\n`)

    await expect(bundle(owner, config(kind))).rejects.toThrow(/client bundle isolation.*experimental/)
    expect(existsSync(join(owner, 'lib/client.js'))).toBe(false)
    expect(existsSync(join(owner, 'lib/index.js'))).toBe(false)
  })

  it('proves the static library otherwise hides the experimental input in its emitted JavaScript', async () => {
    const { owner, entry, prototype } = fixture()
    writeFileSync(entry, `export { marker } from ${JSON.stringify(importPath(entry, prototype))}\n`)
    const guarded = config('static')
    const plugins = guarded.plugins as Array<{ name: string }>
    const unguarded: UserConfig = {
      ...guarded,
      plugins: plugins.filter(plugin => plugin.name !== 'dsh-client-input-isolation'),
      outputOptions: { sourcemapExcludeSources: false },
    }

    await expect(bundle(owner, unguarded)).resolves.toContain('experimental sentinel')
    await expect(bundle(owner, guarded)).rejects.toThrow(/client bundle isolation.*experimental/)
  })

  it.each(['static', 'dynamic'] as const)('allows an experimental %s artifact to keep its own inputs', async (kind) => {
    const { owner, entry, prototype } = fixture()
    writeFileSync(entry, `export { marker } from ${JSON.stringify(importPath(entry, prototype))}\n`)

    await expect(bundle(owner, config(kind, experimental))).resolves.toContain('experimental sentinel')
  })

  it('rejects experimental ownership preserved only by an emitted compiler source map', async () => {
    const { owner, entry, prototype } = fixture()
    writeFileSync(entry, 'export const marker = "experimental sentinel"\n//# sourceMappingURL=index.js.map\n')
    writeFileSync(`${entry}.map`, JSON.stringify({
      version: 3, names: [], mappings: 'AAAA', sources: [importPath(entry, prototype)],
      sourcesContent: ['export const marker = "experimental sentinel"\n'],
    }))

    await expect(bundle(owner, config('static'))).rejects.toThrow(/client bundle isolation.*experimental/)
  })

  it('checks the resolved module when an import alias conceals its experimental package', async () => {
    const { owner, entry, prototype } = fixture()
    writeFileSync(entry, 'export { marker } from "./ordinary.js"\n')

    await expect(bundle(owner, { ...config('static'), alias: { './ordinary.js': prototype } }))
      .rejects.toThrow(/client bundle isolation.*experimental/)
  })

  it('rejects an experimental runtime import left external by a static client library', async () => {
    const { owner, entry } = fixture()
    writeFileSync(entry, `export * from ${JSON.stringify(experimental)}\n`)

    await expect(bundle(owner, config('static'))).rejects.toThrow(/client bundle isolation.*experimental/)
  })

  it.each([false, true])('checks omitted source-map files against their package owner (experimental: %s)', async (experimentalSource) => {
    const { root, owner, entry } = fixture()
    const dependency = join(root, 'dependency')
    mkdirSync(dependency)
    writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: experimentalSource ? experimental : 'ordinary-library' }))
    writeFileSync(entry, 'export const marker = "mapped sentinel"\n//# sourceMappingURL=index.js.map\n')
    writeFileSync(`${entry}.map`, JSON.stringify({
      version: 3, names: [], mappings: 'AAAA', sourceRoot: importPath(entry, dependency),
      sources: ['unshipped.ts'], sourcesContent: ['export const marker = "mapped sentinel"\n'],
    }))

    const result = bundle(owner, config('static'))
    if (experimentalSource) await expect(result).rejects.toThrow(/client bundle isolation.*experimental/)
    else await expect(result).resolves.toContain('mapped sentinel')
  })

  it.each(['.css', '.module.css', '.css?inline'])('rejects experimental %s inputs behind client CSS virtual loaders', async (extension) => {
    const { owner, entry, prototype } = fixture()
    const css = join(dirname(prototype), `style${extension.replace('?inline', '')}`)
    writeFileSync(css, 'body { color: red; }\n')
    const specifier = `${importPath(entry, css)}${extension.endsWith('?inline') ? '?inline' : ''}`
    writeFileSync(entry, extension === '.css'
      ? `import ${JSON.stringify(specifier)}\nexport const marker = true\n`
      : `export { default as style } from ${JSON.stringify(specifier)}\n`)

    await expect(bundle(owner, config('dynamic'))).rejects.toThrow(/client bundle isolation.*experimental/)
  })

  it.each(['static', 'dynamic'] as const)('keeps ordinary %s bundles and source maps buildable', async (kind) => {
    const { owner, entry } = fixture()
    const source = join(owner, 'src/client/index.ts')
    mkdirSync(dirname(source), { recursive: true })
    writeFileSync(source, 'export const marker = "stable sentinel"\n')
    writeFileSync(entry, 'export const marker = "stable sentinel"\n//# sourceMappingURL=index.js.map\n')
    writeFileSync(`${entry}.map`, JSON.stringify({
      version: 3, names: [], mappings: 'AAAA', sources: [importPath(entry, source)],
      sourcesContent: ['export const marker = "stable sentinel"\n'],
    }))

    await expect(bundle(owner, config(kind))).resolves.toContain('stable sentinel')
  })
})
