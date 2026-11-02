/**
 * Shell wiring for the bundled local-model feature.
 *
 * The `llama-*` modules each own one concern (payload, supervisor, model store,
 * Hugging Face client, settings, IPC service, manager window); this module is the
 * one place that joins them to the running application. One {@link installLlamaShell}
 * call constructs the supervisor and the operations service, publishes the IPC
 * surface the manager window talks to, exposes the window opener the application
 * menu calls, and mirrors the running server into the environment the engagement
 * runner reads at spawn - so a local model becomes the runner's LLM provider
 * without the operator exporting anything. The same state is published to
 * `server-state.json` beside the model store (see `llama-server-state.ts`)
 * so the runner's model catalog can offer the serving model to the chat
 * picker while the runner is already running.
 *
 * Keeping this here rather than in `main.ts` keeps that file's diff to an import,
 * one install call, one menu entry and one quit-time dispose, and keeps every
 * Electron-facing dependency injectable through {@link LlamaShellOptions}: the
 * feature's own logic stays testable without Electron or a child process.
 */

import type { BrowserWindow, WebContents } from 'electron'
import {
  createLlamaService,
  defaultLlamaServiceDeps,
  registerLlamaIpc,
  type LlamaIpcHost,
  type LlamaIpcWindow,
  type LlamaService,
} from './llama-ipc.ts'
import type { LlamaServerState } from './llama-api.ts'
import { LlamaServer, type LlamaServerLocation, type LlamaServerOptions } from './llama-server.ts'
import { writeServerState } from './llama-server-state.ts'
import { openLlamaWindow } from './llama-window.ts'

/** Path suffix of the manager renderer document; only that document owns the bridge. */
const MANAGER_DOCUMENT_SUFFIX = '/renderer/llama.html'

/** Environment name the engagement runner reads to pick its LLM route. */
const PROVIDER_ENVIRONMENT_NAME = 'REDTEAM_LLM_PROVIDER'

/** Environment name carrying the loopback OpenAI-compatible base URL. */
const BASE_URL_ENVIRONMENT_NAME = 'REDTEAM_LOCAL_BASE_URL'

/** Environment name carrying the model id the running server advertises. */
const MODEL_ENVIRONMENT_NAME = 'REDTEAM_LOCAL_MODEL'

/** Provider value that routes the runner's agent roles to the bundled server. */
const LOCAL_PROVIDER = 'local'

/** The shell surface `main.ts` holds for the lifetime of the process. */
export interface LlamaShell {
  /** Open the manager window, or focus the one that is already open. */
  openWindow(): Promise<BrowserWindow>
  /** Mirror the serving endpoint into the environment the runner spawns with. */
  attachRunnerEnvironment(target: NodeJS.ProcessEnv): void
  /** Start the active model in the background when the operator enabled startOnLaunch. */
  startOnLaunch(): void
  /** Stop the server and release every registration this install made. */
  dispose(): Promise<void>
}

/** Runtime and Electron surface the install consumes; a test substitutes fakes. */
export interface LlamaShellOptions {
  /** Bundled runtime `main.ts` already resolved, for any child the shell may own. */
  readonly resources: Readonly<{ node: string }>
  /** Launch environment: the runner's spawn environment and the store/settings root. */
  readonly environment: NodeJS.ProcessEnv
  /** Where this launch's resources are and how it was launched. */
  readonly location: Readonly<{ packaged: boolean; resourcesPath: string; appPath: string }>
  /**
   * Supervisor seams (child factory, readiness fetch, clock, payload directory);
   * production passes nothing, and a hermetic integration test fakes the child.
   */
  readonly serverOptions?: LlamaServerOptions
  /** IPC registrar; a test supplies a fake that records handlers. */
  readonly ipcMain: Readonly<{
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void
    removeHandler?(channel: string): void
  }>
  /** Live renderers the server-state broadcasts reach; read on every send. */
  readonly windows: () => WebContents[]
}

/**
 * Compose the local-model feature into this process.
 * @param options - The launch's resources/environment/location plus the Electron
 * IPC and window seams.
 * @returns The shell surface `main.ts` keeps until quit.
 */
