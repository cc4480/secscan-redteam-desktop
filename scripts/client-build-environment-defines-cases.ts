/**
 * Bundler defines: the public-value filter `clientBuildEnvironmentDefines`
 * applies, and the same build-process value reaching both a dynamic tsdown
 * bundle and the Vite shell.
 */

import { describe, expect, it } from 'vitest'
import { clientBuildEnvironmentDefines } from './client-build-environment.ts'
import { PROBE_NAME } from './client-build-environment-harness-cases.ts'

const PROBE_KEY = `process.env.${PROBE_NAME}`

/** One tsdown browser config, as far as the define case inspects it. */
interface ClientBundleConfig {
  name?: string
  define?: Record<string, string>
}

/** The Client build preset surface the define case drives. */
interface TsdownClientModule {
  clientBundle(id: string, entries: readonly string[]): (options: { env: Record<string, string> }) => unknown
}

describe('client build environment', () => {
  it('defines only public client values over a non-enumerable fallback', () => {
    expect(clientBuildEnvironmentDefines({
      PATH: '/bin',
      DSH_TEST_API_KEY: 'secret',
      DSH_CLIENT_VARIANT: 'quoted "value"',
      DSH_CLIENT_EMPTY: '',
      DSH_CLIENT_UNSET: undefined,
    })).toEqual({
      'process.env': '{}',
      'process.env.DSH_CLIENT_EMPTY': '""',
      'process.env.DSH_CLIENT_VARIANT': '"quoted \\"value\\""',
    })
  })

  it('feeds the same build-process value to dynamic tsdown bundles and the Vite shell', async () => {
    process.env[PROBE_NAME] = 'shared-value'

    // The preset module belongs to the Client program alone, so the specifier
    // stays computed and the preset surface is narrowed here.
    const tsdownPath = '../packages/client/tsdown.client.ts'
    const tsdownModule = await import(tsdownPath) as TsdownClientModule
    const configs: unknown = tsdownModule.clientBundle('@deepseek-ai/dsh-client-ui-sidebar', [
      'lib/types/index.js',
      'lib/types/invariant.js',
    ])({ env: { DSH_BUILD_FACE: 'client' } })
    if (!Array.isArray(configs)) throw new TypeError('client bundle config must be an array')
    const dynamic = (configs as ClientBundleConfig[]).find(
      config => config.name === '@deepseek-ai/dsh-client-ui-sidebar/client',
    )
    expect(dynamic?.define).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })

    const viteConfigPath = '../apps/web/vite.config.ts'
    const viteModule: unknown = await import(viteConfigPath)
    if (typeof viteModule !== 'object' || viteModule === null) {
      throw new TypeError('web Vite config module must be an object')
    }
    const viteConfig: unknown = Reflect.get(viteModule, 'default')
    if (typeof viteConfig === 'function') throw new TypeError('web Vite config must be an object')
    if (typeof viteConfig !== 'object' || viteConfig === null) {
      throw new TypeError('web Vite config must be an object')
    }
    expect(Reflect.get(viteConfig, 'define')).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })
  })
})
