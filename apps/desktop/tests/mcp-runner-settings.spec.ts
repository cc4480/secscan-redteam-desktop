vi.mock('../src/web-document.ts', () => ({ authenticateWebHost: async () => 'test-cookie', serveWebDocument: vi.fn(), forwardWebRequest: vi.fn() }))
/** MCP settings saves that redefine the runner must reach the running supervisor (S5-H7b). */

import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindowConstructorOptions } from 'electron'
import type { DesktopLocale } from '../src/locale.ts'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { WelcomeOperations } from '../src/welcome-api.ts'

const state = vi.hoisted(() => ({
  appListeners: new Map<string, (...args: unknown[]) => void>(),
  dialogLocale: undefined as (() => DesktopLocale) | undefined,
  beforeRead: vi.fn(async () => {}),
  beforeWelcome: vi.fn(async () => {}),
  copy: vi.fn(),
  accountState: vi.fn<() => Promise<AccountView>>().mockResolvedValue({
    status: 'signed-out', attempt: null, links: { usageUrl: '', topUpUrl: '' },
  }),
  quit: vi.fn(),
  startHost: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:3080/?token=test', injections: [] }),
  stopHost: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  loadWorkspace: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
  showWorkspace: vi.fn(),
  closeWelcome: vi.fn(),
  welcomeLocale: undefined as DesktopLocale | undefined,
  preference: 'zh',
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  contents: undefined as { mainFrame: { url: string } } | undefined,
  windowOptions: undefined as BrowserWindowConstructorOptions | undefined,
  menu: vi.fn(),
  operations: undefined as WelcomeOperations | undefined,
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
  hostEnvironments: [] as (NodeJS.ProcessEnv | undefined)[],
  /** Environments the supervised engagement runner was handed, in construction order. */
  runnerEnvironments: [] as NodeJS.ProcessEnv[],
  /** The environment object the runner mock supervises; set by its constructor. */
  runnerEnvironment: undefined as NodeJS.ProcessEnv | undefined,
  /** Names the app installed from the credential document; the runner receives the same set. */
  runnerInstalled: new Set<string>(),
  /** Whether the mocked bundled console is currently the active one. */
  runnerActive: false,
  startRunner: vi.fn<() => Promise<unknown>>(),
  stopRunner: vi.fn<() => Promise<void>>(),
}))

/** Endpoint and token the mocked supervisor installs for the bundled console. */
const SUPERVISOR_ENDPOINT = 'http://127.0.0.1:49152/mcp'
const SUPERVISOR_TOKEN = '<MASKED_SECRET_001>'

vi.mock('../src/crash-report.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/crash-report.ts')>(),
  writeCrashReport: vi.fn(async () => undefined),
  pruneCrashReports: vi.fn(async () => {}),
}))
vi.mock('electron', () => ({
  clipboard: { writeText: state.copy },
  // No OS credential store on this host, so the store's owner-only fallback is the one under test.
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  app: {
    isPackaged: false,
    name: 'Harness',
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: vi.fn(),
    whenReady: () => Promise.resolve(),
    getLocale: () => 'en',
    getVersion: () => '1.0.0',
    setAboutPanelOptions: vi.fn(),
    getAppPath: () => '/development-app',
    getPath: (name: string) => `/development-${name}`,
    setAppLogsPath: vi.fn(),
    getPreferredSystemLanguages: () => ['en-US'],
    on: (name: string, callback: (...args: unknown[]) => void) => { state.appListeners.set(name, callback) },
    quit: state.quit,
    exit: vi.fn(),
  },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: class {
    constructor(options: BrowserWindowConstructorOptions) { state.windowOptions = options }
    private ready: (() => void) | undefined
    webContents = { mainFrame: { url: 'dsh-app://app/' }, setWindowOpenHandler: vi.fn(), on: vi.fn(), once: vi.fn(), send: vi.fn(), openDevTools: vi.fn() }
    static getAllWindows() { return [] }
    once(name: string, callback: () => void) { if (name === 'ready-to-show') this.ready = callback; return this }
    on() { return this }
    isDestroyed() { return false }
    isMinimized() { return false }
    restore = vi.fn()
    focus = vi.fn()
    hide = vi.fn()
    show = state.showWorkspace
    async loadURL(url: string) { state.contents = this.webContents; await state.loadWorkspace(url); this.ready?.() }
  },
  net: { fetch: vi.fn() },
  nativeTheme: state.nativeTheme,
  session: { defaultSession: {
    setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeSendHeaders: vi.fn() },
  } },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  ipcMain: {
    handle: (name: string, callback: (...args: unknown[]) => unknown) => { state.handlers.set(name, callback) },
    on: (name: string, callback: (...args: unknown[]) => void) => { state.listeners.set(name, callback) },
  },
  dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() },
  Menu: { buildFromTemplate: state.menu, setApplicationMenu: vi.fn() },
}))