export function installLlamaShell(options: LlamaShellOptions): LlamaShell {
  const environment = options.environment
  const server = new LlamaServer(
    { ...options.location, environment } satisfies LlamaServerLocation,
    options.serverOptions,
  )
  const service: LlamaService = createLlamaService({
    ...defaultLlamaServiceDeps,
    server,
    environment,
    now: Date.now,
  })

  // The IPC surface goes through the injected registrar so dispose removes exactly
  // the channels this install claimed; the operations service owns the handlers.
  const channels: string[] = []
  /**
   * The live manager renderers an event may reach. registerLlamaIpc validates the
   * sender origin, so the broadcast list must be narrowed the same way: a window
   * showing anything but the manager document holds no bridge and gets nothing.
   */
  const managerWindows = (): readonly LlamaIpcWindow[] => options.windows()
    .filter(window => !window.isDestroyed()
      && window.getURL().replace(/\\/gu, '/').endsWith(MANAGER_DOCUMENT_SUFFIX))
  const host: LlamaIpcHost = {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void {
      channels.push(channel)
      options.ipcMain.handle(channel, listener)
    },
    windows: managerWindows,
  }
  const disposeIpc = registerLlamaIpc(service, host)

  // The operator's own value wins, and it is captured before the mirror below can
  // write the same keys: a person who pointed the runner at their own server is
  // never silently redirected to this one. The other two names are snapshotted so
  // a stop restores the environment exactly as it was found.
  const originals = new Map<string, string | undefined>([
    [PROVIDER_ENVIRONMENT_NAME, environment[PROVIDER_ENVIRONMENT_NAME]],
    [BASE_URL_ENVIRONMENT_NAME, environment[BASE_URL_ENVIRONMENT_NAME]],
    [MODEL_ENVIRONMENT_NAME, environment[MODEL_ENVIRONMENT_NAME]],
  ])
  const operatorOwnsProvider = (environment[PROVIDER_ENVIRONMENT_NAME] ?? '').trim() !== ''
  /** The runner environment the mirror writes into; the last attach wins. */
  let attached: NodeJS.ProcessEnv | undefined
  /** Whether the three names in `attached` were written by this install. */
  let injected = false

  /** Put the operator's values back and forget the injection. */
  const restore = (target: NodeJS.ProcessEnv): void => {
    if (!injected) return
    for (const [name, value] of originals) {
      if (value === undefined) Reflect.deleteProperty(target, name)
      else target[name] = value
    }
    injected = false
  }

  /** Point the runner environment at the server while it runs, or restore it. */
  const mirror = (target: NodeJS.ProcessEnv): void => {
    const state = server.state
    if (!operatorOwnsProvider && state.status === 'running'
      && state.baseUrl !== undefined && state.modelId !== undefined) {
      const baseUrl = state.baseUrl
      const modelId = state.modelId
      target[PROVIDER_ENVIRONMENT_NAME] = LOCAL_PROVIDER
      target[BASE_URL_ENVIRONMENT_NAME] = baseUrl
      target[MODEL_ENVIRONMENT_NAME] = modelId
      injected = true
      return
    }
    // Not serving (stopped, starting or failed): the runner must not point at it.
    restore(target)
  }

  /**
   * Publish the server state beside the model store, for readers outside
   * this process: the runner's model catalog reads `server-state.json` at
   * request time, because the environment mirror below can only reach a
   * runner spawned after the server starts. Best effort by design — the
   * document is a mirror, and a failed write leaves the previous document
   * in place for the catalog's probe to overrule.
   */
  const publishServerState = (state: LlamaServerState = server.state): void => {
    try {
      writeServerState(state, environment)
    } catch {
      // The write failed; the server's own state machine is unaffected.
    }
  }

  // `publish` sets the state before notifying, so a listener always reads the new one.
  const detachState = server.onState(() => {
    publishServerState()
    const target = attached
    if (target !== undefined) mirror(target)
  })
  // The document reflects this process from install, before any transition.
  publishServerState()

  /** Attach a runner environment and apply the state the server is in right now. */
  const attachRunnerEnvironment = (target: NodeJS.ProcessEnv): void => {
    attached = target
    mirror(target)
  }

  // One manager window: a second open focuses it, and concurrent opens join, so a
  // double-click on the menu entry cannot leave two windows talking over one service.
  let managerWindow: BrowserWindow | undefined
  let opening: Promise<BrowserWindow> | undefined

  /** Open the manager window, or focus the open one. */
  const openWindow = async (): Promise<BrowserWindow> => {
    const existing = managerWindow
    if (existing !== undefined && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return existing
    }
    const pending = opening ?? openLlamaWindow()
    opening = pending
    try {
      const window = await pending
      managerWindow = window
      window.once('closed', () => { if (managerWindow === window) managerWindow = undefined })
      return window
    } finally {
      if (opening === pending) opening = undefined
    }
  }

  /**
   * Start the operator's selected model when they asked for it at launch. Never
   * awaited from the install: reading a model from disk takes tens of seconds and
   * startup must not wait for it. Success logs one line; a failure is reported in
   * the manager window's server state and logged once here.
   */
  const startOnLaunch = (): void => {
    const settings = defaultLlamaServiceDeps.settings.readSettings(environment)
    if (!settings.startOnLaunch || settings.activeModelId === null) return
    void service.startServer().then((state) => {
      if (state.status === 'running') {
        console.info(`desktop local models: serving ${state.modelId ?? 'the active model'} `
          + `at ${state.baseUrl ?? 'a loopback port'}`)
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`desktop local models: the active model did not start: ${message}`)
    })
  }

  /** Stop the server and release every registration this install made. */
  const dispose = async (): Promise<void> => {
    detachState()
    disposeIpc()
    for (const channel of channels) options.ipcMain.removeHandler?.(channel)
    const target = attached
    attached = undefined
    if (target !== undefined) restore(target)
    service.dispose()
    // The application is quitting, so the child is killed rather than asked to exit:
    // a graceful SIGTERM may not finish before this process does, and a llama-server
    // that outlives the shell would keep its model file open and its port held.
    server.killNow()
    // The state listener is already detached, so say it directly: after this
    // process exits nothing is serving, whatever the last transition claimed.
    publishServerState({ status: 'stopped' })
  }

  const shell: LlamaShell = { openWindow, attachRunnerEnvironment, startOnLaunch, dispose }
  startOnLaunch()
  return shell
}
