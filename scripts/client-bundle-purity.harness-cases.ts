/**
 * Preset configuration, plugin lookups, and package fixtures shared by the
 * client-bundle purity cases.
 */

import { fileURLToPath } from 'node:url'
import { clientBundle } from '../packages/client/tsdown.client.ts'

/** Resolves one bare specifier the way the purity gate plugin does. */
export type ResolveId = (source: string) => null | { id: string; external: boolean }

/** The inline CSS Modules plugin surface the watch-graph case drives. */
export interface CssModulePlugin {
  name: string
  resolveId?: (source: string, importer: string | undefined) => null | string
  load?: (this: { addWatchFile: (id: string) => void }, id: string) => Promise<unknown>
}

/** The tsc source-map plugin surface the map-chaining case drives. */
export interface SourceMapPlugin {
  name: string
  load?: (id: string) => Promise<unknown>
}

/** The input-isolation plugin surface the module-record cases drive. */
export interface InputIsolationPlugin {
  name: string
  generateBundle: (this: {
    getModuleInfo(id: string): { importedIds: string[]; dynamicallyImportedIds: string[] } | null
  }, options: unknown, bundle: Record<string, {
      type: 'chunk'
      modules: Record<string, object>
      imports: string[]
      dynamicImports: string[]
    }>) => void
}

/** A representative dynamic bundle using the shared client baseline. */
export const REQUESTING_PACKAGE = '@deepseek-ai/dsh-client-ui-conversation'

/** Browser configs for a Client build of one requesting package. */
export function clientConfigs(id = REQUESTING_PACKAGE) {
  return clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'])(
    { env: { DSH_BUILD_FACE: 'client' } },
  ).filter(config => config.platform === 'browser')
}

/** Absolute path of one package's emitted Client source map. */
export function clientSourceMapPath(packagePath: string): string {
  return fileURLToPath(new URL(`../packages/${packagePath}/lib/client.js.map`, import.meta.url))
}

/** The purity gate's `resolveId`, read off the shared Client config. */
export function purityResolveId(id = REQUESTING_PACKAGE): ResolveId {
  // libEntry is spelled at every call site (no default) so the
  // package-invariants text check can see the invariant entry per package.
  const configs = clientConfigs(id)
  const plugins = (configs[0] as { plugins: { name: string; resolveId?: unknown }[] }).plugins
  const gate = plugins.find(p => p.name === 'dsh-client-bundle-purity')
  if (gate?.resolveId === undefined) throw new Error('purity plugin missing from client config')
  return gate.resolveId as ResolveId
}

/** The inline CSS Modules plugin, read off the shared Client config. */
export function cssModulePlugin(): CssModulePlugin {
  const configs = clientConfigs()
  const plugins = (configs[0] as { plugins: CssModulePlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === 'dsh-css-modules-inline')
  if (plugin?.resolveId === undefined || plugin.load === undefined) {
    throw new Error('CSS Modules plugin missing from client config')
  }
  return plugin
}

/** The tsc source-map plugin, read off the shared Client config. */
export function sourceMapPlugin(): SourceMapPlugin {
  const configs = clientConfigs()
  const plugins = (configs[0] as { plugins: SourceMapPlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === 'dsh-tsc-sourcemap')
  if (plugin?.load === undefined) throw new Error('tsc sourcemap plugin missing from client config')
  return plugin
}
