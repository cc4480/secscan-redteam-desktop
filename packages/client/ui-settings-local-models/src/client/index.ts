/**
 * Local models settings section, browser half: registers the Local models
 * page into the Settings shell and binds its reads and actions to the
 * Host's `localModels` Remote namespace. The section renders endpoint
 * status, served models, and on-disk model files; the registered wrapper
 * (see `./ModelActions.tsx`) provides the per-model lifecycle actions
 * through the section's prop seam, wired to the same namespace.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section'
// entry). Cross-plugin collaboration goes through slots, never a value
// import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge, including the `localModels`
// namespace this section reads.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { LocalModelsSectionWithActions } from './ModelActions.tsx'
import type { LocalModelsSectionInjected } from './LocalModelsSection.tsx'
import { en, zh, type LocalModelsLocaleKey } from './locales.ts'

export type { LocalModelsSectionInjected, LocalModelsSectionProps } from './LocalModelsSection.tsx'
export type { LocalModelsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Local models section copy. */
    'settings.localModels': LocalModelsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.localModels'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.localModels']

/**
 * Mount the local models section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-local-models: section dictionaries')

  // The RemoteResult unwrap lives here, in the apply world: the section
  // receives plain promises and renders a rejection as its error state
  // (the plugin-inventory `list` seam is the precedent). Every face
  // member — the status read and the lifecycle actions alike — unwraps
  // the same way, so a Host failure reaches the row as an honest error.
  const unwrap = async <T,>(label: string, call: () => Promise<RemoteResult<T>>): Promise<T> => {
    const result = await call()
    if (!result.ok) {
      throw new Error(`localModels.${label} failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): LocalModelsSectionInjected => ({
    loadStatus: () => unwrap('status', () => ctx.remote.localModels.status()),
    startModel: modelId => unwrap('startModel', () => ctx.remote.localModels.startModel(modelId)),
    stopModel: modelId => unwrap('stopModel', () => ctx.remote.localModels.stopModel(modelId)),
    deleteModel: modelId => unwrap('deleteModel', () => ctx.remote.localModels.deleteModel(modelId)),
    startPull: modelId => unwrap('startPull', () => ctx.remote.localModels.startPull(modelId)),
    pullStatus: jobId => unwrap('pullStatus', () => ctx.remote.localModels.pullStatus(jobId)),
    listRepoFiles: repo => unwrap('listRepoFiles', () => ctx.remote.localModels.listRepoFiles(repo)),
    getModelContext: modelId => unwrap('modelContext', () => ctx.remote.localModels.modelContext(modelId)),
    setModelContext: (modelId, contextLength) => unwrap(
      'setModelContext',
      () => ctx.remote.localModels.setModelContext(modelId, contextLength),
    ),
    clearModelContext: modelId => unwrap('clearModelContext', () => ctx.remote.localModels.clearModelContext(modelId)),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'local-models',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, LocalModelsSectionWithActions))
}