vi.mock('../src/paths.ts', () => ({ resolveDesktopPaths: () => ({ profile: '/profile' }) }))
vi.mock('../src/project-manager.ts', () => ({ DesktopProjectManager: class {
  applyRelease = vi.fn(async () => {})
  canRecoverProfile = vi.fn(() => true)
} }))
vi.mock('../src/host-process.ts', () => ({
  DesktopHostProcess: class {
    constructor(_node: string, _dsh: string, _project: string, _port?: number, environment?: NodeJS.ProcessEnv) {
      // The environment here is the one the Host child is spawned with, so it is what
      // cordis composes the MCP rows from.
      state.hostEnvironments.push(environment)
    }
    start = state.startHost
    stop = state.stopHost
    fetch() {
      return Promise.resolve(Response.json({ loggedIn: false, hasApiKey: false, writable: true, localePreference: state.preference }))
    }
  },
}))
/**
 * The bundled engagement runner is a child process, so this suite owns only the part of
 * main's contract that is about the environment: it receives the same object the Host is
 * constructed with, and it is started before the Host exists. Its own lifecycle is
 * covered by tests/redteam-runner.spec.ts.
 */
vi.mock('../src/redteam-runner.ts', () => ({
  /**
   * Faithful stand-in for the supervisor's environment contract, which is the part
   * under test here: `start()` installs the bundled console's endpoint and a
   * generated token in the shared environment and reports the console names as
   * its own while it is active; a configured endpoint or a launch-environment
   * console name suppresses it; `stop()` removes what it installed. The child
   * process itself is covered by tests/redteam-runner.spec.ts.
   */
  DesktopRedteamRunner: class {
    constructor(_resources: unknown, environment: NodeJS.ProcessEnv, options: { installed: Set<string> }) {
      state.runnerEnvironments.push(environment)
      state.runnerEnvironment = environment
      state.runnerInstalled = options.installed
      state.startRunner.mockImplementation(async () => {
        const env = state.runnerEnvironment!
        const operator = ['REDTEAM_UI_TOKEN', 'REDTEAM_MCP_URL']
          .filter(name => !state.runnerInstalled.has(name) && (env[name] ?? '') !== '')
        if (operator.length > 0 || (env.REDTEAM_MCP_URL ?? '') !== '') {
          state.runnerActive = false
          return undefined
        }
        const stored = (env.REDTEAM_UI_TOKEN ?? '').trim()
        const token = stored.length >= 16 ? stored : SUPERVISOR_TOKEN
        env.REDTEAM_MCP_URL = SUPERVISOR_ENDPOINT
        env.REDTEAM_UI_TOKEN = token
        state.runnerActive = true
        return { endpoint: SUPERVISOR_ENDPOINT, token }
      })
      state.stopRunner.mockImplementation(async () => {
        if (state.runnerActive) {
          Reflect.deleteProperty(state.runnerEnvironment!, 'REDTEAM_MCP_URL')
          Reflect.deleteProperty(state.runnerEnvironment!, 'REDTEAM_UI_TOKEN')
        }
        state.runnerActive = false
      })
    }
    get consoleEnvironmentNames() {
      return state.runnerActive ? new Set(['REDTEAM_UI_TOKEN', 'REDTEAM_MCP_URL']) : new Set<string>()
    }
    start = state.startRunner
    stop = state.stopRunner
    killNow() {}
  },
  redteamRunnerResources: () => ({ node: '/runtime/electron', directory: '/runtime/redteam-runner' }),
}))
vi.mock('../src/welcome-backend.ts', () => ({
  connectDesktopWelcome: async () => ({
    readLocalePreference: async () => state.preference,
    read: async () => {
      await state.beforeRead()
      return { loggedIn: false, hasApiKey: false, writable: true, localePreference: state.preference }
    },
    save: async () => ({ ok: true }),
    account: { watch: () => () => {}, state: state.accountState },
  }),
}))
// The per-server status probe performs real network and child-process work, which this
// suite's fake timers cannot drive; its behavior is covered by tests/mcp-server-status.spec.ts.
vi.mock('../src/mcp-server-status.ts', () => ({
  probeMcpServers: async () => [],
}))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readFile: vi.fn(async () => '{}'),
}))
vi.mock('../src/update-dialog.ts', () => ({ DesktopUpdateDialog: class {
  constructor(_preload: string, locale: () => DesktopLocale) { state.dialogLocale = locale }
  dispose() {}
} }))
vi.mock('../src/update-coordinator.ts', () => ({ DesktopUpdateCoordinator: class {
  state = { phase: 'idle' }
  check = vi.fn(async () => this.state)
  dispose = vi.fn()
} }))
vi.mock('../src/welcome-window.ts', () => ({
  openWelcomeWindow: async (locale: DesktopLocale, operations: WelcomeOperations) => {
    state.welcomeLocale = locale
    state.operations = operations
    await state.beforeWelcome()
    return { once: vi.fn(), close: state.closeWelcome }
  },
}))
/**
 * The credential document is driven in memory here: this suite covers what main
 * does with stored values - the process environment the Host is constructed with,
 * and the Host restart that re-composes the MCP rows - not file permissions.
 */
