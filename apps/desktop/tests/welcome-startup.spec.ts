vi.mock('../src/web-document.ts', () => ({ authenticateWebHost: async () => 'test-cookie', serveWebDocument: vi.fn(), forwardWebRequest: vi.fn() }))
/** Welcome startup uses the Host before transitioning to the workspace. */

import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'
import type { DesktopLocale } from '../src/locale.ts'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { WelcomeOperations } from '../src/welcome-api.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'

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
  startRunner: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
  stopRunner: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

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
  DesktopRedteamRunner: class {
    constructor(_resources: unknown, environment: NodeJS.ProcessEnv) { state.runnerEnvironments.push(environment) }
    consoleEnvironmentNames = new Set<string>()
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
  const installed = new Set<string>()
  return {
    required: true,
    stored,
    load: vi.fn(async (environment: NodeJS.ProcessEnv) => {
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
      draft: { secscan: string | null; seclayer: string | null; runner: string | null }, declined = false) => {
      if (draft.secscan !== null) { stored.values.SECSCAN_MCP_TOKEN = draft.secscan; stored.fingerprints.SECSCAN_MCP_TOKEN = 'ssk_…oken' }
      if (draft.seclayer !== null) { stored.values.SECLAYER_API_KEY = draft.seclayer; stored.fingerprints.SECLAYER_API_KEY = 'secl…oken' }
      if (draft.runner !== null) stored.values.REDTEAM_UI_TOKEN = draft.runner
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

it('starts the Host for welcome onboarding and opens the workspace on skip without quitting', async () => {
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
  const reading = Promise.withResolvers<undefined>()
  const loading = Promise.withResolvers<undefined>()
  state.beforeRead.mockReturnValueOnce(reading.promise)
  state.beforeWelcome.mockReturnValueOnce(loading.promise)
  const activate = () => {
    state.appListeners.get('second-instance')!()
    state.appListeners.get('open-url')!({ preventDefault: vi.fn() }, 'dsh://open')
  }
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.beforeRead).toHaveBeenCalledOnce() })
  try {
    activate()
    expect(state.showWorkspace).not.toHaveBeenCalled()
    reading.resolve(undefined)
    await vi.waitFor(() => { expect(state.beforeWelcome).toHaveBeenCalledOnce() })
    activate()
    expect(state.showWorkspace).not.toHaveBeenCalled()
  } finally {
    reading.resolve(undefined)
    loading.resolve(undefined)
  }
  await vi.waitFor(() => { expect(state.operations).toBeDefined() })
  expect(state.startHost).toHaveBeenCalledOnce()
  // The engagement runner is handed the very environment object the Host child is spawned
  // with, so the endpoint and token it installs are the ones cordis reads while composing
  // the MCP rows - and it has to be started before the Host exists.
  expect(state.runnerEnvironments).toHaveLength(1)
  expect(state.runnerEnvironments[0]).toBe(process.env)
  expect(state.startRunner).toHaveBeenCalledOnce()
  expect(state.startRunner.mock.invocationCallOrder[0]!).toBeLessThan(state.startHost.mock.invocationCallOrder[0]!)
  expect(state.loadWorkspace).toHaveBeenCalledExactlyOnceWith('dsh-app://app/')
  expect(state.showWorkspace).not.toHaveBeenCalled()
  state.loadWorkspace.mockClear()
  expect(state.welcomeLocale).toMatchObject({ id: 'zh-CN' })
  expect(state.dialogLocale!().id).toBe('zh-CN')
  const attemptId = 'login' as NonNullable<AccountView['attempt']>['id']
  const account: AccountView = { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' },
    attempt: { id: attemptId, phase: 'waiting-browser', authorizeUrl: 'https://example.test/login' } }
  state.accountState.mockResolvedValue(account)
  await state.operations!.copySignInLink(attemptId)
  expect(state.copy).toHaveBeenCalledExactlyOnceWith('https://example.test/login?theme=light')
  state.nativeTheme.shouldUseDarkColors = true
  await state.operations!.copySignInLink(attemptId)
  expect(state.copy).toHaveBeenLastCalledWith('https://example.test/login?theme=dark')
  state.nativeTheme.shouldUseDarkColors = false
  await expect(state.operations!.copySignInLink('stale' as typeof attemptId)).rejects.toThrow('login link is unavailable')
  state.accountState.mockResolvedValue({ ...account, attempt: { id: attemptId, phase: 'expired' } })
  await expect(state.operations!.copySignInLink(attemptId)).rejects.toThrow('login link is unavailable')
  expect(state.copy).toHaveBeenCalledTimes(2)
  await state.operations!.skip()
  expect(state.loadWorkspace).not.toHaveBeenCalled()
  expect(state.showWorkspace).toHaveBeenCalledOnce()
  expect(state.windowOptions).toMatchObject({
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 }, vibrancy: 'sidebar' } : {}),
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  expect(state.closeWelcome).toHaveBeenCalledOnce()
  activate()
  expect(state.showWorkspace).toHaveBeenCalledTimes(3)
  expect(state.quit).not.toHaveBeenCalled()
  expect(state.stopHost).not.toHaveBeenCalled()
  const contents = state.contents as { mainFrame: { url: string }; send: ReturnType<typeof vi.fn> }
  expect(contents.send).toHaveBeenCalledWith(DESKTOP_IPC.enterWorkspace)
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const bootstrap = state.handlers.get(DESKTOP_IPC.localeBootstrap)!
  expect(await bootstrap(event)).toEqual({ languages: ['en-US'], preference: 'zh' })
  state.preference = 'en'
  expect(await bootstrap(event)).toEqual({ languages: ['en-US'], preference: 'en' })
  const changed = state.listeners.get(DESKTOP_IPC.localeChanged)!
  const initialMenus = state.menu.mock.calls.length
  changed({ ...event, senderFrame: {} }, 'en')
  changed(event, 42)
  expect(state.menu).toHaveBeenCalledTimes(initialMenus)
  changed(event, 'en')
  expect(state.dialogLocale!().id).toBe('en')
  expect(state.menu).toHaveBeenCalledTimes(initialMenus + 1)
  expect(await bootstrap(event)).toEqual({ languages: ['en-US'], preference: 'en' })

  // First-run MCP access. The document reaches the Host through the process environment, and only a
  // restart re-composes the MCP rows, so both have to happen before the step is reported as stored.
  const mcpView = await state.operations!.readMcp()
  expect(mcpView).toMatchObject({
    required: true, entryRequired: true, storePath: join('/development-userData', 'engagement-credentials.json'),
    endpoint: 'http://127.0.0.1:8787/mcp', stored: false, fingerprints: {},
  })
  // The launch load runs on the real process environment, before the first Host exists.
  expect(mcp.load).toHaveBeenCalledWith(process.env, mcpView.storePath, expect.anything(), expect.anything())
  expect(mcp.load.mock.invocationCallOrder[0]!).toBeLessThan(state.startHost.mock.invocationCallOrder[0]!)

  // A refused value reaches neither the document nor the environment, and starts no Host.
  const hostsBefore = state.startHost.mock.calls.length
  expect(await state.operations!.saveMcp({ secscan: 'SECSCAN_MCP_TOKEN=ssk_pasted-line', seclayer: '', runner: '', endpoint: '' })).toEqual({ ok: false })
  expect(await state.operations!.saveMcp({ secscan: '', seclayer: '', runner: '', endpoint: 'http://10.0.0.5:8787/mcp' })).toEqual({ ok: false })
  expect(mcp.write).not.toHaveBeenCalled()
  expect(state.startHost).toHaveBeenCalledTimes(hostsBefore)
  expect(process.env.SECSCAN_MCP_TOKEN).toBeUndefined()

  expect(await state.operations!.saveMcp({ secscan: 'ssk_first-run-token', seclayer: '', runner: 'runner-first-run-token', endpoint: '' })).toEqual({ ok: true })
  expect(mcp.write).toHaveBeenCalledExactlyOnceWith(mcpView.storePath, expect.anything(), {
    secscan: 'ssk_first-run-token', seclayer: null, runner: 'runner-first-run-token', endpoint: null,
  })
  // The stored values are in the environment the replacement Host is constructed with, which is
  // exactly what its MCP rows read while cordis composes the profile.
  expect(state.stopHost).toHaveBeenCalledOnce()
  expect(state.startHost).toHaveBeenCalledTimes(hostsBefore + 1)
  expect(state.hostEnvironments.at(-1)).toBe(process.env)
  expect(state.hostEnvironments.at(-1)!.SECSCAN_MCP_TOKEN).toBe('ssk_first-run-token')
  expect(state.hostEnvironments.at(-1)!.REDTEAM_UI_TOKEN).toBe('runner-first-run-token')

  // Revocation removes the document, and the environment with it, on another restart.
  expect(await state.operations!.clearMcp()).toEqual({ ok: true })
  expect(mcp.clear).toHaveBeenCalledOnce()
  expect(state.startHost).toHaveBeenCalledTimes(hostsBefore + 2)
  expect(state.hostEnvironments.at(-1)!.SECSCAN_MCP_TOKEN).toBeUndefined()

  // Leaving the step records the decision so first run does not ask again.
  await state.operations!.finishMcp()
  expect(mcp.write).toHaveBeenLastCalledWith(mcpView.storePath, expect.anything(),
    { secscan: null, seclayer: null, runner: null, endpoint: null }, true)
})
