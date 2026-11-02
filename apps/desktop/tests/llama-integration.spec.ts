/**
 * End-to-end integration of the bundled local-model feature.
 *
 * Every module here is the real one: the model store writes its registry under a
 * temp `DSH_LOCAL_MODELS_DIR`, the settings module persists beside it, the IPC
 * service composes those modules, and the shell wiring installs the manager
 * surface over them. Only the three edges a hermetic test must cut are faked:
 * the llama-server child process, the readiness HTTP probe, and the Hugging Face
 * transfer. No real process, no socket, no network.
 *
 * The spec walks the feature as an operator does: a GGUF is installed and shows
 * its parsed quantization, the settings round-trip selects it, the real service
 * starts the supervisor with exactly the store/settings input, the shell derives
 * the runner environment from the running endpoint (and never overrides an
 * operator's own provider), deleting the serving model stops the server before
 * the file is removed, and a failed download leaves neither a final file nor a
 * registry entry.
 */

import { EventEmitter } from 'node:events'
import type { SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LLAMA_IPC,
  type LlamaModel,
  type LlamaServerState,
  type LlamaSettings,
} from '../src/llama-api.ts'
import {
  createLlamaService,
  defaultLlamaServiceDeps,
  type LlamaServerSupervisor,
  type LlamaService,
  type LlamaServiceDeps,
} from '../src/llama-ipc.ts'
import {
  MODEL_REGISTRY_FILENAME,
  deriveModelId,
  listModels,
  parseModelMetadata,
  registerModel,
  resolveModelsDirectory,
  type LlamaModelMetadata,
} from '../src/llama-models.ts'
import { readSettings, writeSettings } from '../src/llama-settings.ts'
import { readServerState } from '../src/llama-server-state.ts'
import { installLlamaShell, type LlamaShell } from '../src/llama-shell.ts'
import type { LlamaChild, LlamaFetch, LlamaServerStartInput } from '../src/llama-server.ts'

// The shell wiring imports the native manager window, which imports Electron. This
// spec never opens it, so the mocked module only has to let the import resolve.
vi.mock('electron', () => ({
  app: { getAppPath: () => '/application' },
  BrowserWindow: function BrowserWindow() { throw new Error('a manager window is never opened by this spec') },
  nativeTheme: { shouldUseDarkColors: false },
}))

/** Repo and file an installed model comes from; the file name carries both parsed labels. */
const REPO = 'mradermacher/Huihui-Qwen3.8-27B-abliterated-GGUF'
const MODEL_FILE = 'Huihui-Qwen3.8-27B-abliterated.Q4_K_M.gguf'

/** Loopback port the service-level supervisor fake reports. */
const SERVICE_PORT = 19_401

/** Loopback port the shell-level supervisor seam reports. */
const SHELL_PORT = 19_402

/** Timestamp the service is told a completed download landed at. */
const DOWNLOADED_AT = 1_760_000_000_000

/** Temp directories, services and shell installs owned by a test, released after it. */
const roots: string[] = []
const services: LlamaService[] = []
const shells: LlamaShell[] = []
const spawns: CapturedSpawn[] = []

afterEach(async () => {
  for (const shell of shells.splice(0)) await shell.dispose().catch(() => undefined)
  for (const service of services.splice(0)) service.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  spawns.length = 0
  vi.restoreAllMocks()
})

/** @returns a launch environment whose model directory is a fresh temp directory. */
function createEnvironment(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llama-integration-'))
  roots.push(root)
  return { DSH_LOCAL_MODELS_DIR: join(root, 'models') }
}

/**
 * Install one GGUF through the real model store, exactly as a completed download would.
 * @param environment - launch environment naming the models directory.
 * @returns the registered model.
 */
async function seedModel(environment: NodeJS.ProcessEnv): Promise<LlamaModel> {
  const directory = resolveModelsDirectory(environment)
  mkdirSync(directory, { recursive: true })
  const id = deriveModelId({ repo: REPO, file: MODEL_FILE })
  const path = join(directory, `${id}.gguf`)
  writeFileSync(path, 'GGUF fixture bytes')
  const metadata: LlamaModelMetadata = parseModelMetadata(MODEL_FILE)
  return registerModel({
    id,
    repo: REPO,
    file: MODEL_FILE,
    path,
    sizeBytes: statSync(path).size,
    downloadedAt: DOWNLOADED_AT,
    ...metadata,
  }, environment)
}

