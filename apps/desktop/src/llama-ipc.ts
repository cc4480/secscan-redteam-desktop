/**
 * The local-model service and its IPC surface.
 *
 * Composes the model store, the Hugging Face downloader, the persisted settings and
 * the llama-server supervisor into the single LlamaOperations object the manager
 * window talks to, then registers that object on the private channels.
 *
 * Everything is injected: the four modules (production passes
 * {@link defaultLlamaServiceDeps} plus the supervisor the shell built), the windows
 * the event channels reach, and the ipcMain-shaped handler sink. A test therefore
 * runs the whole service with fakes: no child process, no network, no Electron
 * window and no profile directory.
 *
 * Two behaviours live at this seam and nowhere else:
 *
 * - Cancellation: `downloadModel` keeps an `AbortController` per model id while the
 *   transfer runs and `cancelDownload` aborts exactly that one. Cancelling keeps the
 *   `.part` file, so a retry resumes where the cancelled transfer stopped.
 * - Consistency: a settings save that selects a different model than the running
 *   server serves, and a delete of the model the server is serving, both stop the
 *   running llama-server first. A model file held open by the server is not
 *   deletable on Windows, and a server started for the previous choice would
 *   otherwise keep answering for a model the operator has replaced.
 */

import { extname, join } from 'node:path'
import {
  LLAMA_IPC,
  type LlamaDownloadProgress,
  type LlamaModel,
  type LlamaOperations,
  type LlamaRepoFile,
  type LlamaServerState,
  type LlamaSettings,
} from './llama-api.ts'
import {
  DownloadCancelledError,
  downloadFile,
  listRepoFiles,
  resolveFileUrl,
  type DownloadFileOptions,
  type DownloadFileResult,
  type ListRepoFilesOptions,
  type ResolveFileUrlOptions,
} from './llama-hf.ts'
import {
  deleteModel,
  deriveModelId,
  listModels,
  parseModelMetadata,
  registerModel,
  resolveModelsDirectory,
  type LlamaModelMetadata,
  type ModelIdInput,
} from './llama-models.ts'
import { readSettings, writeSettings } from './llama-settings.ts'
import type { LlamaServerStartInput } from './llama-server.ts'

/** Prefix every operator-facing failure this module raises carries. */
const PREFIX = 'desktop llama:'

/** Longest accepted renderer-supplied identifier; a model id, repo or file name is far shorter. */
const MAX_INPUT_CHARS = 1024

/** The manager renderer document, relative to the application directory. */
const MANAGER_DOCUMENT = 'renderer/llama.html'

/** Extension used for a downloaded file whose Hub name carries none. */
const DEFAULT_MODEL_EXTENSION = '.gguf'

/** The supervisor surface the service reads; the `LlamaServer` class satisfies it. */
export interface LlamaServerSupervisor {
  /** Observable state right now, read on every `getServerState` and consistency check. */
  readonly state: LlamaServerState
  /** Starts (or joins) the one supervised child. */
  start(input: LlamaServerStartInput): Promise<LlamaServerState>
  /** Stops the child and always resolves. */
  stop(): Promise<LlamaServerState>
  /** Observes every state transition; returns a disposer. */
  onState(listener: (state: LlamaServerState) => void): () => void
}

/** The modules the service reads; tests pass fakes with the same surface. */
export interface LlamaServiceDeps {
  readonly models: {
    readonly listModels: (environment?: NodeJS.ProcessEnv) => Promise<LlamaModel[]>
    readonly registerModel: (model: LlamaModel, environment?: NodeJS.ProcessEnv) => Promise<LlamaModel>
    readonly deleteModel: (id: string, environment?: NodeJS.ProcessEnv) => Promise<void>
    readonly deriveModelId: (input: ModelIdInput) => string
    readonly parseModelMetadata: (file: string) => LlamaModelMetadata
    readonly resolveModelsDirectory: (environment?: NodeJS.ProcessEnv) => string
  }
  readonly hf: {
    readonly listRepoFiles: (options: ListRepoFilesOptions) => Promise<LlamaRepoFile[]>
    readonly resolveFileUrl: (options: ResolveFileUrlOptions) => string
    readonly downloadFile: (options: DownloadFileOptions) => Promise<DownloadFileResult>
  }
  readonly settings: {
    readonly readSettings: (environment?: NodeJS.ProcessEnv) => LlamaSettings
    readonly writeSettings: (input: unknown, environment?: NodeJS.ProcessEnv) => LlamaSettings
  }
  readonly server: LlamaServerSupervisor
  /** Environment the composed modules resolve their directories from; defaults to `process.env`. */
  readonly environment?: NodeJS.ProcessEnv
  /** Clock behind `downloadedAt`; injectable so a test pins the timestamp. */
  readonly now?: () => number
}

