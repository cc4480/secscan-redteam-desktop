import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'
/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager } from './project-manager.ts'
import { DesktopHostFatalError, DesktopHostProcess, DesktopHostUncleanExitError } from './host-process.ts'
import { DesktopPlatformView, PLATFORM_IPC, platformBounds } from './platform-view.ts'
import { installDesktopDirectoryPicker } from './directory-picker.ts'
import { installMicrophonePermissions } from './microphone-permissions.ts'
import { DesktopBackendController } from './backend-controller.ts'
import { DESKTOP_IPC, SCHEME, assertDesktopSender, type DesktopUpdateState } from './ipc.ts'
import { formatDesktopMessage, resolveDesktopLocale, resolveDesktopStartupLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { serveWebDocument, authenticateWebHost, forwardWebRequest } from './web-document.ts'
import { DesktopFatalRecovery } from './fatal-recovery.ts'
import { pruneCrashReports, RendererConsoleTail, writeCrashReport, type CrashReportSource } from './crash-report.ts'
import { openWelcomeWindow } from './welcome-window.ts'
import { WELCOME_IPC, needsWelcome, type WelcomeMcpState, type WelcomePage } from './welcome-api.ts'
import { connectDesktopWelcome, type DesktopWelcomeBackend } from './welcome-backend.ts'
import {
  DEFAULT_REDTEAM_MCP_URL,
  MCP_TOKEN_NAMES,
  clearStoredMcpCredentials,
  loadStoredMcpCredentials,
  mcpCredentialFile,
  mcpSetupRequired,
  McpPlaintextRefusedError,
  normalizeMcpCredentialDraft,
  plainMcpSecretProtector,
  readStoredMcpCredentials,
  writeStoredMcpCredentials,
  type McpEnvironmentName,
  type McpSecretProtector,
  type StoredMcpCredentials,
} from './mcp-credentials.ts'
import { DesktopUpdateJournal } from './update-journal.ts'
import { DesktopRedteamRunner, redteamRunnerResources } from './redteam-runner.ts'
import { provisionArsenalIndex } from './arsenal-provisioning.ts'
import { DesktopMetasploit, findMetasploitHome } from './redteam-msf.ts'
import { runRunnerReadiness } from './readiness.ts'
import { probeMcpServers } from './mcp-server-status.ts'
import { DesktopUpdatePreparationError } from './update-error.ts'
import { DesktopUpdateSchedule, resolveDesktopUpdateScheduleConfig } from './update-schedule.ts'
import { desktopUpdateErrorSummary, presentDesktopUpdate } from './update-presentation.ts'
import { desktopErrorState } from './startup-error.ts'
import { DesktopMandatoryUpdatePolicy, resolveDesktopPolicyConfig, type DesktopPolicyState } from './mandatory-update-policy.ts'
import { DesktopMandatoryUpdateWindow } from './mandatory-update-window.ts'
import { DesktopPolicyTestAuth } from './policy-test-auth.ts'
import { DesktopUpdateDialog, type UpdateDialogOptions } from './update-dialog.ts'
import { readDesktopRuntime } from './runtime-tree.ts'
import { DesktopBrowserGuests } from './browser-guests.ts'
import { installLlamaShell } from './llama-shell.ts'

let focusPrimaryWindow = (): void => {}
let stopForRecovery = async (): Promise<void> => {}
let shuttingDown = false
let windowsLanguage: string | undefined
/** The bundled local-model feature installed for this launch; disposed on quit. */
let llamaShell: ReturnType<typeof installLlamaShell> | undefined
/**
 * Whether the backend has reached ready: false until the first ready, back to
 * false when a restart returns it to starting, frozen during shutdown so a
 * failure while tearing down a ready backend still reads as `running`.
 */
let backendReady = false
/** Where the welcome window was opened from; finishing the MCP step ends first run, or only closes it. */
type WelcomePurpose = 'onboarding' | 'mcp-settings'

/** Error-level console output of the primary window, attached to crash reports. */
const rendererConsole = new RendererConsoleTail()

// Platform-conventional logs directory (macOS ~/Library/Logs/<name>, otherwise under userData);
// set before ready so the first fatal report already resolves under it. Re-pointed at the product
// profile below, once that profile is known.
app.setAppLogsPath()

// Native dumps for renderer/GPU/utility crashes, stored beside the crash reports. Upload is off:
// an engagement machine's evidence never leaves it. A host without a working crash reporter must
// still start, so this is best effort.
try {
  crashReporter.start({ uploadToServer: false, compress: true })
} catch (error) {
  console.error('desktop crash reporter unavailable:', error)
}

function currentDesktopLocale(): ReturnType<typeof resolveDesktopLocale> {
  return resolveDesktopLocale(windowsLanguage ?? app.getLocale())
}
const recovery = new DesktopFatalRecovery({
  messages: () => currentDesktopLocale().messages,
  show: options => dialog.showMessageBox(options),
  stop: () => { shuttingDown = true; return stopForRecovery() },
  disablePlugins: async () => {
    const manager = new DesktopProjectManager(resolveDesktopPaths(), runtimeResources())
    const backupPath = await manager.disableAllPlugins()
    console.info('Desktop profile recovery completed:', { profilePatchBackup: backupPath ?? null, homePatch: 'unchanged' })
  },
  exit: () => { recordQuitReason('fatal-recovery-exit'); app.quit() },
  restart: () => { recordQuitReason('fatal-recovery-restart'); app.relaunch(); app.quit() },
  writeReport: (error, source) => persistCrashReport(error, source),
})

function persistCrashReport(error: unknown, source: CrashReportSource): Promise<string | undefined> {
  return writeCrashReport(app.getPath('logs'), {
    source,
    phase: backendReady ? 'running' : 'startup',
    error,
    ...(error instanceof DesktopHostFatalError && error.diagnostic !== undefined ? { hostDiagnostic: error.diagnostic } : {}),
    rendererConsole: rendererConsole.snapshot(),
    app: {
      name: app.name, version: app.getVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, locale: currentDesktopLocale().id,
    },
    time: new Date(),
  })
}

function reportFatal(error: unknown, source: CrashReportSource): void {
  console.error(error)
  if (shuttingDown) {
    // No dialog during shutdown, but the report still records what failed on the way out.
    void persistCrashReport(error, source)
    return
  }
  void recovery.report(error, source).catch((failure: unknown) => { console.error(failure); app.exit(1) })
}

/** Why this process is leaving. Every quit path records it before calling app.quit(). */
let quitReason = 'unknown'

/**
 * Persist the exit reason and a small state snapshot in the logs directory.
 *
 * A silent app.quit() is indistinguishable from a crash on launch — the field reports that
 * pattern, and no crash report exists because nothing crashed. Recording the reason (and what
 * the app was doing) makes the next occurrence explainable from a file instead of guesswork.
 * Best effort: a failed write must never block quitting.
 * @param reason - Stable label naming the code path that initiated the exit.
 */
function recordQuitReason(reason: string): void {
  quitReason = reason
  try {
    const file = join(app.getPath('logs'), 'quit.json')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({
      reason,
      pid: process.pid,
      at: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      version: app.getVersion(),
      argv: process.argv,
      backend: backendReady ? 'ready' : 'starting',
      localModelShell: llamaShell !== undefined,
    }, null, 2))
  } catch (error) {
    console.error('desktop quit journal: write failed', error)
  }
}

/**
 * Route process-level failures through fatal recovery.
 *
 * Electron installs no uncaughtException handler of its own: an unhandled throw in the main
 * process ends the app with a native error dialog and no crash report, which is exactly the
 * "it exits by itself and errors" pattern. Before `ready` there is no dialog to show, so the
 * report is written and the process exits non-zero instead of hanging.
 * @param error - The uncaught exception or unhandled rejection reason.
 */
function handleProcessFailure(error: unknown): void {
  console.error('desktop process failure:', error)
  if (typeof app.isReady === 'function' && !app.isReady()) {
    void persistCrashReport(error, 'main').catch(() => undefined).finally(() => { app.exit(1) })
    return
  }
  reportFatal(error, 'main')
}

// The unit tests replace `process` with a narrow stub, so install only where the event API exists.
if (typeof process.on === 'function') {
  process.on('uncaughtException', handleProcessFailure)
  process.on('unhandledRejection', handleProcessFailure)
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    codeCache: true,
  },
}])

