/**
 * The Ollama feature, joined to the running application.
 *
 * One {@link installOllamaShell} call composes the client, the service, the IPC
 * surface and the window, and owns the two facts the rest of the app needs:
 *
 * - The **fleet selection**, published through {@link publishOllamaSelection}:
 *   the provider record plus the runner environment (address, model, detected
 *   context window and output ceiling).
 * - The **persisted choice**, so a relaunch re-publishes the operator's model
 *   instead of silently reverting to the DeepSeek default.
 *
 * Unlike the local-model feature there is no child process: the daemon belongs to
 * the operator, and this shell only attaches to it.
 */

import { writeFleetProviderRecord } from '@secscan/redteam-llm-router'
import { createOllamaService, type OllamaService } from './ollama-service.ts'
import { registerOllamaIpc, type OllamaIpcWindow } from './ollama-ipc.ts'
import { openOllamaWindow, type OllamaWindowOptions } from './ollama-window.ts'
import {
  OLLAMA_API_KEY_ENV,
  OLLAMA_BASE_URL_ENV,
  deleteInstalled,
  listInstalled,
  probeDaemon,
  pullModel,
  showInstalled,
} from './ollama-client.ts'
import { PROVIDER_ENVIRONMENT_NAME, publishOllamaSelection } from './ollama-publish.ts'
import { readOllamaSelection, writeOllamaSelection } from './ollama-settings.ts'

export { publishOllamaSelection } from './ollama-publish.ts'

/** The shell surface `main.ts` keeps until quit. */
export interface OllamaShell {
  /**
   * Open the Ollama window.
   * @param options - test seams for the preload, document, visibility and palette.
   */
  openWindow(options?: OllamaWindowOptions): Promise<void>
  /** The composed service, for callers that need it directly (tests, IPC-free use). */
  readonly service: OllamaService
  /** Release the IPC subscription and abort in-flight pulls. */
  dispose(): void
}

/** The `ipcMain`-shaped sink the shell needs. */
export interface OllamaShellIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void
  removeHandler?(channel: string): void
}

/** Everything the shell needs from the host; production passes Electron's own surfaces. */
export interface OllamaShellOptions {
  /** Launch environment: the runner child inherits it, and it holds the Harness home override. */
  readonly environment: NodeJS.ProcessEnv
  /** The `ipcMain`-shaped sink. */
  readonly ipcMain: OllamaShellIpcMain
  /** The live renderers the progress event reaches. */
  readonly windows: () => readonly OllamaIpcWindow[]
  /** Test seam: opens the window; defaults to the real Electron window. */
  readonly openWindow?: (options?: OllamaWindowOptions) => Promise<unknown>
}

/**
 * Compose the Ollama feature into this process.
 * @param options - the launch environment, IPC sink, live windows and test seams.
 * @returns the shell surface `main.ts` keeps until quit.
 */
export function installOllamaShell(options: OllamaShellOptions): OllamaShell {
  const environment = options.environment
  const open = options.openWindow ?? openOllamaWindow
  const persisted = readOllamaSelection(environment)
  const token = environment[OLLAMA_API_KEY_ENV]?.trim()

  const service = createOllamaService({
    client: { probeDaemon, listInstalled, showInstalled, pullModel, deleteInstalled },
    connection: {
      baseUrl: persisted.baseUrl,
      ...token === undefined || token === '' ? {} : { token },
    },
    selection: {
      read: () => readOllamaSelection(environment),
      write: (selection) => { writeOllamaSelection({ ...selection }, environment) },
      publish: (selection, limits) => { publishOllamaSelection(environment, selection, limits) },
    },
  })

  const detachIpc = registerOllamaIpc(service, {
    handle: (channel, listener) => { options.ipcMain.handle(channel, listener) },
    windows: options.windows,
  })

  // Re-publish whatever the operator chose last time, so a relaunch keeps the
  // fleet routed to Ollama instead of silently falling back to DeepSeek.
  if (persisted.activeModel !== null) {
    environment[OLLAMA_BASE_URL_ENV] = persisted.baseUrl
    environment[PROVIDER_ENVIRONMENT_NAME] = 'ollama'
    writeFleetProviderRecord(environment, 'ollama')
  }

  return {
    service,
    openWindow: async (windowOptions = {}) => { await open(windowOptions) },
    dispose: () => {
      detachIpc()
      service.dispose()
    },
  }
}