/** The local-model service the IPC layer registers and the shell owns. */
export interface LlamaService extends LlamaOperations {
  /**
   * Detach the supervisor listener, forget every subscriber and abort the in-flight
   * downloads. The server itself is the caller's to stop; this releases only what
   * this service added.
   */
  dispose(): void
}

/** One live manager renderer the event channels are pushed to. */
export interface LlamaIpcWindow {
  /** Delivers one event-channel payload to that renderer. */
  readonly send: (channel: string, payload: unknown) => void
}

/** The IPC sink the shell backs with `ipcMain` and its manager windows; tests pass fakes. */
export interface LlamaIpcHost {
  /** Installs one invoke handler, exactly like `ipcMain.handle`. */
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void
  /** @returns the live manager renderers an event is broadcast to. */
  windows(): readonly LlamaIpcWindow[]
}

/** One invoke channel and the service call it performs after argument validation. */
interface InvokeRoute {
  readonly channel: string
  readonly dispatch: (service: LlamaService, args: readonly unknown[]) => Promise<unknown>
}

/** The invoked channels, in the contract's order; the two event channels are not handled. */
const INVOKE_ROUTES: readonly InvokeRoute[] = [
  { channel: LLAMA_IPC.listModels, dispatch: service => service.listModels() },
  {
    channel: LLAMA_IPC.listRepoFiles,
    dispatch: (service, [repo]) => service.listRepoFiles(requiredText(repo, 'repository')),
  },
  {
    channel: LLAMA_IPC.downloadModel,
    dispatch: (service, [input]) => service.downloadModel(downloadRequest(input)),
  },
  {
    channel: LLAMA_IPC.cancelDownload,
    dispatch: (service, [id]) => service.cancelDownload(requiredText(id, 'model id')),
  },
  {
    channel: LLAMA_IPC.deleteModel,
    dispatch: (service, [id]) => service.deleteModel(requiredText(id, 'model id')),
  },
  { channel: LLAMA_IPC.getSettings, dispatch: service => service.getSettings() },
  {
    channel: LLAMA_IPC.saveSettings,
    dispatch: (service, [input]) => service.saveSettings(settingsRequest(input)),
  },
  { channel: LLAMA_IPC.getServerState, dispatch: service => service.getServerState() },
  { channel: LLAMA_IPC.startServer, dispatch: service => service.startServer() },
  { channel: LLAMA_IPC.stopServer, dispatch: service => service.stopServer() },
]

/** The real module bundle the shell composes with its own supervisor. */
export const defaultLlamaServiceDeps = {
  models: { listModels, registerModel, deleteModel, deriveModelId, parseModelMetadata, resolveModelsDirectory },
  hf: { listRepoFiles, resolveFileUrl, downloadFile },
  settings: { readSettings, writeSettings },
} as const

/** @returns the message of an unknown failure, for a log line or an event payload. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the LlamaOperations implementation.
 *
 * Progress is forwarded as it lands: one `downloading` event when the transfer starts,
 * every throttled Hugging Face progress callback, one `verifying` event before
 * registration, and a final `done`, `cancelled` or `error`. Every supervisor state
 * transition is forwarded as it happens, so a subscriber that attaches after a
 * transition still reads the current state through `getServerState`.
 * @param deps - module surfaces, the supervisor and the test seams.
 * @returns the service plus a disposer for the listeners it added.
 */