interface RuntimeResources {
  readonly nodeBin: string
  readonly node: string
  readonly pnpm: string
  readonly dsh: string
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = process.execPath
  const nodeBin = development ? join(app.getAppPath(), 'scripts', 'node-bin') : join(process.resourcesPath, 'runtime', 'bin')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? (development ? join(app.getAppPath(), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
      : join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'))
  const dsh = (development ? process.env.DSH_DESKTOP_DSH_DIR : undefined)
    ?? (development ? join(app.getAppPath(), '.desktop-build', 'development', 'project') : join(app.getAppPath(), 'dsh'))
  return { node, nodeBin, pnpm, dsh }
}

function developmentPrimaryRuntime(): string {
  const directory = process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR
  if (directory === undefined || directory === '') {
    throw new Error('dsh desktop: DSH_DESKTOP_PRIMARY_RUNTIME_DIR is required for an unpackaged launch')
  }
  return directory
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

/**
 * Opaque chrome fallback matching the built-in sidebar palette (the resolved
 * `--dsw-static-neutral-bluish-900` / `-50` tokens). An approximation for
 * custom themes: Windows swaps in the renderer's measured palette over the
 * windowsAppearance IPC, and macOS shows it only while minimized or hidden.
 * @returns the sidebar fill hex for the active system color scheme.
 */
function chromeFallbackFill(): string {
  return nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb'
}

/**
 * Add the effective Desktop palette to a Platform authorization URL so the
 * login page opens in the application's theme. `system` resolves through
 * `nativeTheme.shouldUseDarkColors`, which follows the theme source the
 * application preload publishes.
 * @param authorizeUrl - validated Platform authorization URL.
 * @returns the authorization URL carrying `theme=light` or `theme=dark`.
 */
function platformLoginUrl(authorizeUrl: string): string {
  const url = new URL(authorizeUrl)
  url.searchParams.set('theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  return url.href
}

function createWindow(preload: string, show = false, primary = false): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    show,
    ...(process.platform === 'win32' && primary ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT, color: chromeFallbackFill(),
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115' },
    } : {}),
    // hiddenInset places traffic lights inside the sidebar; sidebar vibrancy
    // needs a transparent window background to show through the page.
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      // 'active' keeps the vibrancy material stable when the window blurs;
      // 'followWindow' washes the sidebar out behind an unfocused window.
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: primary,
      devTools: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.platform === 'darwin') {
    // macOS hides the traffic lights in fullscreen; the page drops its
    // clearance for them off the html[data-fullscreen] flag this feeds.
    const sendFullscreen = (): void => {
      if (!window.isDestroyed()) window.webContents.send(DESKTOP_IPC.windowFullscreen, window.isFullScreen())
    }
    window.on('enter-full-screen', sendFullscreen)
    window.on('leave-full-screen', sendFullscreen)
    // Reloads and navigations re-register the preload listener; resend the
    // current state so a fullscreen reload does not fall back to windowed CSS.
    window.webContents.on('did-finish-load', sendFullscreen)
    // Deminiaturize reattaches the NSVisualEffectView material late
    // (electron/electron#25368), so a transparent window shows the desktop
    // through the sidebar until then. Paint an opaque base while minimized or
    // hidden so the deminiaturize animation and the reattachment gap show a
    // solid fill; restoring flips back, and the null -> 'sidebar' transition
    // forces the material to reattach.
    const applyBackdrop = (): void => {
      if (window.isDestroyed()) return
      if (window.isMinimized() || !window.isVisible()) {
        window.setVibrancy(null)
        window.setBackgroundColor(chromeFallbackFill())
      } else {
        window.setVibrancy('sidebar')
        window.setBackgroundColor('#00000000')
      }
    }
    window.on('minimize', applyBackdrop)
    window.on('hide', applyBackdrop)
    window.on('restore', applyBackdrop)
    window.on('show', applyBackdrop)
  }
  window.webContents.on('context-menu', (_event, { isEditable, selectionText, editFlags }) => {
    const items: MenuItemConstructorOptions[] = []
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll },
      )
    } else if (selectionText.length > 0) {
      items.push({ role: 'copy', enabled: editFlags.canCopy })
    }
    // Empty accelerators suppress Electron's default shortcut labels for native roles.
    if (items.length > 0) {
      const messages = currentDesktopLocale().messages
      Menu.buildFromTemplate(items.map(item => ({
        ...item,
        ...(process.platform === 'win32' && item.role !== undefined && item.role in messages
          ? { label: messages[item.role as keyof typeof messages] } : {}),
        accelerator: '',
      }))).popup({ window })
    }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url)
    const current = new URL(window.webContents.getURL())
    if (destination.protocol !== `${SCHEME}:`
      && !(destination.protocol === 'http:' && destination.origin === current.origin)) {
      event.preventDefault()
      if (['http:', 'https:'].includes(destination.protocol)) void shell.openExternal(url)
    }
  })
  return window
}