/** The settings a test persists; only the active model id varies between cases. */
function settingsFor(model: LlamaModel): LlamaSettings {
  return { activeModelId: model.id, contextLength: 16_384, threads: 4, startOnLaunch: false }
}

/** One captured spawn: the child the real supervisor asked the injected factory for. */
interface CapturedSpawn {
  readonly command: string
  readonly args: readonly string[]
  readonly options: SpawnOptions
  readonly child: FakeChild
}

/** A child process shaped like the one the supervisor manages, with no OS process behind it. */
class FakeChild extends EventEmitter implements LlamaChild {
  /** Standard output stream the supervisor listens on. */
  readonly stdout = new PassThrough()
  /** Standard error stream the supervisor listens on. */
  readonly stderr = new PassThrough()
  /** Signals delivered to this child, in delivery order. */
  readonly signals: string[] = []
  /** Exit code once the child has exited. */
  exitCode: number | null = null
  /** Terminating signal once the child has exited. */
  signalCode: NodeJS.Signals | null = null

  /** Records the signal, then exits on the next microtask as a healthy child does. */
  kill(signal?: NodeJS.Signals | number): boolean {
    const name: NodeJS.Signals = typeof signal === 'string' ? signal : 'SIGKILL'
    this.signals.push(name)
    queueMicrotask(() => { this.exit(null, name) })
    return true
  }