const mcp = vi.hoisted(() => {
  const stored: { values: Record<string, string>; fingerprints: Record<string, string>; exists: boolean; declined: boolean } =
    { values: {}, fingerprints: {}, exists: false, declined: false }
  return {
    required: true,
    stored,
    // The real loader updates the caller's own installed set - the same set the
    // runner was constructed with - so this stand-in does the same instead of
    // keeping a private one the runner cannot see.
    load: vi.fn(async (environment: NodeJS.ProcessEnv, _file: string, _protector: unknown, installed: Set<string>) => {
      // Stands in for the real loader: a removed entry leaves the environment, but only a name this
      // process installed from the document is replaced; an inherited variable is never touched.
      for (const name of [...installed]) {
        if (stored.values[name] !== undefined) continue
        Reflect.deleteProperty(environment, name)
        installed.delete(name)
      }
      for (const [name, value] of Object.entries(stored.values)) {
        if (!installed.has(name) && (environment[name] ?? '') !== '') continue
        environment[name] = value
        installed.add(name)
      }
      return { values: { ...stored.values }, fingerprints: { ...stored.fingerprints }, exists: stored.exists, declined: stored.declined }
    }),
    read: vi.fn(async () => ({
      values: { ...stored.values }, fingerprints: { ...stored.fingerprints }, exists: stored.exists, declined: stored.declined,
    })),
    write: vi.fn(async (_file: string, _protector: unknown,
      draft: { secscan: string | null; seclayer: string | null; runner: string | null; endpoint: string | null }, declined = false) => {
      if (draft.secscan !== null) { stored.values.SECSCAN_MCP_TOKEN = draft.secscan; stored.fingerprints.SECSCAN_MCP_TOKEN = 'ssk_…oken' }
      if (draft.seclayer !== null) { stored.values.SECLAYER_API_KEY = draft.seclayer; stored.fingerprints.SECLAYER_API_KEY = 'secl…oken' }
      if (draft.runner !== null) stored.values.REDTEAM_UI_TOKEN = draft.runner
      if (draft.endpoint !== null) stored.values.REDTEAM_MCP_URL = draft.endpoint
      if (declined) stored.declined = true
      stored.exists = true
      return true
    }),
    clear: vi.fn(async () => { stored.values = {}; stored.fingerprints = {}; stored.exists = false; return true }),
  }
})
vi.mock('../src/mcp-credentials.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/mcp-credentials.ts')>(),
  loadStoredMcpCredentials: mcp.load,
  readStoredMcpCredentials: mcp.read,
  writeStoredMcpCredentials: mcp.write,
  clearStoredMcpCredentials: mcp.clear,
  mcpSetupRequired: () => mcp.required,
}))

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('applies a first save of the runner token or console endpoint to the running system, and leaves other saves alone', async () => {
  vi.useFakeTimers()
  vi.stubEnv('DSH_DESKTOP_DEV_PROJECT_DIR', '/development-profile')
  vi.stubEnv('DSH_DESKTOP_NODE_BINARY', '/runtime/node')
  vi.stubEnv('DSH_DESKTOP_PNPM_ENTRY', '/runtime/pnpm')
  vi.stubEnv('DSH_DESKTOP_DSH_DIR', '/runtime/dsh')
  vi.stubEnv('DSH_DESKTOP_PRIMARY_RUNTIME_DIR', '/runtime/primary-runtime')
  vi.stubEnv('DSH_DESKTOP_HOST_INSPECT_PORT', undefined)
  vi.stubEnv('DSH_DESKTOP_OPEN_DEVTOOLS', '0')
  vi.stubEnv('DSH_DESKTOP_MANDATORY_UPDATE_CONFIG', undefined)
  vi.stubEnv('DSH_DESKTOP_UPDATE_JOURNAL_DIR', undefined)
  vi.stubEnv('SECSCAN_MCP_TOKEN', undefined)
  vi.stubEnv('SECLAYER_API_KEY', undefined)
  vi.stubEnv('REDTEAM_UI_TOKEN', undefined)
  vi.stubEnv('REDTEAM_MCP_URL', undefined)
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.operations).toBeDefined() })
  // The bundled console started at launch and installed its own endpoint and token in
  // the environment the Host composes from; neither name came from the credential
  // document, which is the state the first-save defect lives in.
  expect(state.startRunner).toHaveBeenCalledOnce()
  expect(state.runnerActive).toBe(true)
  expect(process.env.REDTEAM_MCP_URL).toBe(SUPERVISOR_ENDPOINT)
  expect(process.env.REDTEAM_UI_TOKEN).toBe(SUPERVISOR_TOKEN)

  // A save that touches no console name behaves exactly as before: the document is
  // reloaded and the Host restarted, and the supervisor is never disturbed.
  expect(await state.operations!.saveMcp({ secscan: 'ssk_unrelated-token', seclayer: '', runner: '', endpoint: '' })).toEqual({ ok: true })
  expect(state.stopRunner).not.toHaveBeenCalled()
  expect(state.startRunner).toHaveBeenCalledOnce()
  expect(process.env.SECSCAN_MCP_TOKEN).toBe('ssk_unrelated-token')
  expect(process.env.REDTEAM_MCP_URL).toBe(SUPERVISOR_ENDPOINT)
  expect(process.env.REDTEAM_UI_TOKEN).toBe(SUPERVISOR_TOKEN)

  // The first save of a runner token: the bundled console restarts and runs with the
  // saved token, so the environment the replacement Host composes from carries it.
  expect(await state.operations!.saveMcp({ secscan: '', seclayer: '', runner: 'operator-runner-token-1', endpoint: '' })).toEqual({ ok: true })
  expect(state.stopRunner).toHaveBeenCalledOnce()
  expect(state.startRunner).toHaveBeenCalledTimes(2)
  expect(state.stopRunner.mock.invocationCallOrder[0]!).toBeLessThan(state.startRunner.mock.invocationCallOrder[1]!)
  expect(state.runnerActive).toBe(true)
  expect(process.env.REDTEAM_UI_TOKEN).toBe('operator-runner-token-1')
  expect(process.env.REDTEAM_MCP_URL).toBe(SUPERVISOR_ENDPOINT)
  expect(state.hostEnvironments.at(-1)!.REDTEAM_UI_TOKEN).toBe('operator-runner-token-1')

  // Clearing the document while the bundled console is active restarts it too: the
  // stored token leaves the environment and a fresh supervisor token replaces it.
  expect(await state.operations!.clearMcp()).toEqual({ ok: true })
  expect(state.stopRunner).toHaveBeenCalledTimes(2)
  expect(state.startRunner).toHaveBeenCalledTimes(3)
  expect(state.runnerActive).toBe(true)
  expect(process.env.REDTEAM_UI_TOKEN).toBe(SUPERVISOR_TOKEN)
  expect(process.env.SECSCAN_MCP_TOKEN).toBeUndefined()

  // The first save of a console endpoint: the bundled console stops and stays off,
  // and the saved endpoint is the one now in effect for the runner row.
  expect(await state.operations!.saveMcp({ secscan: '', seclayer: '', runner: '', endpoint: 'http://127.0.0.1:9999/mcp' })).toEqual({ ok: true })
  expect(state.stopRunner).toHaveBeenCalledTimes(3)
  expect(state.startRunner).toHaveBeenCalledTimes(4)
  expect(state.runnerActive).toBe(false)
  expect(process.env.REDTEAM_MCP_URL).toBe('http://127.0.0.1:9999/mcp')
  expect(state.hostEnvironments.at(-1)!.REDTEAM_MCP_URL).toBe('http://127.0.0.1:9999/mcp')
  expect((await state.operations!.readMcp()).endpoint).toBe('http://127.0.0.1:9999/mcp')
})