async function main(): Promise<void> {
  void pruneCrashReports(app.getPath('logs'))
  const journalDirectory = process.env.DSH_DESKTOP_UPDATE_JOURNAL_DIR
  const updateJournal = journalDirectory === undefined ? undefined : new DesktopUpdateJournal(journalDirectory, app.getVersion())
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  const development = !app.isPackaged
  const primaryRuntime = development
    ? developmentPrimaryRuntime()
    : join(process.resourcesPath, 'runtime', 'primary-runtime')
  const activeProject = paths.profile
  const manager = new DesktopProjectManager(paths, resources)
  /**
   * The engagement engine this application ships, as a child of this process.
   *
   * It starts before the Host composes the profile because the MCP client rows read
   * their endpoint and token from the environment at that moment: a console that is
   * not listening by then leaves the engagement tools silently absent, which is the
   * failure this child exists to remove. An operator who pointed the product at their
   * own console is visible in that same environment, and there the runner stays off.
   */
  /**
   * The bundled Arsenal census seed, materialized before the runner starts.
   *
   * The runner serves the Arsenal index from this installation's userData and
   * its refresh timer first ticks a week out, so a first run with no index
   * would leave the Arsenal page on its empty-index state until then. The
   * provisioning is one existence check on every later launch, never
   * overwrites an index the installation already has, and reports its own
   * failures instead of failing the launch.
   */
  provisionArsenalIndex({
    userDataDir: app.getPath('userData'),
    location: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() },
  })
  const engagementRunner = new DesktopRedteamRunner(
    redteamRunnerResources({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      node: resources.node,
      environment: process.env,
    }),
    process.env,
    {
      // Engagement state belongs to this installation's profile - not to the resources
      // the runner is packaged in, and not to whatever directory the shell started in.
      engagementsDir: join(app.getPath('userData'), 'engagements', 'live'),
      installed: installedMcpNames,
    },
  )
  /**
   * The bundled local-model feature: its llama-server child, the IPC service the
   * manager window talks to, and the environment bridge that points the engagement
   * runner at a running local model. Installed beside the runner object above so
   * the environment it mirrors is the one the runner spawns with, and installed
   * once: only the quit path disposes it.
   */
  llamaShell = installLlamaShell({
    resources: { node: resources.node },
    environment: process.env,
    location: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() },
    ipcMain,
    windows: () => BrowserWindow.getAllWindows().map(window => window.webContents),
  })
  llamaShell.attachRunnerEnvironment(process.env)
  /**
   * The Metasploit RPC bridge this application starts when the machine already has a
   * Framework installation.
   *
   * msfrpcd is the one external dependency the product cannot ship (Framework is a
   * large, separately-licensed tree), so the operator-facing promise is narrower than
   * for the bundled tools: if Framework exists, its daemon is started on loopback with
   * a password this process generates and stopped with the app - the operator does not
   * run `msfrpcd` by hand, does not pick a port, and does not paste credentials. If it
   * does not exist, nothing is started and the readiness report keeps the Metasploit
   * items blocked; a missing optional daemon never fails the launch.
   */
  const metasploit = new DesktopMetasploit(findMetasploitHome(process.env), process.env, {})
  let quitting = false
  let startup: Promise<void> | undefined
  let workspaceRecovery: Promise<void> | undefined
  let mainWindow: BrowserWindow | undefined
  let welcomeWindow: BrowserWindow | undefined
  let enteredWorkspace = false
  let shellInstallerOwnsQuit = false
  let requireCleanStop = false
  let updateStoppedHost = false
  let updateStopFailure: DesktopHostUncleanExitError | undefined
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const systemLanguages = app.getPreferredSystemLanguages()
  let locale = resolveDesktopStartupLocale(null, systemLanguages)
  windowsLanguage = locale.id
  let mandatoryPolicy: DesktopMandatoryUpdatePolicy | undefined
  let mandatoryUI: DesktopMandatoryUpdateWindow | undefined
  let policyAuth: DesktopPolicyTestAuth | undefined
  const isQuitting = (): boolean => quitting
  const currentMainWindow = (): BrowserWindow | undefined => mainWindow
  const ordinaryDialogs = new Set<AbortController>()
  const currentDialogWindow = (): BrowserWindow | undefined => welcomeWindow ?? mainWindow
  const updateDialog = new DesktopUpdateDialog(fileURLToPath(new URL('./preload-update-dialog.cjs', import.meta.url)), () => locale)
  const isMandatory = (): boolean => mandatoryPolicy?.state.blocking === true
  const ordinaryMessageBox = async (options: UpdateDialogOptions): Promise<Electron.MessageBoxReturnValue> => {
    const controller = new AbortController()
    ordinaryDialogs.add(controller)
    try {
      const parent = currentDialogWindow()
      if (parent === undefined) return { response: options.cancelId ?? 0, checkboxChecked: false }
      return await updateDialog.show(parent, { ...options, signal: controller.signal })
    }
    finally { ordinaryDialogs.delete(controller) }
  }
  // Copy comes from the same locale as the update prompts so the dialog
  // chrome and its content never mix languages.
  const showAbout = async (): Promise<void> => {
    await ordinaryMessageBox({ type: 'info', title: locale.messages.aboutMenu, message: locale.messages.aboutProduct,
      detail: formatDesktopMessage(locale.messages.aboutVersion, { version: app.getVersion() }),
      buttons: [locale.messages.updateAcknowledge], cancelId: 0 })
  }
  /**
   * Open the MCP step as a settings surface, which is how a token is rotated or revoked later.
   * @returns completion after the window is visible.
   */
  const openMcpSettings = async (): Promise<void> => {
    if (quitting || recovery.active) return
    // The workspace is already live, so nothing follows this step.
    await showWelcome('mcp-settings', 'mcp', false)
  }
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const applicationUrl = `${SCHEME}://app/`
  let hostUrl: string | undefined
  let hostCookie: string | undefined
  const browserGuests = new DesktopBrowserGuests(() => hostUrl)
  let injections: readonly unknown[] = []
  let welcomeBackend: DesktopWelcomeBackend | undefined
  /** Where the welcome window was opened from, which decides what finishing the MCP step does. */
  let welcomePurpose: WelcomePurpose = 'onboarding'
  /** Whether the account or API-key entry still follows the MCP step in this window. */
  let welcomeAccountEntryRequired = false
  let stopAccount: (() => void) | undefined
  let openedAttempt: string | undefined
  let returnedAttempt: string | undefined
  let previousAccountStatus: string | undefined
  const assertProductSender = (event: IpcMainInvokeEvent): void => {
    assertDesktopSender(event, ['app'])
    if (mainWindow === undefined || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
      || event.senderFrame === null || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('dsh desktop: rejected IPC from an unowned renderer')
    }
  }
  let navigation: { window: BrowserWindow; url: string; promise: Promise<void> } | undefined
  const navigateMain = (url: string): Promise<void> => {
    const window = mainWindow
    if (quitting || window === undefined || window.isDestroyed()) return Promise.resolve()
    if (navigation?.window === window && navigation.url === url) return navigation.promise
    const next = { window, url, promise: Promise.resolve() }
    next.promise = window.loadURL(url).catch((error: unknown) => {
      if (quitting || shuttingDown || window.isDestroyed() || navigation !== next
        || (error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED')) return
      navigation = undefined
      throw error
    })
    navigation = next
    return next.promise
  }
  const platformView = new DesktopPlatformView(join(app.getAppPath(), 'lib', 'preload-platform-account.cjs'),
    () => locale.id === 'zh-CN' ? 'zh_CN' : 'en_US')
  const backend = new DesktopBackendController((onFailure) => {
    const hostInspectPort = developmentHostInspectPort(development)
    const host = new DesktopHostProcess(resources.node, resources.dsh, activeProject,
      hostInspectPort, process.env, onFailure,
      primaryRuntime,
      resources, (next) => { platformView.setSession(next) })
    return {
      start: async () => {
        const ready = await host.start()
        hostCookie = await authenticateWebHost(ready.url)
        hostUrl = ready.url
        if (ready.injections === undefined) throw new Error('Desktop Host did not provide boot injections')
        injections = ready.injections
        welcomeBackend = await connectDesktopWelcome(ready.url, (input, init) => net.fetch(input, init), async () => (await session.defaultSession.cookies.get({ url: ready.url })).map(cookie => `${cookie.name}=${cookie.value}`).join('; '))
        stopAccount?.()
        stopAccount = welcomeBackend.account.watch((state) => {
          if (quitting) return
          if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.webContents.send(WELCOME_IPC.state, state)
          const attempt = state.attempt
          if (attempt?.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && openedAttempt !== attempt.id) {
            openedAttempt = attempt.id
            void shell.openExternal(platformLoginUrl(attempt.authorizeUrl)).catch(() => undefined)
          }
          if ((attempt?.phase === 'failed' || attempt?.phase === 'expired') && returnedAttempt !== attempt.id) {
            returnedAttempt = attempt.id
            focusPrimaryWindow()
          }
          if (attempt?.phase === 'succeeded' && welcomeWindow !== undefined) void enterWorkspace().catch(() => undefined)
          if (previousAccountStatus === 'credential-stored' && state.status === 'signed-out') {
            void readWelcomeState().then((value) => {
              if (!value.hasApiKey && !quitting) { enteredWorkspace = false; return showWelcome('onboarding', 'entry', true) }
              return undefined
            }).catch(() => undefined)
          }
          previousAccountStatus = state.status
        }, () => {
          // The stream reconnects; a transport failure does not change account state.
        })
      },
      stop: async () => {
        try { await host.stop(requireCleanStop) }
        catch (error) {
          if (!requireCleanStop || !(error instanceof DesktopHostUncleanExitError)) throw error
          // Backend cleanup succeeded; installation still rejects the unsuccessful task teardown.
          updateStopFailure = error
        }
      },
      updateTasks: (action: 'inspect' | 'lock' | 'unlock') => host.updateTasks(action),
    }
  }, (state) => {
    if (state.phase === 'error') reportFatal(state.failure, 'host')
    else if (!shuttingDown) backendReady = state.phase === 'ready'
  })

  const updateErrors = new WeakMap<DesktopUpdateState, Promise<void>>()
  const showUpdateFailure = (state: DesktopUpdateState): Promise<void> => {
    if (state.phase !== 'error') return Promise.resolve()
    if (isMandatory()) { mandatoryUI?.sync(); return Promise.resolve() }
    let shown = updateErrors.get(state)
    if (shown === undefined) {
      shown = ordinaryMessageBox({ type: 'error', title: locale.messages.updateFailedTitle,
        message: desktopUpdateErrorSummary(state, locale.messages),
        technicalDetails: state.technicalDetails ?? state.message ?? '' }).then(() => {})
      updateErrors.set(state, shown)
    }
    return shown
  }
  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateJournal?.state(state)
    updateState = state
    mandatoryUI?.sync()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesPresentation, presentDesktopUpdate(state))
    }
    if (state.phase === 'error' && state.failedOperation !== 'check') {
      const restoreHost = state.failedOperation === 'install' && updateStoppedHost && !quitting
      shellInstallerOwnsQuit = false
      updateStoppedHost = false
      if (restoreHost) {
        // Only confirmed process exit permits replacement before another installation confirmation.
        const hostReady = backend.start(async () => {})
        startup = hostReady
        const recovery = hostReady.then(async () => {
          if (quitting) return
          // A replacement Host can have a new port, cookie, or boot injections even at the same URL.
          navigation = undefined
          await navigateMain(applicationUrl)
          if (backend.host !== undefined) updateJournal?.action('workspace-ready')
        })
        workspaceRecovery = recovery
        void recovery.catch((error: unknown) => { reportFatal(error, 'main') }).finally(() => {
          if (startup === hostReady) startup = undefined
          if (workspaceRecovery === recovery) workspaceRecovery = undefined
        })
      }
      void showUpdateFailure(state).catch((error: unknown) => { console.error(error) })
    }
    return state
  }

  const readWelcomeState = async () => {
    if (backend.host === undefined || welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
    return welcomeBackend.read()
  }
  stopForRecovery = async () => {
    // The recovery dialog restarts or exits this process; the console must go with it either way.
    await Promise.all([backend.close(), engagementRunner.stop(), metasploit.stop()])
  }

  const reconcileBackend = (): Promise<void> => {
    startup ??= (async () => {
      await navigateMain(applicationUrl)
      await backend.start(async () => {
        await manager.applyRelease()
      })
      if (backend.host !== undefined) await openInitialWindow()
      if (backend.host !== undefined) updateJournal?.action('workspace-ready')
      // The existing Web document resumes through the boot IPC response.
    })().catch((error: unknown) => {
      updateJournal?.action('workspace-failed')
      reportFatal(error, 'main')
      throw error
    }).finally(() => { startup = undefined })
    return startup
  }

  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      await workspaceRecovery
      await startup?.catch(() => undefined)
      const host = backend.host
      if (host === undefined) throw new DesktopUpdatePreparationError('tasks-unavailable', locale.messages.updateTasksUnavailable)
      const active = await host.updateTasks('inspect')
      const confirmation: Electron.MessageBoxOptions = {
        type: active ? 'warning' : 'info', title: locale.messages.updateTitle,
        message: active ? locale.messages.updateActiveTasks : formatDesktopMessage(locale.messages.updateDownloadedTitle, { version: updates.state.version ?? '' }),
        detail: active ? locale.messages.updateActiveTasksDetail
          : locale.messages.updateDownloadedDetail,
        buttons: active ? [locale.messages.updateStopTasks, locale.messages.updateLater] : [locale.messages.installAndRestart],
        defaultId: 1, cancelId: 1,
      }
      if (isMandatory()) {
        if (!await mandatoryUI?.confirm(updates.state.version ?? '', active)) return false
      } else {
        const parent = currentDialogWindow()
        if (parent === undefined) return false
        const result = await updateDialog.show(parent, confirmation)
        if (result.response !== 0 || isMandatory()) return false
      }
      if (backend.host !== host) throw new DesktopUpdatePreparationError('tasks-unavailable', locale.messages.updateTasksUnavailable)
      try {
        const stillActive = await host.updateTasks('lock')
        if (stillActive && !active) throw new DesktopUpdatePreparationError('tasks-changed', locale.messages.updateTasksChanged)
        mandatoryUI?.preparingRestart(stillActive)
        requireCleanStop = true
        updateStopFailure = undefined
        await backend.stop()
        updateStoppedHost = true
        // The backend's async cleanup callback can assign this after the reset above.
        const stopFailure = updateStopFailure as DesktopHostUncleanExitError | undefined
        if (stopFailure !== undefined) throw new DesktopUpdatePreparationError('stop-failed', locale.messages.updateStopFailed, stopFailure.message)
        updateJournal?.action('install-confirmed')
        shellInstallerOwnsQuit = true
      } catch (error) {
        if (!updateStoppedHost) await host.updateTasks('unlock').catch((unlockError: unknown) => { console.error(unlockError) })
        throw error
      } finally {
        requireCleanStop = false
      }
      return true
    },
  )

  const updateSchedule = new DesktopUpdateSchedule(updates, resolveDesktopUpdateScheduleConfig(process.env))

  const downloadUpdate = async (version: string): Promise<DesktopUpdateState> => {
    updateJournal?.action('download-requested')
    const state = await updates.download(version)
    if (state.phase !== 'ready' || quitting) return state
    // Only a completed user-driven download opens this prompt; cancelling installation does not reopen it.
    return updates.install(version)
  }

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    // Shell-owned documents live in the application bundle and never pass through the Host.
    if (url.hostname === 'shell') return serveWebDocument(request, join(app.getAppPath(), 'renderer'))
    if (url.hostname === 'app') {
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
        || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
        return serveWebDocument(request, join(resources.dsh, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist'))
      }
      if (backend.host === undefined || hostUrl === undefined || hostCookie === undefined) {
        return Promise.resolve(new Response(null, { status: 503 }))
      }
      return forwardWebRequest(request, hostUrl, hostCookie)
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })

  installDesktopDirectoryPicker(() => mainWindow)
  installMicrophonePermissions(session.defaultSession, () => mainWindow?.webContents)

  ipcMain.handle(DESKTOP_IPC.boot, async (event) => {
    assertDesktopSender(event, ['app'])
    await startup
    if (backend.host === undefined || hostUrl === undefined) throw new Error('Desktop Host is unavailable')
    return { injections, streamBaseUrl: new URL(hostUrl).origin }
  })

  ipcMain.handle(DESKTOP_IPC.bootFailed, (event, message: unknown) => {
    assertDesktopSender(event, ['app'])
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('dsh desktop: rejected startup failure from a non-primary frame')
    }
    if (typeof message !== 'string') throw new Error('dsh desktop: startup failure must be text')
    reportFatal(new Error(message), 'web-boot')
  })

  ipcMain.handle(DESKTOP_IPC.browserAcquire, (event, workspace: unknown) => {
    assertProductSender(event)
    return browserGuests.acquire(event.sender, workspace)
  })
  ipcMain.handle(DESKTOP_IPC.browserRelease, (event, lease: unknown) => {
    assertProductSender(event)
    return browserGuests.release(event.sender, lease)
  })

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    if (hostUrl === undefined || hostCookie === undefined || details.webContentsId !== mainWindow?.webContents.id) {
      callback({})
      return
    }
    const target = new URL(hostUrl)
    const requested = new URL(details.url)
    if (requested.host !== target.host) { callback({}); return }
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
    if (headers.origin !== 'dsh-app://app') { callback({ cancel: true }); return }
    callback({ requestHeaders: { ...headers, origin: target.origin, cookie: hostCookie, 'sec-fetch-site': 'same-origin' } })
  })

  const assertMainApplication = (event: IpcMainInvokeEvent): BrowserWindow => {
    const owner = mainWindow
    if (owner === undefined || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame
      || !event.senderFrame.url.startsWith('dsh-app://app/')) throw new Error('Rejected Platform command')
    return owner
  }
  ipcMain.on(PLATFORM_IPC.bootstrap, (event) => {
    try { event.returnValue = platformView.bootstrap(event) }
    catch { event.returnValue = null }
  })
  ipcMain.handle(PLATFORM_IPC.open, (event, page: unknown, bounds: unknown) => {
    const owner = assertMainApplication(event)
    if (page !== 'usage' && page !== 'top-up') throw new Error('Invalid Platform page')
    return platformView.open(owner, page, platformBounds(bounds))
  })
  ipcMain.handle(PLATFORM_IPC.bounds, (event, bounds: unknown) => {
    assertMainApplication(event)
    platformView.setBounds(platformBounds(bounds))
  })
  ipcMain.handle(PLATFORM_IPC.close, (event) => { assertMainApplication(event); platformView.close() })
  // Only the main window may synchronize its palette with the native material.
  ipcMain.on(DESKTOP_IPC.nativeThemeSet, (event, source: unknown) => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) return
    if (source === 'light' || source === 'dark' || source === 'system') nativeTheme.themeSource = source
  })
  ipcMain.handle(DESKTOP_IPC.localeBootstrap, async (event) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== new URL(applicationUrl).origin) {
      throw new Error('desktop welcome: rejected locale request from an unowned frame')
    }
    if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
    return { languages: systemLanguages, preference: await welcomeBackend.readLocalePreference() }
  })
  ipcMain.on(DESKTOP_IPC.localeChanged, (event, next: unknown) => {
    const window = mainWindow
    if (window === undefined || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || typeof next !== 'string') return
    const current = resolveDesktopStartupLocale(next, systemLanguages)
    if (current.id === locale.id) return
    locale = current
    platformView.notifyLocaleChanged()
    windowsLanguage = locale.id
    installMenu()
  })
  ipcMain.handle(DESKTOP_IPC.updatesStatus, (event) => {
    assertProductSender(event)
    return presentDesktopUpdate(updates.state)
  })
  ipcMain.handle(DESKTOP_IPC.updatesOpen, async (event) => {
    assertProductSender(event)
    await openUpdatePrompt()
  })

  let promptOperation: Promise<void> | undefined
  let policyAuthenticationQueued = false
  const openUpdatePrompt = (manual = false): Promise<void> => {
    if (authenticationOperation !== undefined) {
      policyAuth?.focus(); updateDialog.focus()
    }
    let failedOperation: 'check' | 'download' | 'install' = 'check'
    promptOperation ??= Promise.resolve().then(async () => {
      if (manual) updateJournal?.action('check-requested')
      const joinedPolicyAuthentication = authenticationOperation !== undefined
      if (joinedPolicyAuthentication) await authenticatePolicy()
      if (isMandatory()) {
        mandatoryUI?.focus()
        if (manual) await Promise.all([checkPolicyManually(), updateSchedule.check(true)])
        return
      }
      let controller: AbortController | undefined
      let progress: Promise<unknown> | undefined
      try {
        let state = updates.state
        if (manual || state.phase === 'idle' || (state.phase === 'error' && state.failedOperation === 'check')) {
          controller = new AbortController()
          ordinaryDialogs.add(controller)
          const parent = currentDialogWindow()
          progress = parent === undefined ? Promise.resolve() : updateDialog.show(parent, { type: 'info', title: locale.messages.updateCheckTitle,
            message: locale.messages.updateChecking, buttons: [locale.messages.later], cancelId: 0, signal: controller.signal })
          if (!joinedPolicyAuthentication) {
            void checkPolicyManually('deferred').catch((error: unknown) => { console.error(error) })
          }
          state = await updateSchedule.check(true)
        }
        if (isMandatory()) { mandatoryUI?.focus(); return }
        if (state.phase === 'error' && state.failedOperation === 'check') { await showUpdateFailure(state); return }
        if (state.phase === 'idle') {
          await ordinaryMessageBox({ type: 'info', title: locale.messages.updateCheckTitle,
            message: formatDesktopMessage(locale.messages.updateCurrent, { version: app.getVersion() }) })
          return
        }
        if (state.phase === 'ready' || (state.phase === 'error' && state.failedOperation === 'install')) {
          if (state.version !== undefined) {
            failedOperation = 'install'
            await showUpdateFailure(await updates.install(state.version))
          }
          return
        }
        if (state.phase !== 'available' && !(state.phase === 'error' && state.failedOperation === 'download')) return
        if (manual) {
          const result = await ordinaryMessageBox({ title: locale.messages.updateCheckTitle, message: locale.messages.updateAvailable,
            detail: formatDesktopMessage(locale.messages.updateDetail, { version: state.version ?? '' }),
            buttons: [locale.messages.updateDownload], cancelId: 1 })
          if (result.response !== 0) return
        }
        if (!isMandatory() && state.version !== undefined) {
          controller?.abort()
          failedOperation = 'download'
          await showUpdateFailure(await downloadUpdate(state.version))
        }
      } finally {
        controller?.abort()
        if (controller !== undefined) ordinaryDialogs.delete(controller)
        await progress
      }
    }).catch((error: unknown) => showUpdateFailure({ phase: 'error', failedOperation,
      message: desktopErrorState(error).message }))
      .finally(() => { promptOperation = undefined; flushQueuedPolicyAuthentication() })
    return promptOperation
  }

  let authenticationOperation: Promise<DesktopPolicyState | undefined> | undefined
  const authenticatePolicy = () => {
    if (authenticationOperation !== undefined) { policyAuth?.focus(); updateDialog.focus() }
    authenticationOperation ??= runPolicyAuthentication().finally(() => { authenticationOperation = undefined })
    return authenticationOperation
  }
  const flushQueuedPolicyAuthentication = (): void => {
    if (!policyAuthenticationQueued || promptOperation !== undefined || authenticationOperation !== undefined
      || isMandatory() || quitting) return
    policyAuthenticationQueued = false
    void authenticatePolicy().catch((error: unknown) => { console.error(error) })
  }
  const queuePolicyAuthentication = (): void => {
    if (authenticationOperation !== undefined) {
      policyAuth?.focus(); updateDialog.focus()
      return
    }
    policyAuthenticationQueued = true
    flushQueuedPolicyAuthentication()
  }
  const runPolicyAuthentication = async () => {
    if (policyAuth === undefined || mandatoryPolicy === undefined || quitting) return undefined
    const parent = mandatoryUI?.confirmationWindow ?? currentDialogWindow()
    if (parent === undefined) return undefined
    const consent = await updateDialog.show(parent, { type: 'info', title: locale.messages.policyLoginTitle,
      message: locale.messages.policyLoginRequired, buttons: [locale.messages.policyLogin, locale.messages.later], cancelId: 1 })
    if (consent.response !== 0 || isQuitting()) return undefined
    const outcome = await policyAuth.login()
    if (isQuitting() || outcome === 'cancelled') return undefined
    if (outcome === 'failed') {
      await updateDialog.show(parent, { type: 'error', title: locale.messages.policyLoginTitle,
        message: locale.messages.policyLoginFailed, buttons: [locale.messages.updateAcknowledge], cancelId: 0 })
      return undefined
    }
    // Drain a pre-login request before asking the server to evaluate the new cookies.
    await mandatoryPolicy.check('login-return')
    if (isQuitting()) return undefined
    return mandatoryPolicy.check('login-return', true)
  }

  const checkPolicyManually = async (authentication: 'immediate' | 'deferred' = 'immediate') => {
    if (authenticationOperation !== undefined) return authenticatePolicy()
    const policy = await mandatoryPolicy?.check('manual', true)
    if (policy?.error !== 'authentication-required') return policy
    if (authentication === 'immediate') return authenticatePolicy()
    queuePolicyAuthentication()
    return policy
  }

  const automaticCheck = (): void => {
    if (!quitting) void mandatoryPolicy?.check('foreground-or-resume').catch((error: unknown) => { console.error(error) })
    if (!quitting) void updateSchedule.check().catch((error: unknown) => { console.error(error) })
  }
  powerMonitor.on('resume', automaticCheck)
  app.on('will-quit', () => {
    updateSchedule.dispose()
    powerMonitor.off('resume', automaticCheck)
    updates.dispose()
    // The llama-server child must not outlive the application that owns its port.
    void llamaShell?.dispose()
  })

  app.setAboutPanelOptions({
    applicationName: 'SecScan RedTeam',
    applicationVersion: app.getVersion(),
    // The release has no separate build number; omit Electron's bundle version.
    version: '',
    copyright: '',
    iconPath: development ? join(app.getAppPath(), 'resources', 'icon-windows.png')
      : join(process.resourcesPath, 'icon.png'),
  })
  // A custom application menu replaces Electron's default menu, so macOS needs
  // its standard menus and application hide commands declared explicitly.
  // Keep app.name stable: Electron derives its default userData directory from it.
  const darwin = process.platform === 'darwin'
  const platformMenus: MenuItemConstructorOptions[] = darwin
    ? [{ role: 'fileMenu' }, { role: 'windowMenu' }]
    : []
  const hideCommands: MenuItemConstructorOptions[] = darwin
    ? [{ role: 'hide', label: currentDesktopLocale().messages.hideApplication },
      { role: 'hideOthers', label: currentDesktopLocale().messages.hideOtherApplications },
      { role: 'unhide', label: currentDesktopLocale().messages.showAllApplications }, { type: 'separator' }]
    : []
  const applicationItems = (): MenuItemConstructorOptions[] => [
    // Windows has no system About panel; Electron's fallback is a plain
    // message box, so the shell shows its own dimmed dialog instead.
    process.platform === 'win32'
      ? { label: currentDesktopLocale().messages.aboutMenu,
        click: () => { void showAbout().catch((error: unknown) => { console.error(error) }) } }
      : { label: currentDesktopLocale().messages.aboutMenu, role: 'about' },
    { type: 'separator' },
    { label: currentDesktopLocale().messages.checkUpdatesMenu, click: () => { void openUpdatePrompt(true) } },
    {
      label: currentDesktopLocale().messages.mcpSettingsMenu,
      click: () => { void openMcpSettings().catch((error: unknown) => { console.error(error) }) },
    },
    // Local models: the bundled llama.cpp manager the shell owns (window, server, IPC).
    {
      label: 'Local models...',
      click: () => { void llamaShell?.openWindow().catch((error: unknown) => { console.error(error) }) },
    },
    ...development ? [
      { type: 'separator' as const },
      { label: currentDesktopLocale().messages.reloadPageMenu, role: 'reload' as const },
      { label: currentDesktopLocale().messages.restartAppHostMenu, click: () => {
        if (quitting) return
        app.relaunch()
        app.quit()
      } },
    ] : [],
    { type: 'separator' },
    ...hideCommands,
    { role: 'quit', ...(darwin ? { label: currentDesktopLocale().messages.quitApplication }
      : process.platform === 'win32' ? { label: currentDesktopLocale().messages.exitApplication } : {}) },
  ]
  const devToolsItems: MenuItemConstructorOptions[] = [
    { role: 'toggleDevTools', visible: false },
    { role: 'toggleDevTools', visible: false, accelerator: 'F12' },
  ]
  const installMenu = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform === 'win32' ? devToolsItems : [{
      label: darwin ? app.name : currentDesktopLocale().messages.application,
      submenu: [...applicationItems(), ...devToolsItems],
    }, ...platformMenus]))
  }
  installMenu()

  if (process.platform === 'win32') {
    ipcMain.handle(DESKTOP_IPC.windowsMenu, (event, name: unknown, x: unknown, y: unknown) => {
      assertDesktopSender(event, ['app'])
      if (mainWindow === undefined || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('desktop menu: rejected sender')
      if (name !== 'application'
        || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || y < 0 || x > 100_000 || y > 100_000) throw new Error('desktop menu: invalid popup request')
      const window = mainWindow
      const items: MenuItemConstructorOptions[] = applicationItems()
      const zoom = mainWindow.webContents.getZoomFactor()
      return new Promise<void>((resolve) => {
        Menu.buildFromTemplate(items).popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: resolve })
      })
    })
    ipcMain.on(DESKTOP_IPC.windowsAppearance, (event, language: unknown, color: unknown, symbolColor: unknown) => {
      if (mainWindow === undefined || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame) return
      if (!event.senderFrame.url.startsWith(`${SCHEME}://app/`)) return
      if (typeof language === 'string' && /^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/u.test(language)) {
        windowsLanguage = language
      }
      // Empty colors precede client stylesheet installation; only CSS color values cross IPC.
      const validColor = (value: unknown): value is string => typeof value === 'string'
        && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(value)
      if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({ color, symbolColor })
    })
  }

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload, false, true)
    mainWindow = window
    browserGuests.bind(window)
    window.on('focus', automaticCheck)
    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
    window.webContents.on('console-message', (details) => {
      if (details.level !== 'error') return
      rendererConsole.push(`${details.sourceId}:${String(details.lineNumber)} ${details.message}`)
    })
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && !quitting && !window.isDestroyed()) {
        reportFatal(new Error(`Desktop page failed to load: ${url} (${String(code)}: ${description})`), 'renderer')
      }
    })
    window.webContents.on('preload-error', (_event, _path, error) => {
      if (!quitting && !window.isDestroyed()) reportFatal(error, 'renderer')
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      navigation = undefined
      if (!quitting && !window.isDestroyed() && details.reason !== 'clean-exit') {
        reportFatal(new Error(`Desktop renderer exited: ${details.reason}`), 'renderer')
      }
    })
    return window
  }
  const enterWorkspace = async (): Promise<void> => {
    if (quitting) return
    const window = mainWindow ?? createMainWindow()
    await navigateMain(applicationUrl)
    if (isQuitting() || recovery.active || window.isDestroyed()) return
    window.show()
    enteredWorkspace = true
    if (welcomeWindow !== undefined) {
      welcomeWindow.close()
      window.webContents.send(DESKTOP_IPC.enterWorkspace)
    }
    welcomeWindow = undefined
    if (development && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  }
  let openingWelcome: Promise<void> | undefined
  /** Masked MCP state for the setup window; built from the document and the environment, never from a value. */
  const welcomeMcpState = (): Omit<WelcomeMcpState, 'servers'> => ({
    required: mcpSetupRequired(process.env, storedMcpCredentials, engagementRunner.consoleEnvironmentNames),
    entryRequired: welcomeAccountEntryRequired,
    endpoint: process.env.REDTEAM_MCP_URL ?? storedMcpCredentials.values.REDTEAM_MCP_URL ?? DEFAULT_REDTEAM_MCP_URL,
    storePath: mcpCredentialPath,
    stored: storedMcpCredentials.exists,
    fingerprints: storedMcpCredentials.fingerprints,
    // A token this process minted for the bundled console is not an operator's environment
    // value, so the step must not present it as one - and must still ask for a missing one.
    fromEnvironment: MCP_TOKEN_NAMES.filter(name => !installedMcpNames.has(name)
      && !engagementRunner.consoleEnvironmentNames.has(name) && (process.env[name] ?? '') !== ''),
  })
  /**
   * Restart the Host so it composes the profile with the credentials just stored.
   * The MCP rows are built while cordis composes the profile, so a Host that is
   * already running keeps the tools it started with.
   * @returns whether the replacement Host is ready and the application document reloaded.
   */
  const restartWorkspaceHost = async (): Promise<boolean> => {
    try {
      await backend.stop()
      navigation = undefined
      await backend.start(async () => { await manager.applyRelease() })
      await navigateMain(applicationUrl)
      return true
    } catch {
      // The backend publishes the failure with its own diagnostics; this line must carry no credential.
      console.warn('desktop mcp credentials: the Host could not be restarted with the new credentials')
      return false
    }
  }
  /**
   * Start the bundled console again after a credential change redefined it.
   * Callers stop the supervisor before reloading the credential document: the
   * supervisor installed the running console's endpoint and token in the
   * environment itself, not through the document, so the loader leaves both
   * names untouched while they stand, and only the stop empties them for the
   * stored values to install into. The start then applies the same launch
   * rules as a fresh launch - a stored endpoint suppresses the bundled
   * console, a stored token is reused by the restarted one.
   * @returns whether the supervisor settled without a startup failure.
   */
  const restartBundledRunner = async (): Promise<boolean> => {
    try {
      await engagementRunner.start()
      return true
    } catch {
      // The document already holds the new values, so the next launch retries the
      // start with its own failure surface; this line must carry no credential.
      console.warn('desktop mcp credentials: the bundled console could not be restarted with the new credentials')
      return false
    }
  }
  /**
   * Open the welcome window for first run or for MCP access changes.
   * @param purpose - first run, or the settings surface that leaves the workspace live.
   * @param startPage - page the window opens on.
   * @param accountEntry - whether the account or API-key entry follows the MCP step.
   * @returns completion after the native window is visible.
   */
  const showWelcome = (purpose: WelcomePurpose, startPage: WelcomePage, accountEntry: boolean): Promise<void> => {
    if (quitting) return Promise.resolve()
    welcomePurpose = purpose
    welcomeAccountEntryRequired = accountEntry
    if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) {
      welcomeWindow.show()
      welcomeWindow.focus()
      return Promise.resolve()
    }
    openingWelcome ??= (async () => {
      welcomeWindow = await openWelcomeWindow(locale, {
        startSignIn: async () => {
          if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
          return welcomeBackend.account.start(locale.id)
        },
        cancelSignIn: async (id) => {
          if (welcomeBackend === undefined) throw new Error('desktop welcome: backend unavailable')
          return welcomeBackend.account.cancel(id)
        },
        copySignInLink: async (id) => {
          const state = await welcomeBackend?.account.state()
          if (state?.attempt?.id !== id || state.attempt.phase !== 'waiting-browser' || state.attempt.authorizeUrl === undefined) {
            throw new Error('desktop welcome: login link is unavailable')
          }
          await clipboard.writeText(platformLoginUrl(state.attempt.authorizeUrl))
        },
        saveApiKey: async (apiKey) => {
          if (backend.host === undefined || welcomeBackend === undefined) return { ok: false }
          const saved = await welcomeBackend.save(apiKey)
          if (!saved.ok) return saved
          await enterWorkspace()
          return { ok: true }
        },
        skip: enterWorkspace,
        readMcp: async () => {
          const state = welcomeMcpState()
          // Per-row status is probed live on every read, from the same effective
          // values the MCP rows compose from, so a dead, rejected, or tools-less
          // server is visible on this surface instead of only in the Host log.
          const servers = await probeMcpServers({
            secscanToken: process.env.SECSCAN_MCP_TOKEN ?? storedMcpCredentials.values.SECSCAN_MCP_TOKEN,
            seclayerKey: process.env.SECLAYER_API_KEY ?? storedMcpCredentials.values.SECLAYER_API_KEY,
            runnerEndpoint: state.endpoint,
            runnerToken: process.env.REDTEAM_UI_TOKEN ?? storedMcpCredentials.values.REDTEAM_UI_TOKEN,
            bridgeUrl: process.env.PC_BRIDGE_URL,
            bridgeTokenFile: process.env.PC_BRIDGE_TOKEN_FILE,
          })
          return { ...state, servers }
        },
        saveMcp: async (input) => {
          const draft = normalizeMcpCredentialDraft(input)
          if (draft === undefined) return { ok: false }
          try {
            if (!await writeStoredMcpCredentials(mcpCredentialPath, desktopMcpSecretProtector(), draft)) return { ok: false }
          } catch (error) {
            // On Windows without an OS credential store the store refuses to persist plaintext;
            // keep the refusal actionable in the log instead of surfacing as an IPC failure.
            if (!(error instanceof McpPlaintextRefusedError)) throw error
            console.error(`[desktop] MCP credentials were not saved: ${error.message}`)
            return { ok: false }
          }
          // A draft that redefines the console takes effect in this session only if
          // the bundled supervisor re-runs; while it runs, its own endpoint and token
          // occupy the names the stored values would install into.
          const redefineRunner = (draft.runner !== null || draft.endpoint !== null)
            && engagementRunner.consoleEnvironmentNames.size > 0
          if (redefineRunner) await engagementRunner.stop()
          storedMcpCredentials = await loadStoredMcpCredentials(
            process.env, mcpCredentialPath, desktopMcpSecretProtector(), installedMcpNames,
          )
          const runnerRestarted = !redefineRunner || await restartBundledRunner()
          const hostRestarted = await restartWorkspaceHost()
          return hostRestarted && runnerRestarted ? { ok: true } : { ok: false }
        },
        clearMcp: async () => {
          if (!await clearStoredMcpCredentials(mcpCredentialPath)) return { ok: false }
          // Removal deletes the console names from the document too, so a running
          // bundled console restarts under the same rule as a redefining save.
          const redefineRunner = engagementRunner.consoleEnvironmentNames.size > 0
          if (redefineRunner) await engagementRunner.stop()
          storedMcpCredentials = await loadStoredMcpCredentials(
            process.env, mcpCredentialPath, desktopMcpSecretProtector(), installedMcpNames,
          )
          if (redefineRunner) await restartBundledRunner()
          await restartWorkspaceHost()
          return { ok: true }
        },
        finishMcp: async () => {
          // Record the decision so first run does not ask again; anything already stored is preserved.
          if (!MCP_TOKEN_NAMES.some(name => storedMcpCredentials.values[name] !== undefined)) {
            try {
              const protector = desktopMcpSecretProtector()
              if (await writeStoredMcpCredentials(mcpCredentialPath, protector,
                { secscan: null, seclayer: null, runner: null, endpoint: null }, true)) {
                storedMcpCredentials = await readStoredMcpCredentials(mcpCredentialPath, protector)
              }
            } catch (error) {
              // "Continue without MCP" must always be able to advance. The record is a
              // convenience (do not ask again), so a refusal to persist it is not fatal.
              if (!(error instanceof McpPlaintextRefusedError)) throw error
              console.warn(`[desktop] continuing without MCP: ${error.message}`)
            }
          }
          if (welcomePurpose === 'mcp-settings') {
            if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.close()
            return
          }
          await enterWorkspace()
        },
        readiness: async () => {
          // Tool readiness is read from the bundled runner's own `doctor`, the same
          // report an operator would run at a terminal, so the first-run panel cannot
          // drift from what the runner will actually refuse or block on.
          const runner = redteamRunnerResources({
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            node: resources.node,
            environment: process.env,
          })
          return runRunnerReadiness({ node: resources.node, runnerDirectory: runner.directory, env: process.env })
        },
      }, startPage)
      const window = welcomeWindow
      window.once('closed', () => {
        void welcomeBackend?.account.state().then((state) => {
          if (state.attempt !== null && !enteredWorkspace) return welcomeBackend?.account.cancel(state.attempt.id)
          return undefined
        }).catch(() => undefined)
      })
      window.once('closed', () => {
        if (welcomeWindow === window) welcomeWindow = undefined
        if (!enteredWorkspace && !recovery.active) mainWindow?.close()
      })
      // First run owns the window; the settings surface leaves a live workspace behind it.
      if (isQuitting() || recovery.active || (purpose === 'onboarding' && enteredWorkspace)) window.close()
      else if (purpose === 'onboarding') mainWindow?.hide()
    })().finally(() => { openingWelcome = undefined })
    return openingWelcome
  }
  const openInitialWindow = async (): Promise<void> => {
    if (quitting || recovery.active) return
    const state = await readWelcomeState()
    if (isQuitting() || backend.state.phase !== 'ready') return
    locale = resolveDesktopStartupLocale(state.localePreference, systemLanguages)
    windowsLanguage = locale.id
    installMenu()
    const accountEntry = needsWelcome({ loggedIn: state.loggedIn, hasApiKey: state.hasApiKey })
    // First-run MCP access is asked for even on a machine that already signs in: without it the
    // mcp__* tools are absent and nothing else in the product would say why.
    const mcpEntry = mcpSetupRequired(process.env, storedMcpCredentials, engagementRunner.consoleEnvironmentNames)
    if (!enteredWorkspace && (accountEntry || mcpEntry)) {
      await showWelcome('onboarding', mcpEntry ? 'mcp' : 'entry', accountEntry)
    } else {
      await enterWorkspace()
    }
  }
  focusPrimaryWindow = () => {
    if (quitting) return
    if (isMandatory()) { mandatoryUI?.focus(); return }
    const window = welcomeWindow ?? mainWindow
    if (window === undefined || window.isDestroyed()) {
      try { createMainWindow() } catch (error) { reportFatal(error, 'main'); return }
      void (backend.state.phase === 'ready' ? openInitialWindow() : navigateMain(applicationUrl)).catch((error: unknown) => { reportFatal(error, 'main') })
      return
    }
    // Startup and sign-out select the visible window before activation may reveal the workspace.
    if (window === mainWindow && !enteredWorkspace) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  if (app.isPackaged || process.env.DSH_DESKTOP_DEV_APP === '1') app.setAsDefaultProtocolClient('dsh')
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (url === 'dsh://open' || url === 'dsh://open/') focusPrimaryWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
    // A closed window must not end the process: running engagements, the local
    // model server and the backend all outlive the UI, and an RDP session drop
    // closes the window on a headless VM. Reopening the app (or activating it)
    // recreates the window through focusPrimaryWindow. Operators who want the
    // old quit-on-close behavior set DSH_DESKTOP_QUIT_ON_WINDOW_CLOSE=1.
    if (process.env.DSH_DESKTOP_QUIT_ON_WINDOW_CLOSE !== '1') {
      recordQuitReason('window-all-closed-kept-alive')
      return
    }
    recordQuitReason('window-all-closed')
    app.quit()
  })
  app.on('before-quit', (event) => {
    shuttingDown = true
    if (quitReason === 'unknown') recordQuitReason('before-quit')
    updateJournal?.action('quit-requested')
    if (shellInstallerOwnsQuit) {
      updateDialog.dispose()
      mandatoryUI?.dispose()
      return
    }
    if (quitting) return
    event.preventDefault()
    quitting = true
    stopAccount?.()
    if (welcomeWindow !== undefined && !welcomeWindow.isDestroyed()) welcomeWindow.hide()
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.hide()
    updateSchedule.dispose()
    updateDialog.dispose()
    mandatoryUI?.dispose()
    void Promise.all([
      Promise.resolve(mandatoryPolicy?.dispose()).then(() => policyAuth?.dispose()),
      backend.close(),
      // The engagement engine is a child of this process: it must not outlive the window it serves.
      engagementRunner.stop(),
      // Same for the optional RPC daemon; a stopped console must not leave it holding a port.
      metasploit.stop(),
    ])
      .catch((error: unknown) => { console.error(error) }).finally(() => { app.quit() })
  })

  mainWindow = createMainWindow()
  const manifest: unknown = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8'))
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop policy: invalid application manifest')
  const developmentPolicy = app.isPackaged ? undefined : process.env.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG
  const policyInput: unknown = app.isPackaged
    ? ('dshMandatoryUpdatePolicy' in manifest ? manifest.dshMandatoryUpdatePolicy : undefined)
    : developmentPolicy === undefined ? undefined : JSON.parse(developmentPolicy) as unknown
  const policyConfig = resolveDesktopPolicyConfig(policyInput, !app.isPackaged)
  if (policyConfig !== undefined) {
    if (policyConfig.authentication === 'feishu-test') {
      policyAuth = new DesktopPolicyTestAuth(policyConfig.origin, policyConfig.allowedAuthOrigins, locale,
        () => mandatoryUI?.confirmationWindow ?? currentDialogWindow(),
        (event) => { console.info(`desktop policy authentication: ${event}`); updateJournal?.action(`policy-login-${event}`) })
    }
    const bundleId = app.isPackaged
      ? ('dshDesktopAppId' in manifest ? manifest.dshDesktopAppId : undefined)
      : process.env.DSH_DESKTOP_APP_ID
    if (typeof bundleId !== 'string' || bundleId.trim() === '') throw new Error('desktop policy: missing application bundle ID')
    if (!['win32', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('desktop policy: unsupported platform')
    let wasBlocking = false
    mandatoryPolicy = new DesktopMandatoryUpdatePolicy(policyConfig, {
      platform: process.platform as 'win32' | 'darwin', arch: process.arch as 'x64' | 'arm64',
      version: app.getVersion(), bundledDshVersion: app.isPackaged ? readDesktopRuntime(resources.dsh).release.version : app.getVersion(),
      bundleId, locale: locale.id,
    }, (state) => {
      if (state.error !== 'authentication-required') policyAuthenticationQueued = false
      if (state.blocking) {
        for (const controller of ordinaryDialogs) controller.abort()
        if (!wasBlocking) updateDialog.cancel()
      }
      mandatoryUI?.sync()
      if (state.blocking && !wasBlocking) void updateSchedule.check(false, true).catch((error: unknown) => { console.error(error) })
      wasBlocking = state.blocking
    }, policyAuth?.request)
    const policy = mandatoryPolicy
    mandatoryUI = new DesktopMandatoryUpdateWindow({
      preload: fileURLToPath(new URL('./preload-mandatory.cjs', import.meta.url)), locale,
      allowedPageOrigins: policyConfig.allowedPageOrigins, parent: () => mainWindow,
      policy: () => policy.state, update: () => updates.state,
      refresh: async () => { await Promise.all([checkPolicyManually(), updateSchedule.check(true)]) },
      download: downloadUpdate, install: version => updates.install(version),
    })
    void mandatoryPolicy.check('launch').then((state) => {
      if (app.isPackaged && state.error === 'authentication-required' && !isQuitting()) queuePolicyAuthentication()
    }).catch((error: unknown) => { console.error(error) })
  }
  // Before the Host exists: the MCP rows read their endpoint and token while cordis composes
  // the profile, and a console that is not listening yet would leave the engagement tools
  // silently absent. A console that cannot start is a startup failure this build shows,
  // not something an operator has to infer from missing tools.
  //
  // The optional msfrpcd goes first: the runner child inherits this process's environment at
  // spawn time, so a daemon started after it would leave the Metasploit items blocked for the
  // whole engagement. A Framework install that cannot start is logged, never fatal - the
  // daemon is an enhancement, not a prerequisite for a web/host engagement.
  await metasploit.start().catch((error: unknown) => { console.error(error) })
  await engagementRunner.start()
  automaticCheck()
  await reconcileBackend().catch(() => undefined)
  // Window lifecycle callbacks run while backend startup is pending.
  if (isQuitting()) return
  const window = currentMainWindow()
  if (window !== undefined && development && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    window.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
}

// Give this build its own Electron profile instead of the package-derived one.
//
// Both desktop apps are built from this same package, so Electron derives the
// SAME userData directory (@deepseek-ai/dsh-desktop) for each of them - and
// requestSingleInstanceLock() is keyed to that directory. The two apps could
// therefore never run at the same time: whichever started second failed to
// acquire the lock and called app.quit() without printing anything, which is
// indistinguishable from a crash on launch. Keying the profile to this build's
// own application id separates them, so each app owns its own lock.
//
// Only browser-level state moves. Engagements, sessions and settings live in the
// harness home, not here, so they are untouched; a fresh profile costs only
// cache and cookies for this window.
const productProfile = ((): string | undefined => {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
    if (typeof pkg !== 'object' || pkg === null || !('dshDesktopAppId' in pkg)) return undefined
    const id = (pkg as { dshDesktopAppId?: unknown }).dshDesktopAppId
    return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined
  } catch {
    return undefined // fall back to the Electron default rather than fail to start
  }
})()
if (productProfile !== undefined) app.setPath('userData', join(app.getPath('appData'), productProfile))

// setAppLogsPath() above resolved before this profile was known, so point logs at the profile
// now: crash reports and quit.json must live beside the data they describe, not in another app's
// directory.
app.setAppLogsPath(join(app.getPath('userData'), 'logs'))

// First-run MCP credentials live in this profile's own document, so a machine that
// received the installer does not need hand-set environment variables.
//
// The MCP client rows read process.env at cordis composition time, so these values
// have to be in the environment before the single-instance claim below starts the
// runtime. Loading waits for `ready`, because the OS credential store the document
// is protected with is only available then, and it still runs before `main()` spawns
// the Host. The harness home (`~/.dsh`) is not the place for it: the two desktop
// apps share that home, and a token belongs to one installation, not to both.
//
// An environment variable that is ALREADY set always wins. Someone with a working
// setup must not be silently switched to a file, and an operator who exported a
// token for one run must not have it overridden by a leftover file.
//
// Absent is a valid state: the product deliberately starts without tokens and the
// mcp__* tools simply do not appear, so a missing or unreadable document is ignored
// rather than fatal. Values are never logged - not on success, not on failure.
/** Environment names this process took from the document, so a later rotation replaces them. */
const installedMcpNames = new Set<McpEnvironmentName>()
/** Document contents as of the last read, shared by the first-run gate and the setup window. */
let storedMcpCredentials: StoredMcpCredentials = { values: {}, fingerprints: {}, exists: false, declined: false }
/**
 * Credential document of this installation. An unpackaged run pins no product
 * profile, so the path falls back to Electron's own `userData` directory - still
 * per-user and per-application. Computing it cannot fail and no read happens
 * until `ready`, so a broken manifest still cannot stop the application from
 * starting; skipping the step instead would leave the setup flow unrunnable in
 * exactly the build a developer tests it in.
 */
const mcpCredentialPath = mcpCredentialFile(app.getPath('userData'))

/**
 * Resolve the at-rest protection for stored token values: Electron's OS credential
 * store when this host exposes one, otherwise owner-only file permission bits.
 * @returns the protector this host writes and reads with.
 */
function desktopMcpSecretProtector(): McpSecretProtector {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        kind: 'safeStorage',
        protect: value => safeStorage.encryptString(value).toString('base64'),
        unprotect: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
      }
    }
  } catch {
    // A locked or absent keyring cannot open protected values; owner-only file bits remain the protection.
  }
  return plainMcpSecretProtector
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() }, () => {
  recordQuitReason('second-instance-lock-unavailable')
  console.error('desktop single instance: another process owns the lock; this launch exits', {
    pid: process.pid, userData: app.getPath('userData'), argv: process.argv,
  })
})

if (ownsDesktopInstance) void app.whenReady().then(async () => {
  storedMcpCredentials = await loadStoredMcpCredentials(
    process.env, mcpCredentialPath, desktopMcpSecretProtector(), installedMcpNames,
  )
  return main()
}).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? message : message}\n`).catch(() => undefined)
  }
  reportFatal(error, 'main')
}).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})