  /** Reports one exit; a second call is the no-op a real child's exit is. */
  exit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

/** The injected child factory: captures the spawn and returns an in-memory child. */
function spawnIntoHarness(command: string, args: readonly string[], options: SpawnOptions): LlamaChild {
  const child = new FakeChild()
  spawns.push({ command, args, options, child })
  return child
}

/** What a service-level test can assert about the supervisor it injected. */
interface SupervisorHarness {
  readonly server: LlamaServerSupervisor
  readonly start: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
  emit(state: LlamaServerState): void
}

/**
 * Build a supervisor fake that publishes transitions like the real one.
 * @param initial - state the supervisor reports before anything starts.
 * @param onStop - runs while `stop()` is executing, which is where ordering assertions go.
 * @returns the supervisor surface plus the spies a test asserts against.
 */
function supervisorHarness(
  initial: LlamaServerState = { status: 'stopped' },
  onStop: () => void = () => undefined,
): SupervisorHarness {
  const listeners = new Set<(state: LlamaServerState) => void>()
  let current: LlamaServerState = initial
  const emit = (state: LlamaServerState): void => {
    current = state
    for (const listener of [...listeners]) listener(state)
  }
  const start = vi.fn(async (input: LlamaServerStartInput): Promise<LlamaServerState> => {
    const running: LlamaServerState = {
      status: 'running',
      baseUrl: `http://127.0.0.1:${SERVICE_PORT}/v1`,
      port: SERVICE_PORT,
      modelId: input.modelId,
      binary: 'cpu',
    }
    emit(running)
    return running
  })
  const stop = vi.fn(async (): Promise<LlamaServerState> => {
    onStop()
    emit({ status: 'stopped' })
    return current
  })
  const server: LlamaServerSupervisor = {
    get state(): LlamaServerState { return current },
    start,
    stop,
    onState: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return { server, start, stop, emit }
}

/** A Hugging Face surface whose only transfer attempt fails part-way through. */
function failingHf(): LlamaServiceDeps['hf'] {
  return {
    listRepoFiles: async () => [],
    resolveFileUrl: ({ repo, file }) => `https://huggingface.test/${repo}/resolve/main/${file}`,
    downloadFile: async (options) => {
      // A real transfer leaves a part file until it either verifies or discards it;
      // this one discards it and fails, which must never produce a final file.
      mkdirSync(dirname(options.destination), { recursive: true })
      writeFileSync(`${options.destination}.part`, 'partial fixture bytes')
      rmSync(`${options.destination}.part`, { force: true })
      throw new Error('the Hugging Face transfer broke')
    },
  }
}

/** @returns the createLlamaService call with the real modules and only the server/fetch edges faked. */
function createService(
  environment: NodeJS.ProcessEnv,
  server: LlamaServerSupervisor,
  hf: LlamaServiceDeps['hf'] = defaultLlamaServiceDeps.hf,
): LlamaService {
  const service = createLlamaService({
    ...defaultLlamaServiceDeps,
    hf,
    server,
    environment,
    now: () => DOWNLOADED_AT,
  })
  services.push(service)
  return service
}

/** The frame a manager renderer issues: the manager document in the top frame. */
function managerEvent(): unknown {
  return { senderFrame: { url: 'file:///C:/application/renderer/llama.html', parent: null } }
}

/** One installed shell, with the invoke handlers it registered on the fake ipcMain. */
interface InstalledShell {
  readonly shell: LlamaShell
  /** Absolute directory holding the fake `llama-server.exe` payload. */
  readonly payloadDirectory: string
  /** Invokes one channel the way the manager preload bridge would. */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

/**
 * Install the real shell wiring over a temp payload directory.
 * @param environment - launch environment naming the temp models directory.
 * @returns the shell, its payload directory and the invoke bridge.
 */
function installShell(environment: NodeJS.ProcessEnv): InstalledShell {
  const root = dirname(resolveModelsDirectory(environment))
  const payloadDirectory = join(root, 'llama-payload')
  mkdirSync(payloadDirectory, { recursive: true })
  writeFileSync(join(payloadDirectory, 'llama-server.exe'), 'MZ llama-server fixture')
  writeFileSync(join(payloadDirectory, 'ggml.dll'), 'llama dll fixture')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  const readyFetch: LlamaFetch = async () => ({ ok: true, status: 200 })
  const shell = installLlamaShell({
    resources: { node: process.execPath },
    environment,
    location: {
      packaged: false,
      resourcesPath: join(root, 'resources'),
      appPath: join(root, 'application'),
    },
    serverOptions: {
      directory: payloadDirectory,
      spawn: spawnIntoHarness,
      allocatePort: async () => SHELL_PORT,
      fetch: readyFetch,
      timeouts: { readyMs: 1_000, exitMs: 200 },
    },
    ipcMain: {
      handle(channel, listener) { handlers.set(channel, listener) },
    },
    windows: () => [],
  })
  shells.push(shell)
  return {
    shell,
    payloadDirectory,
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel)
      if (handler === undefined) throw new Error(`the shell did not register ${channel}`)
      return handler(managerEvent(), ...args)
    },
  }
}

describe('installed model and settings through the real store', () => {
  it('lists a registered GGUF with the quantization parsed from its file name', async () => {
    const environment = createEnvironment()
    const model = await seedModel(environment)

    const installed = await listModels(environment)

    expect(installed).toHaveLength(1)
    expect(installed[0]).toMatchObject({
      id: model.id,
      repo: REPO,
      file: MODEL_FILE,
      path: model.path,
      quantization: 'Q4_K_M',
      parameterSize: '27B',
      downloadedAt: DOWNLOADED_AT,
    })
    // The store reports the size on disk rather than the value it was registered with.
    expect(installed[0]!.sizeBytes).toBe(statSync(model.path).size)
    expect(model.quantization).toBe('Q4_K_M')
  })

  it('round-trips the settings that select the active model', async () => {
    const environment = createEnvironment()
    const model = await seedModel(environment)
    const next = settingsFor(model)

    const saved = writeSettings(next, environment)

    expect(saved).toEqual(next)
    expect(readSettings(environment)).toEqual(next)
    const service = createService(environment, supervisorHarness().server)
    await expect(service.getSettings()).resolves.toEqual(next)
  })
})

describe('service composition over the real modules', () => {
  it('starts the supervisor with exactly the store path and persisted limits', async () => {
    const environment = createEnvironment()
    const model = await seedModel(environment)
    writeSettings(settingsFor(model), environment)
    const supervisor = supervisorHarness()
    const service = createService(environment, supervisor.server)

    await expect(service.startServer()).resolves.toMatchObject({
      status: 'running',
      modelId: model.id,
      baseUrl: `http://127.0.0.1:${SERVICE_PORT}/v1`,
    })

    expect(supervisor.start).toHaveBeenCalledExactlyOnceWith({
      modelPath: model.path,
      modelId: model.id,
      contextLength: 16_384,
      threads: 4,
    })
  })

  it('stops a running server before deleting the model it serves', async () => {
    const environment = createEnvironment()
    const model = await seedModel(environment)
    writeSettings(settingsFor(model), environment)
    /** Whether the served file still existed at the moment the supervisor was stopped. */
    let fileExistedAtStop: boolean | undefined
    const supervisor = supervisorHarness(undefined, () => { fileExistedAtStop = existsSync(model.path) })
    const service = createService(environment, supervisor.server)
    await service.startServer()
    expect(await service.getServerState()).toMatchObject({ status: 'running', modelId: model.id })

    await service.deleteModel(model.id)

    // Windows cannot remove a file a running server holds open, so the stop must win.
    expect(supervisor.stop).toHaveBeenCalledOnce()
    expect(fileExistedAtStop).toBe(true)
    expect(await service.getServerState()).toEqual({ status: 'stopped' })
    expect(existsSync(model.path)).toBe(false)
    await expect(service.listModels()).resolves.toEqual([])
    await expect(listModels(environment)).resolves.toEqual([])
  })

  it('leaves no final file and no registry entry when a download fails', async () => {
    const environment = createEnvironment()
    const modelId = deriveModelId({ repo: REPO, file: MODEL_FILE })
    const destination = join(resolveModelsDirectory(environment), `${modelId}.gguf`)
    const service = createService(environment, supervisorHarness().server, failingHf())

    await expect(service.downloadModel({ repo: REPO, file: MODEL_FILE }))
      .rejects.toThrow('the Hugging Face transfer broke')

    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.part`)).toBe(false)
    expect(existsSync(join(resolveModelsDirectory(environment), MODEL_REGISTRY_FILENAME))).toBe(false)
    await expect(service.listModels()).resolves.toEqual([])
    await expect(listModels(environment)).resolves.toEqual([])
  })
})

describe('vision projector companions', () => {
  const MMPROJ_FILE = 'mmproj-Huihui-Qwen3.8-27B-abliterated-f16.gguf'

  /** A Hugging Face surface serving one main GGUF and its projector, writing fixture bytes. */
  function companionHf(): LlamaServiceDeps['hf'] {
    return {
      listRepoFiles: async () => [
        { file: MODEL_FILE, sizeBytes: 18, isGguf: true },
        { file: MMPROJ_FILE, sizeBytes: 20, isGguf: false, isProjector: true },
      ],
      resolveFileUrl: ({ repo, file }) => `https://huggingface.test/${repo}/resolve/main/${file}`,
      downloadFile: async (options) => {
        mkdirSync(dirname(options.destination), { recursive: true })
        const bytes = `GGUF fixture bytes for ${options.destination}`
        writeFileSync(options.destination, bytes)
        return { sizeBytes: Buffer.byteLength(bytes) }
      },
    }
  }

  it('downloads the projector with the model, records it and serves with it', async () => {
    const environment = createEnvironment()
    const supervisor = supervisorHarness()
    const service = createService(environment, supervisor.server, companionHf())

    const model = await service.downloadModel({ repo: REPO, file: MODEL_FILE })

    const companionId = deriveModelId({ repo: REPO, file: MMPROJ_FILE })
    const companionPath = join(resolveModelsDirectory(environment), `${companionId}.gguf`)
    expect(model.companionPath).toBe(companionPath)
    expect(existsSync(companionPath)).toBe(true)
    const [listed] = await listModels(environment)
    expect(listed).toMatchObject({ id: model.id, companionPath })

    writeSettings(settingsFor(model), environment)
    await expect(service.startServer()).resolves.toMatchObject({ status: 'running', modelId: model.id })
    expect(supervisor.start).toHaveBeenCalledExactlyOnceWith({
      modelPath: model.path,
      modelId: model.id,
      contextLength: 16_384,
      threads: 4,
      mmprojPath: companionPath,
    })
  })

  it('resolves a registry holding only a projector to no active model', async () => {
    const environment = createEnvironment()
    const directory = resolveModelsDirectory(environment)
    mkdirSync(directory, { recursive: true })
    const projectorId = deriveModelId({ repo: REPO, file: MMPROJ_FILE })
    const projectorPath = join(directory, `${projectorId}.gguf`)
    writeFileSync(projectorPath, 'GGUF fixture bytes')
    // The registry document an older build wrote when the projector was
    // downloaded and activated as though it were a model.
    writeFileSync(join(directory, MODEL_REGISTRY_FILENAME), JSON.stringify({
      version: 1,
      models: [{
        id: projectorId,
        repo: REPO,
        file: MMPROJ_FILE,
        path: projectorPath,
        sizeBytes: 18,
        downloadedAt: DOWNLOADED_AT,
      }],
    }))
    writeSettings(
      { activeModelId: projectorId, contextLength: 16_384, threads: 4, startOnLaunch: false },
      environment,
    )
    const supervisor = supervisorHarness()
    const service = createService(environment, supervisor.server)

    await expect(service.listModels()).resolves.toEqual([])
    await expect(service.startServer()).rejects.toThrow(/no longer installed/u)
    expect(supervisor.start).not.toHaveBeenCalled()
  })
})

describe('shell wiring and the runner environment', () => {
  it('derives exactly the local runner environment from the running server', async () => {
    const environment = createEnvironment()
    const model = await seedModel(environment)
    writeSettings(settingsFor(model), environment)
    const installed = installShell(environment)

    await expect(installed.invoke(LLAMA_IPC.getServerState)).resolves.toEqual({ status: 'stopped' })
    await expect(installed.invoke(LLAMA_IPC.startServer)).resolves.toMatchObject({
      status: 'running',
      modelId: model.id,
      baseUrl: `http://127.0.0.1:${SHELL_PORT}/v1`,
    })

    // The service drove the real supervisor, which spawned the fake child once.
    expect(spawns).toHaveLength(1)
    expect(spawns[0]!.command).toBe(join(installed.payloadDirectory, 'llama-server.exe'))
    expect(spawns[0]!.args).toContain(model.path)
    expect(spawns[0]!.args).toContain(model.id)

    const runnerEnvironment: NodeJS.ProcessEnv = {}
    installed.shell.attachRunnerEnvironment(runnerEnvironment)

    // Exactly the three names the runner reads: no extra, no missing, no stale values.
    expect(runnerEnvironment).toEqual({
      REDTEAM_LLM_PROVIDER: 'local',
      REDTEAM_LOCAL_BASE_URL: `http://127.0.0.1:${SHELL_PORT}/v1`,
      REDTEAM_LOCAL_MODEL: model.id,
    })
    expect(Object.keys(runnerEnvironment).sort()).toEqual([
      'REDTEAM_LLM_PROVIDER',
      'REDTEAM_LOCAL_BASE_URL',
      'REDTEAM_LOCAL_MODEL',
    ])
    // The launch environment is not the runner environment: the mirror writes only the target.
    expect(environment).toEqual({ DSH_LOCAL_MODELS_DIR: resolveModelsDirectory(environment) })

    // Disposing the install removes exactly the names it injected.
    await installed.shell.dispose()
    expect(runnerEnvironment).toEqual({})
  })

  it('publishes the server state beside the model store on every transition', async () => {
    const environment = createEnvironment()
    const model = await seedModel(environment)
    writeSettings(settingsFor(model), environment)
    const installed = installShell(environment)

    // From install, before any transition: this process serves nothing.
    expect(readServerState(environment)).toMatchObject({ version: 1, status: 'stopped' })

    await expect(installed.invoke(LLAMA_IPC.startServer)).resolves.toMatchObject({ status: 'running' })
    // The runner's catalog reads exactly this document: where the server is
    // and which model it serves, in the registry's own id.
    expect(readServerState(environment)).toMatchObject({
      version: 1,
      status: 'running',
      baseUrl: `http://127.0.0.1:${SHELL_PORT}/v1`,
      modelId: model.id,
    })

    await expect(installed.invoke(LLAMA_IPC.stopServer)).resolves.toMatchObject({ status: 'stopped' })
    const stopped = readServerState(environment)
    expect(stopped).toMatchObject({ version: 1, status: 'stopped' })
    expect(stopped?.baseUrl).toBeUndefined()
    expect(stopped?.modelId).toBeUndefined()

    // Disposing after a fresh start still leaves a stopped document behind:
    // nothing serves once this process is gone.
    await expect(installed.invoke(LLAMA_IPC.startServer)).resolves.toMatchObject({ status: 'running' })
    await installed.shell.dispose()
    expect(readServerState(environment)).toMatchObject({ version: 1, status: 'stopped' })
  })

  it('never overrides a provider the operator already configured', async () => {
    const environment = createEnvironment()
    const model = await seedModel(environment)
    writeSettings(settingsFor(model), environment)
    const operatorProvider = 'operator-console'
    environment.REDTEAM_LLM_PROVIDER = operatorProvider
    const installed = installShell(environment)

    // The server really does start...
    await expect(installed.invoke(LLAMA_IPC.startServer)).resolves.toMatchObject({ status: 'running' })

    const runnerEnvironment: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    installed.shell.attachRunnerEnvironment(runnerEnvironment)

    // ...and it is still never mirrored into a runner environment the operator owns.
    expect(runnerEnvironment).toEqual({ PATH: '/usr/bin' })
    expect(environment.REDTEAM_LLM_PROVIDER).toBe(operatorProvider)
    expect(runnerEnvironment.REDTEAM_LOCAL_BASE_URL).toBeUndefined()
    expect(runnerEnvironment.REDTEAM_LOCAL_MODEL).toBeUndefined()
  })
})
