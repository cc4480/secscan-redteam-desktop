/**
 * The local-model service and its IPC surface: each channel's dispatch, the
 * argument and sender-origin rules, cancellation of exactly one in-flight download,
 * the supervisor consistency rules, the event broadcast to live manager windows, and
 * what disposal releases.
 *
 * No child process, no network and no Electron window: the four modules, the
 * supervisor and the ipcMain-shaped host are fakes.
 */

import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LLAMA_IPC,
  type LlamaDownloadProgress,
  type LlamaModel,
  type LlamaServerState,
  type LlamaSettings,
} from '../src/llama-api.ts'
import type { DownloadFileOptions } from '../src/llama-hf.ts'
import {
  createLlamaService,
  defaultLlamaServiceDeps,
  registerLlamaIpc,
  type LlamaIpcHost,
  type LlamaIpcWindow,
} from '../src/llama-ipc.ts'
import type { LlamaServerStartInput } from '../src/llama-server.ts'

/** The document URL the manager preload bridge is installed in; the only accepted caller. */
const MANAGER_URL = 'file:///desktop-app/renderer/llama.html'

/** The environment the composed modules are handed; asserted through the fakes. */
const ENVIRONMENT: NodeJS.ProcessEnv = { DSH_LOCAL_MODELS_DIR: '/models' }

/** One installed model the fakes return. */
const installed: LlamaModel = {
  id: 'owner--repo--qwen-q4-k-m',
  repo: 'owner/repo',
  file: 'Qwen.Q4_K_M.gguf',
  path: '/models/owner--repo--qwen-q4-k-m.gguf',
  sizeBytes: 1024,
  downloadedAt: 1,
  quantization: 'Q4_K_M',
}

/** Settings with the model above selected. */
const defaults: LlamaSettings = {
  activeModelId: installed.id,
  contextLength: 32768,
  threads: 8,
  startOnLaunch: false,
}

/** The persisted-settings fake; `set` seeds what the next read returns. */
function fakeSettings(initial: LlamaSettings = defaults) {
  let current: LlamaSettings = initial
  return {
    readSettings: vi.fn((_environment?: NodeJS.ProcessEnv) => current),
    writeSettings: vi.fn((input: unknown, _environment?: NodeJS.ProcessEnv) => {
      current = input as LlamaSettings
      return current
    }),
    set(next: LlamaSettings): void { current = next },
    get current(): LlamaSettings { return current },
  }
}