export function createLlamaService(deps: LlamaServiceDeps): LlamaService {
  const environment = deps.environment ?? process.env
  const now = deps.now ?? Date.now
  const progressListeners = new Set<(progress: LlamaDownloadProgress) => void>()
  const stateListeners = new Set<(state: LlamaServerState) => void>()
  /** Abort handle of each in-flight download, keyed by the model id it will register. */
  const controllers = new Map<string, AbortController>()

  const emitProgress = (progress: LlamaDownloadProgress): void => {
    for (const listener of [...progressListeners]) {
      try {
        listener(progress)
      } catch (error) {
        console.error(`${PREFIX} a download progress listener failed: ${messageOf(error)}`)
      }
    }
  }

  const emitState = (state: LlamaServerState): void => {
    for (const listener of [...stateListeners]) {
      try {
        listener(state)
      } catch (error) {
        console.error(`${PREFIX} a server state listener failed: ${messageOf(error)}`)
      }
    }
  }

  // One forwarding subscription for the service's lifetime. Disposing the service
  // detaches it, so a shell that tears the feature down leaves no listener behind.
  const detachServer = deps.server.onState((state) => { emitState(state) })

  const currentSettings = (): LlamaSettings => deps.settings.readSettings(environment)

  /** @returns the downloaded GGUF the active-model selection points at, or a clear refusal. */
  const requireActiveModel = async (): Promise<LlamaModel> => {
    const modelId = currentSettings().activeModelId
    if (modelId === null) {
      throw new Error(
        `${PREFIX} no model is selected; choose a model on the Local models page before starting the server`,
      )
    }
    const installed = await deps.models.listModels(environment)
    const model = installed.find(entry => entry.id === modelId)
    if (model === undefined) {
      throw new Error(
        `${PREFIX} the selected model ${modelId} is no longer installed; choose another model before starting the server`,
      )
    }
    return model
  }

  const startServer = async (): Promise<LlamaServerState> => {
    const values = currentSettings()
    const model = await requireActiveModel()
    return deps.server.start({
      modelPath: model.path,
      modelId: model.id,
      contextLength: values.contextLength,
      threads: values.threads,
    })
  }

  const stopServer = (): Promise<LlamaServerState> => deps.server.stop()

  const saveSettings = async (input: LlamaSettings): Promise<LlamaSettings> => {
    const saved = deps.settings.writeSettings(input, environment)
    const bound = deps.server.state
    // A server bound to the model the operator just replaced would keep answering for
    // it, so it is stopped: switching models is an explicit stop followed by a start.
    if (bound.status !== 'stopped' && bound.modelId !== undefined && bound.modelId !== saved.activeModelId) {
      await deps.server.stop()
    }
    return saved
  }

  const deleteModelById = async (id: string): Promise<void> => {
    const bound = deps.server.state
    // Windows cannot remove a file the running server holds open.
    if (bound.status !== 'stopped' && bound.modelId === id) await deps.server.stop()
    await deps.models.deleteModel(id, environment)
  }

  const cancelDownload = (id: string): Promise<void> => {
    // Unknown ids are a no-op so a UI retry of a finished download stays harmless.
    controllers.get(id)?.abort()
    return Promise.resolve()
  }

  const downloadModel = async (input: { repo: string; file: string }): Promise<LlamaModel> => {
    const id = deps.models.deriveModelId({ repo: input.repo, file: input.file })
    if (controllers.has(id)) throw new Error(`${PREFIX} a download for ${id} is already in progress`)
    // The id is an identifier-safe stem, and the destination repeats it so two repos
    // that ship a file with the same name cannot overwrite each other.
    const extension = extname(input.file) || DEFAULT_MODEL_EXTENSION
    const destination = join(deps.models.resolveModelsDirectory(environment), `${id}${extension}`)
    const controller = new AbortController()
    controllers.set(id, controller)
    let lastProgress: { receivedBytes: number; totalBytes?: number } = { receivedBytes: 0 }
    try {
      const token = currentSettings().huggingFaceToken
      emitProgress({ id, phase: 'downloading', ...lastProgress })
      const result = await deps.hf.downloadFile({
        url: deps.hf.resolveFileUrl({ repo: input.repo, file: input.file }),
        destination,
        signal: controller.signal,
        onProgress: (progress) => {
          lastProgress = progress.totalBytes === undefined
            ? { receivedBytes: progress.receivedBytes }
            : { receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes }
          emitProgress({ id, phase: 'downloading', ...lastProgress })
        },
        ...token === undefined ? {} : { token },
      })
      emitProgress({ id, phase: 'verifying', receivedBytes: result.sizeBytes, totalBytes: result.sizeBytes })
      const metadata = deps.models.parseModelMetadata(input.file)
      const model: LlamaModel = {
        id,
        repo: input.repo,
        file: input.file,
        path: destination,
        sizeBytes: result.sizeBytes,
        downloadedAt: now(),
        ...metadata.quantization === undefined ? {} : { quantization: metadata.quantization },
        ...metadata.parameterSize === undefined ? {} : { parameterSize: metadata.parameterSize },
      }
      const registered = await deps.models.registerModel(model, environment)
      emitProgress({ id, phase: 'done', receivedBytes: result.sizeBytes, totalBytes: result.sizeBytes })
      return registered
    } catch (error) {
      if (controller.signal.aborted || error instanceof DownloadCancelledError) {
        emitProgress({ id, phase: 'cancelled', ...lastProgress })
        throw error instanceof Error ? error : new DownloadCancelledError()
      }
      emitProgress({ id, phase: 'error', error: messageOf(error), ...lastProgress })
      throw error
    } finally {
      if (controllers.get(id) === controller) controllers.delete(id)
    }
  }

  const loadRepoFiles = async (repo: string): Promise<LlamaRepoFile[]> => {
    const token = currentSettings().huggingFaceToken
    const files = await deps.hf.listRepoFiles({ repo, ...token === undefined ? {} : { token } })
    // The manager offers GGUF files only; the client reports the flag for every sibling.
    return files.filter(file => file.isGguf)
  }

  return {
    listModels: () => deps.models.listModels(environment),
    listRepoFiles: loadRepoFiles,
    downloadModel,
    cancelDownload,
    deleteModel: deleteModelById,
    getSettings: () => Promise.resolve(currentSettings()),
    saveSettings,
    getServerState: () => Promise.resolve(deps.server.state),
    startServer,
    stopServer,
    onDownloadProgress: (listener) => {
      progressListeners.add(listener)
      return () => { progressListeners.delete(listener) }
    },
    onServerState: (listener) => {
      stateListeners.add(listener)
      return () => { stateListeners.delete(listener) }
    },
    dispose: () => {
      detachServer()
      progressListeners.clear()
      stateListeners.clear()
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    },
  }
}

