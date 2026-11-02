/**
 * The local-model plugin: seats the desktop's downloaded GGUF models in
 * the harness LLM registry as the `local` provider, the way
 * `@deepseek-ai/dsh-llm-deepseek` seats its provider — construct an
 * adapter, register it with `ctx.llm`, and let the Host model catalog and
 * session routing treat it like every other provider.
 *
 * The catalog half needs no server state: a registry model is listed
 * because it exists on disk. The dispatch half is gated by the published
 * server state inside the adapter (see `./adapter.ts`), because the
 * bundled llama-server is owned by the desktop's llama service and the
 * Host cannot start it; a stopped server surfaces one honest start
 * action, never a silent dead route.
 *
 * A watcher on the models directory re-announces the registration when
 * the registry, settings, or server state change (an adapter `replace`
 * publishes `llm/adapters-updated`), so a model downloaded or a server
 * started after the Host booted appears in an already-open picker (the
 * model-selection directory refreshes on that event).
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LocalLlamaAdapter, LOCAL_PROVIDER_ID } from './adapter.ts'
import { watchLocalModelsDirectory } from './state.ts'

export * from './adapter.ts'
export * from './state.ts'

/** Desugared plugin name. */
export const name = 'llm-local'

/** Services this plugin depends on. */
export const inject = ['llm']

/** Local-model plugin configuration. */
export interface Config {
  /**
   * Explicit models directory. Deployment-varying: the desktop writes its
   * models and state documents there. When unset, the directory resolves
   * from `DSH_LOCAL_MODELS_DIR`, then the platform default
   * (`%LOCALAPPDATA%\SecScan Red Team\models` on Windows,
   * `~/.secscan-redteam/models` elsewhere) — the same resolution the
   * desktop and the runner use.
   */
  modelsDir?: string
}

/** Local-model plugin configuration schema. */
export const Config: z<Config> = z.object({
  modelsDir: z.string(),
})

/**
 * Apply the local-model plugin: register the adapter for the `local`
 * route and watch the models directory for catalog-affecting changes.
 * Disposing the plugin disposes both.
 * @param ctx - the composition context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const adapter = new LocalLlamaAdapter(config.modelsDir === undefined ? {} : { modelsDir: config.modelsDir })
  const registration = ctx.llm.registerAdapter([LOCAL_PROVIDER_ID], adapter)

  ctx.effect(function* () {
    const disposeWatch = watchLocalModelsDirectory(adapter.modelsDirectory(), () => {
      // A changed registry, settings document, or server state can change
      // what the catalog lists. Replacing the registration's routes with
      // the same set re-announces the topology through the runtime's own
      // contained emitter; the client directory refreshes from that event.
      try {
        registration.replace([LOCAL_PROVIDER_ID])
      } catch {
        // The watcher can fire while the fiber is disposing, after the
        // registration has been released; there is nothing left to refresh.
      }
    })
    yield () => {
      disposeWatch()
    }
  }, 'llm-local:watch-models-directory')
}