/** The supervisor fake: records calls and emits transitions through its own listener set. */
function fakeServer(initial: LlamaServerState = { status: 'stopped' }) {
  const listeners = new Set<(state: LlamaServerState) => void>()
  let current: LlamaServerState = initial
  const emit = (next: LlamaServerState): void => {
    current = next
    for (const listener of [...listeners]) listener(next)
  }
  return {
    get state(): LlamaServerState { return current },
    start: vi.fn(async (input: LlamaServerStartInput): Promise<LlamaServerState> => {
      emit({ status: 'running', baseUrl: 'http://127.0.0.1:9000/v1', port: 9000, modelId: input.modelId })
      return current
    }),
    stop: vi.fn(async (): Promise<LlamaServerState> => {
      emit({ status: 'stopped' })
      return current
    }),
    onState: vi.fn((listener: (state: LlamaServerState) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
    emit,
    listenerCount: (): number => listeners.size,
  }
}

/** The model-store fake. */
function fakeModels() {
  return {
    listModels: vi.fn(async (_environment?: NodeJS.ProcessEnv): Promise<LlamaModel[]> => [installed]),
    registerModel: vi.fn(async (model: LlamaModel, _environment?: NodeJS.ProcessEnv) => model),
    deleteModel: vi.fn(async (_id: string, _environment?: NodeJS.ProcessEnv): Promise<void> => undefined),
    deriveModelId: vi.fn((_input: { repo: string; file: string }): string => installed.id),
    parseModelMetadata: vi.fn((_file: string) => ({ quantization: 'Q4_K_M' })),
    resolveModelsDirectory: vi.fn((_environment?: NodeJS.ProcessEnv): string => '/models'),
  }
}

/** The Hugging Face fake: a repo holds one GGUF and one plain file. */
function fakeHf() {
  return {
    listRepoFiles: vi.fn(async (_options: { repo: string; token?: string }) => [
      { file: 'Qwen.Q4_K_M.gguf', sizeBytes: 1024, isGguf: true },
      { file: 'README.md', isGguf: false },
    ]),
    resolveFileUrl: vi.fn((options: { repo: string; file: string }): string =>
      `https://huggingface.co/${options.repo}/resolve/main/${options.file}`),
    downloadFile: vi.fn(async (_options: DownloadFileOptions): Promise<{ sizeBytes: number }> => ({ sizeBytes: 1024 })),
  }
}

/** A composed service whose four collaborators stay reachable for assertions. */
function harness(overrides: { server?: ReturnType<typeof fakeServer>; settings?: ReturnType<typeof fakeSettings> } = {}) {
  const models = fakeModels()
  const hf = fakeHf()
  const settings = overrides.settings ?? fakeSettings()
  const server = overrides.server ?? fakeServer()
  const service = createLlamaService({ models, hf, settings, server, environment: ENVIRONMENT, now: () => 42 })
  return { models, hf, settings, server, service }
}

/** The ipcMain-shaped sink and window list the registration writes to. */
function fakeHost(windows: LlamaIpcWindow[] = [{ send: vi.fn() }]) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  const host: LlamaIpcHost = {
    handle: (channel, listener) => {
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`)
      handlers.set(channel, listener)
    },
    windows: () => windows,
  }
  return { handlers, host, windows }
}

/** The event a manager renderer's top frame issues: file document, no parent frame. */
function managerEvent(): unknown {
  return { senderFrame: { url: MANAGER_URL, parent: null } }
}

/** A download that never settles, except by aborting when its signal fires. */
function abortableDownload() {
  return vi.fn((options: DownloadFileOptions) => new Promise<{ sizeBytes: number }>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => { reject(new Error('the transfer was aborted')) }, { once: true })
  }))
}

describe('defaultLlamaServiceDeps', () => {
  it('bundles the real module surface for the shell to compose', () => {
    expect(Object.keys(defaultLlamaServiceDeps).sort()).toEqual(['hf', 'models', 'settings'])
    expect(Object.values(defaultLlamaServiceDeps.models).every(member => typeof member === 'function')).toBe(true)
    expect(Object.values(defaultLlamaServiceDeps.hf).every(member => typeof member === 'function')).toBe(true)
    expect(Object.values(defaultLlamaServiceDeps.settings).every(member => typeof member === 'function')).toBe(true)
  })
})

describe('local model service', () => {
  it('lists installed models through the model store', async () => {
    const h = harness()
    await expect(h.service.listModels()).resolves.toEqual([installed])
    expect(h.models.listModels).toHaveBeenCalledExactlyOnceWith(ENVIRONMENT)
  })

  it('lists only GGUF repo files and forwards the configured token', async () => {
    const h = harness()
    await expect(h.service.listRepoFiles('owner/repo')).resolves.toEqual([
      { file: 'Qwen.Q4_K_M.gguf', sizeBytes: 1024, isGguf: true },
    ])
    expect(h.hf.listRepoFiles).toHaveBeenCalledExactlyOnceWith({ repo: 'owner/repo' })
    h.settings.set({ ...defaults, huggingFaceToken: 'hf-secret' })
    await h.service.listRepoFiles('owner/repo')
    expect(h.hf.listRepoFiles).toHaveBeenLastCalledWith({ repo: 'owner/repo', token: 'hf-secret' })
  })

  it('downloads a model, forwards progress and registers the result', async () => {
    const h = harness()
    h.hf.downloadFile.mockImplementation(async (options) => {
      options.onProgress?.({ receivedBytes: 512, totalBytes: 1024 })
      options.onProgress?.({ receivedBytes: 1024, totalBytes: 1024 })
      return { sizeBytes: 1024 }
    })
    const events: LlamaDownloadProgress[] = []
    h.service.onDownloadProgress(progress => events.push(progress))
    await expect(h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })).resolves.toMatchObject({
      id: installed.id,
      repo: 'owner/repo',
      file: 'Qwen.Q4_K_M.gguf',
      sizeBytes: 1024,
      downloadedAt: 42,
      quantization: 'Q4_K_M',
    })
    expect(h.models.deriveModelId).toHaveBeenCalledExactlyOnceWith({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })
    expect(h.hf.resolveFileUrl).toHaveBeenCalledExactlyOnceWith({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })
    const options = h.hf.downloadFile.mock.calls[0]![0]
    expect(options.url).toBe('https://huggingface.co/owner/repo/resolve/main/Qwen.Q4_K_M.gguf')
    expect(options.destination).toBe(join('/models', `${installed.id}.gguf`))
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.token).toBeUndefined()
    expect(h.models.parseModelMetadata).toHaveBeenCalledExactlyOnceWith('Qwen.Q4_K_M.gguf')
    expect(h.models.registerModel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: installed.id,
        path: join('/models', `${installed.id}.gguf`),
        downloadedAt: 42,
        quantization: 'Q4_K_M',
      }),
      ENVIRONMENT,
    )
    expect(events.map(event => event.phase)).toEqual(['downloading', 'downloading', 'downloading', 'verifying', 'done'])
    expect(events.at(-1)).toMatchObject({ receivedBytes: 1024, totalBytes: 1024 })
  })

  it('forwards the configured Hugging Face token to the download', async () => {
    const h = harness()
    h.settings.set({ ...defaults, huggingFaceToken: 'hf-secret' })
    h.hf.downloadFile.mockImplementation(async (options) => {
      expect(options.token).toBe('hf-secret')
      return { sizeBytes: 1 }
    })
    await h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })
    expect(h.hf.downloadFile).toHaveBeenCalledOnce()
  })

  it('reports a failed download and registers nothing', async () => {
    const h = harness()
    h.hf.downloadFile.mockRejectedValue(new Error('the disk is full'))
    const events: LlamaDownloadProgress[] = []
    h.service.onDownloadProgress(progress => events.push(progress))
    await expect(h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' }))
      .rejects.toThrow('the disk is full')
    expect(events.at(-1)).toMatchObject({ phase: 'error', error: 'the disk is full' })
    expect(h.models.registerModel).not.toHaveBeenCalled()
  })

  it('cancels exactly the in-flight download it is asked to cancel', async () => {
    const h = harness()
    h.models.deriveModelId.mockImplementation(input => `id-${input.file}`)
    interface Pending {
      readonly options: DownloadFileOptions
      resolve(value: { sizeBytes: number }): void
    }
    const pending = new Map<string, Pending>()
    h.hf.downloadFile.mockImplementation((options) => {
      const deferred = Promise.withResolvers<{ sizeBytes: number }>()
      pending.set(options.url, { options, resolve: deferred.resolve })
      options.signal?.addEventListener('abort', () => { deferred.reject(new Error('the transfer was aborted')) }, { once: true })
      return deferred.promise
    })
    const events: LlamaDownloadProgress[] = []
    h.service.onDownloadProgress(progress => events.push(progress))
    const first = h.service.downloadModel({ repo: 'owner/repo', file: 'first.gguf' })
    const second = h.service.downloadModel({ repo: 'owner/repo', file: 'second.gguf' })
    // Both transfers are in flight before either is cancelled.
    expect(pending.size).toBe(2)
    const [firstUrl, firstPending] = [...pending.entries()][0]!
    const [, secondPending] = [...pending.entries()][1]!
    expect(firstUrl).toContain('first.gguf')
    await h.service.cancelDownload('id-first.gguf')
    await expect(first).rejects.toThrow(/aborted/u)
    expect(firstPending.options.signal?.aborted).toBe(true)
    expect(secondPending.options.signal?.aborted).toBe(false)
    expect(events.at(-1)).toMatchObject({ id: 'id-first.gguf', phase: 'cancelled' })
    // The other transfer keeps its own controller and can still complete.
    secondPending.resolve({ sizeBytes: 2048 })
    await expect(second).resolves.toMatchObject({ id: 'id-second.gguf', sizeBytes: 2048 })
    expect(h.models.registerModel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'id-second.gguf' }),
      ENVIRONMENT,
    )
  })

  it('refuses a second download of the same model while the first runs', async () => {
    const h = harness()
    h.hf.downloadFile.mockImplementation(abortableDownload())
    const first = h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })
    await expect(h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' }))
      .rejects.toThrow(/already in progress/u)
    expect(h.hf.downloadFile).toHaveBeenCalledOnce()
    h.service.dispose()
    await expect(first).rejects.toThrow(/aborted/u)
  })

  it('stops the serving server before deleting the model it serves', async () => {
    const server = fakeServer({ status: 'running', baseUrl: 'http://127.0.0.1:9000/v1', port: 9000, modelId: installed.id })
    const h = harness({ server })
    await h.service.deleteModel(installed.id)
    expect(server.stop).toHaveBeenCalledOnce()
    expect(h.models.deleteModel).toHaveBeenCalledExactlyOnceWith(installed.id, ENVIRONMENT)
    expect(server.stop.mock.invocationCallOrder[0]!).toBeLessThan(
      h.models.deleteModel.mock.invocationCallOrder[0]!,
    )
  })

  it('deletes an unserved model without stopping the server', async () => {
    const server = fakeServer({ status: 'running', baseUrl: 'http://127.0.0.1:9000/v1', port: 9000, modelId: 'another-model' })
    const h = harness({ server })
    await h.service.deleteModel(installed.id)
    expect(h.models.deleteModel).toHaveBeenCalledOnce()
    expect(server.stop).not.toHaveBeenCalled()
  })

  it('stops a running server bound to the previous model on a settings save', async () => {
    const server = fakeServer({ status: 'running', baseUrl: 'http://127.0.0.1:9000/v1', port: 9000, modelId: 'previous-model' })
    const h = harness({ server })
    const next: LlamaSettings = { ...defaults, activeModelId: 'new-model' }
    await expect(h.service.saveSettings(next)).resolves.toEqual(next)
    expect(h.settings.writeSettings).toHaveBeenCalledExactlyOnceWith(next, ENVIRONMENT)
    expect(server.stop).toHaveBeenCalledOnce()
  })

  it('leaves a running server alone when the active model is unchanged', async () => {
    const server = fakeServer({ status: 'running', baseUrl: 'http://127.0.0.1:9000/v1', port: 9000, modelId: installed.id })
    const h = harness({ server })
    await h.service.saveSettings({ ...defaults })
    expect(server.stop).not.toHaveBeenCalled()
  })

  it('refuses to start without a selected model', async () => {
    const h = harness()
    h.settings.set({ ...defaults, activeModelId: null })
    await expect(h.service.startServer()).rejects.toThrow(/no model is selected/u)
    expect(h.server.start).not.toHaveBeenCalled()
  })

  it('refuses to start a selected model that is no longer installed', async () => {
    const h = harness()
    h.settings.set({ ...defaults, activeModelId: 'gone' })
    await expect(h.service.startServer()).rejects.toThrow(/no longer installed/u)
    expect(h.server.start).not.toHaveBeenCalled()
  })

  it('starts the supervisor with the active model path, context and threads', async () => {
    const h = harness()
    await expect(h.service.startServer()).resolves.toMatchObject({ status: 'running', modelId: installed.id })
    expect(h.server.start).toHaveBeenCalledExactlyOnceWith({
      modelPath: installed.path,
      modelId: installed.id,
      contextLength: 32768,
      threads: 8,
    })
  })

  it('reads and stops the supervisor state', async () => {
    const server = fakeServer({ status: 'running', baseUrl: 'http://127.0.0.1:9000/v1', port: 9000, modelId: installed.id })
    const h = harness({ server })
    await expect(h.service.getServerState()).resolves.toMatchObject({ status: 'running', modelId: installed.id })
    await expect(h.service.stopServer()).resolves.toEqual({ status: 'stopped' })
    expect(server.stop).toHaveBeenCalledOnce()
  })

  it('forwards every supervisor transition to state subscribers', () => {
    const h = harness()
    const states: LlamaServerState[] = []
    h.service.onServerState(state => states.push(state))
    h.server.emit({ status: 'starting', modelId: installed.id })
    h.server.emit({ status: 'running', modelId: installed.id, baseUrl: 'http://127.0.0.1:9000/v1', port: 9000 })
    expect(states.map(state => state.status)).toEqual(['starting', 'running'])
  })

  it('removes only the listener a subscription disposer owns', async () => {
    const h = harness()
    const first = vi.fn()
    const second = vi.fn()
    h.service.onDownloadProgress(first)
    h.service.onDownloadProgress(second)()
    h.hf.downloadFile.mockImplementation(async (options) => {
      options.onProgress?.({ receivedBytes: 1, totalBytes: 2 })
      return { sizeBytes: 2 }
    })
    await h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })
    expect(first).toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  it('dispose detaches the supervisor, clears subscribers and aborts in-flight downloads', async () => {
    const h = harness()
    const progress = vi.fn()
    const states = vi.fn()
    h.service.onDownloadProgress(progress)
    h.service.onServerState(states)
    h.hf.downloadFile.mockImplementation(abortableDownload())
    const download = h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })
    expect(h.server.listenerCount()).toBe(1)
    h.service.dispose()
    expect(h.server.listenerCount()).toBe(0)
    progress.mockClear()
    await expect(download).rejects.toThrow(/aborted/u)
    // Neither the cancelled event nor a later transition reaches a cleared subscriber.
    expect(progress).not.toHaveBeenCalled()
    h.server.emit({ status: 'running', modelId: installed.id, baseUrl: 'http://127.0.0.1:9000/v1', port: 9000 })
    expect(states).not.toHaveBeenCalled()
  })
})

describe('local model IPC registration', () => {
  it('registers a handler for every invoke channel and none for the event channels', () => {
    const h = harness()
    const host = fakeHost()
    registerLlamaIpc(h.service, host.host)
    const invoke = Object.values(LLAMA_IPC).filter(
      channel => channel !== LLAMA_IPC.downloadProgress && channel !== LLAMA_IPC.serverState,
    )
    expect(host.handlers.size).toBe(10)
    expect([...host.handlers.keys()].sort()).toEqual([...invoke].sort())
    expect(host.handlers.has(LLAMA_IPC.downloadProgress)).toBe(false)
    expect(host.handlers.has(LLAMA_IPC.serverState)).toBe(false)
  })

  it('dispatches each invoke channel to the matching service operation', async () => {
    const h = harness()
    const host = fakeHost()
    registerLlamaIpc(h.service, host.host)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
      host.handlers.get(channel)!(managerEvent(), ...args)
    const spies = {
      listModels: vi.spyOn(h.service, 'listModels').mockResolvedValue([installed]),
      listRepoFiles: vi.spyOn(h.service, 'listRepoFiles').mockResolvedValue([]),
      downloadModel: vi.spyOn(h.service, 'downloadModel').mockResolvedValue(installed),
      cancelDownload: vi.spyOn(h.service, 'cancelDownload').mockResolvedValue(undefined),
      deleteModel: vi.spyOn(h.service, 'deleteModel').mockResolvedValue(undefined),
      getSettings: vi.spyOn(h.service, 'getSettings').mockResolvedValue(defaults),
      saveSettings: vi.spyOn(h.service, 'saveSettings').mockResolvedValue(defaults),
      getServerState: vi.spyOn(h.service, 'getServerState').mockResolvedValue({ status: 'stopped' }),
      startServer: vi.spyOn(h.service, 'startServer').mockResolvedValue({ status: 'running' }),
      stopServer: vi.spyOn(h.service, 'stopServer').mockResolvedValue({ status: 'stopped' }),
    }
    const next: LlamaSettings = { ...defaults, threads: 4 }
    await expect(call(LLAMA_IPC.listModels)).resolves.toEqual([installed])
    await expect(call(LLAMA_IPC.listRepoFiles, 'owner/repo')).resolves.toEqual([])
    await expect(call(LLAMA_IPC.downloadModel, { repo: 'owner/repo', file: installed.file })).resolves.toBe(installed)
    await expect(call(LLAMA_IPC.cancelDownload, installed.id)).resolves.toBeUndefined()
    await expect(call(LLAMA_IPC.deleteModel, installed.id)).resolves.toBeUndefined()
    await expect(call(LLAMA_IPC.getSettings)).resolves.toBe(defaults)
    await expect(call(LLAMA_IPC.saveSettings, next)).resolves.toBe(defaults)
    await expect(call(LLAMA_IPC.getServerState)).resolves.toEqual({ status: 'stopped' })
    await expect(call(LLAMA_IPC.startServer)).resolves.toEqual({ status: 'running' })
    await expect(call(LLAMA_IPC.stopServer)).resolves.toEqual({ status: 'stopped' })
    expect(spies.listModels).toHaveBeenCalledExactlyOnceWith()
    expect(spies.listRepoFiles).toHaveBeenCalledExactlyOnceWith('owner/repo')
    expect(spies.downloadModel).toHaveBeenCalledExactlyOnceWith({ repo: 'owner/repo', file: installed.file })
    expect(spies.cancelDownload).toHaveBeenCalledExactlyOnceWith(installed.id)
    expect(spies.deleteModel).toHaveBeenCalledExactlyOnceWith(installed.id)
    expect(spies.getSettings).toHaveBeenCalledExactlyOnceWith()
    expect(spies.saveSettings).toHaveBeenCalledExactlyOnceWith(next)
    expect(spies.getServerState).toHaveBeenCalledExactlyOnceWith()
    expect(spies.startServer).toHaveBeenCalledExactlyOnceWith()
    expect(spies.stopServer).toHaveBeenCalledExactlyOnceWith()
  })

  it('refuses a caller outside the manager document top frame', async () => {
    const h = harness()
    const host = fakeHost()
    registerLlamaIpc(h.service, host.host)
    const handler = host.handlers.get(LLAMA_IPC.listModels)!
    const spy = vi.spyOn(h.service, 'listModels').mockResolvedValue([])
    const rejected: unknown[] = [
      {},
      { senderFrame: null },
      { senderFrame: { url: 'file:///desktop-app/renderer/welcome.html', parent: null } },
      { senderFrame: { url: 'dsh-app://app/index.html', parent: null } },
      { senderFrame: { url: 'https://example.com/renderer/llama.html', parent: null } },
      { senderFrame: { url: MANAGER_URL, parent: { url: MANAGER_URL } } },
    ]
    for (const event of rejected) await expect(handler(event)).rejects.toThrow(/unowned renderer/u)
    expect(spy).not.toHaveBeenCalled()
  })

  it('validates every argument before it reaches the service', async () => {
    const h = harness()
    const host = fakeHost()
    registerLlamaIpc(h.service, host.host)
    const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
      host.handlers.get(channel)!(managerEvent(), ...args)
    const listRepoFiles = vi.spyOn(h.service, 'listRepoFiles').mockResolvedValue([])
    const downloadModel = vi.spyOn(h.service, 'downloadModel').mockResolvedValue(installed)
    const cancelDownload = vi.spyOn(h.service, 'cancelDownload').mockResolvedValue(undefined)
    const deleteModel = vi.spyOn(h.service, 'deleteModel').mockResolvedValue(undefined)
    const saveSettings = vi.spyOn(h.service, 'saveSettings').mockResolvedValue(defaults)
    await expect(call(LLAMA_IPC.listRepoFiles, 42)).rejects.toThrow(/repository must be a non-empty string/u)
    await expect(call(LLAMA_IPC.listRepoFiles, '')).rejects.toThrow(/repository/u)
    await expect(call(LLAMA_IPC.listRepoFiles, 'x'.repeat(1025))).rejects.toThrow(/too long/u)
    await expect(call(LLAMA_IPC.downloadModel, null)).rejects.toThrow(/download request must be an object/u)
    await expect(call(LLAMA_IPC.downloadModel, { repo: 'owner/repo' })).rejects.toThrow(/file name/u)
    await expect(call(LLAMA_IPC.cancelDownload, 9)).rejects.toThrow(/model id/u)
    await expect(call(LLAMA_IPC.deleteModel, undefined)).rejects.toThrow(/model id/u)
    await expect(call(LLAMA_IPC.saveSettings, 'nope')).rejects.toThrow(/settings must be an object/u)
    expect(listRepoFiles).not.toHaveBeenCalled()
    expect(downloadModel).not.toHaveBeenCalled()
    expect(cancelDownload).not.toHaveBeenCalled()
    expect(deleteModel).not.toHaveBeenCalled()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('broadcasts download progress and server state to every live manager window', async () => {
    const h = harness()
    const windows: LlamaIpcWindow[] = [{ send: vi.fn() }, { send: vi.fn() }]
    registerLlamaIpc(h.service, fakeHost(windows).host)
    h.hf.downloadFile.mockImplementation(async (options) => {
      options.onProgress?.({ receivedBytes: 10, totalBytes: 20 })
      return { sizeBytes: 20 }
    })
    await h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })
    h.server.emit({ status: 'running', modelId: installed.id, baseUrl: 'http://127.0.0.1:9000/v1', port: 9000 })
    for (const window of windows) {
      expect(window.send).toHaveBeenCalledWith(LLAMA_IPC.downloadProgress, expect.objectContaining({ phase: 'downloading' }))
      expect(window.send).toHaveBeenCalledWith(
        LLAMA_IPC.serverState,
        expect.objectContaining({ status: 'running', modelId: installed.id }),
      )
    }
  })

  it('stops broadcasting once the registration is disposed', async () => {
    const h = harness()
    const windows: LlamaIpcWindow[] = [{ send: vi.fn() }]
    const dispose = registerLlamaIpc(h.service, fakeHost(windows).host)
    dispose()
    h.server.emit({ status: 'running', modelId: installed.id, baseUrl: 'http://127.0.0.1:9000/v1', port: 9000 })
    h.hf.downloadFile.mockImplementation(async (options) => {
      options.onProgress?.({ receivedBytes: 1, totalBytes: 2 })
      return { sizeBytes: 2 }
    })
    await h.service.downloadModel({ repo: 'owner/repo', file: 'Qwen.Q4_K_M.gguf' })
    expect(windows[0]!.send).not.toHaveBeenCalled()
  })
})