/**
 * @param url - a renderer document URL.
 * @returns whether it is the manager window's document.
 */
function isManagerDocument(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' && parsed.pathname.replace(/\\/gu, '/').endsWith(`/${MANAGER_DOCUMENT}`)
  } catch {
    // A frame without a parseable URL owns no channel.
    return false
  }
}

/**
 * Read the document URL of the top frame that issued an IPC call.
 *
 * A subframe is refused outright: the preload bridge lives in the manager document's
 * top frame, so a frame with a parent is not the single renderer this surface serves.
 * @param event - the handler's first argument, an `IpcMainInvokeEvent` in production.
 * @returns the frame URL, or `undefined` when the caller is not a top frame.
 */
function senderFrameUrl(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const frame = (event as { senderFrame?: unknown }).senderFrame
  if (typeof frame !== 'object' || frame === null) return undefined
  const candidate = frame as { url?: unknown; parent?: unknown }
  if (candidate.parent !== null && candidate.parent !== undefined) return undefined
  return typeof candidate.url === 'string' ? candidate.url : undefined
}

/**
 * @param value - a renderer-supplied value.
 * @param label - what the value names, for the failure message.
 * @returns the value when it is a non-empty string of a sane length.
 * @throws Error naming the field; the rejected text is not echoed.
 */
function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${PREFIX} the ${label} must be a non-empty string`)
  }
  if (value.length > MAX_INPUT_CHARS) throw new Error(`${PREFIX} the ${label} is too long`)
  return value
}

/**
 * Validate one `downloadModel` IPC payload.
 * @param value - the renderer-supplied request.
 * @returns repository and file path.
 * @throws Error when the request is not an object carrying both strings.
 */
function downloadRequest(value: unknown): { repo: string; file: string } {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${PREFIX} the download request must be an object`)
  }
  const record = value as Readonly<Record<string, unknown>>
  return {
    repo: requiredText(record['repo'], 'repository'),
    file: requiredText(record['file'], 'file name'),
  }
}

/**
 * Validate one `saveSettings` IPC payload. The settings module normalizes every field,
 * so only the container shape is checked here.
 * @param value - the renderer-supplied settings.
 * @returns the settings as the service consumes them.
 * @throws Error when the payload is not an object.
 */
function settingsRequest(value: unknown): LlamaSettings {
  if (typeof value !== 'object' || value === null) throw new Error(`${PREFIX} the settings must be an object`)
  return value as LlamaSettings
}

/**
 * Install the manager window's private IPC surface over one composed service.
 *
 * Every invoke channel refuses a caller that is not the manager document's top frame
 * before dispatching, mirroring the welcome window's origin rule. The two event
 * channels are pushed to every live manager renderer as service events land, and are
 * never registered as handlers.
 * @param service - the composed operations.
 * @param host - the ipcMain-shaped sink and the live manager window list.
 * @returns a disposer that removes the two event subscriptions. Handlers stay with the
 * host; the shell registers them once for the application's lifetime.
 */
export function registerLlamaIpc(service: LlamaService, host: LlamaIpcHost): () => void {
  const owned = (event: unknown): void => {
    const url = senderFrameUrl(event)
    if (url === undefined || !isManagerDocument(url)) {
      throw new Error(`${PREFIX} rejected IPC from an unowned renderer`)
    }
  }

  for (const route of INVOKE_ROUTES) {
    host.handle(route.channel, async (event, ...args) => {
      owned(event)
      return route.dispatch(service, args)
    })
  }

  const send = (channel: string, payload: unknown): void => {
    for (const window of host.windows()) window.send(channel, payload)
  }
  const disposers = [
    service.onDownloadProgress((progress) => { send(LLAMA_IPC.downloadProgress, progress) }),
    service.onServerState((state) => { send(LLAMA_IPC.serverState, state) }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}
