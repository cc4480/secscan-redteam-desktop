import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { needsWelcome, WELCOME_IPC } from '../src/welcome-api.ts'

const electron = vi.hoisted(() => ({
  create: vi.fn<(options: unknown) => ReturnType<typeof createWindow>>(),
  root: '/desktop-app',
  handlers: new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>(),
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => electron.root },
  BrowserWindow: vi.fn(function (options: unknown) { return electron.create(options) }),
  ipcMain: {
    handle: (name: string, handler: (event: unknown, value?: unknown) => Promise<unknown>) => {
      if (electron.handlers.has(name)) throw new Error(`duplicate IPC handler: ${name}`)
      electron.handlers.set(name, handler)
    },
    removeHandler: (name: string) => electron.handlers.delete(name),
  },
}))

const { openWelcomeWindow, welcomeWindowOptions } = await import('../src/welcome-window.ts')

function createWindow() {
  return {
    webContents: {
      mainFrame: {},
      setWindowOpenHandler: vi.fn<(handler: () => { action: string }) => void>(),
      on: vi.fn<(name: string, handler: (event: { preventDefault(): void }) => void) => void>(),
    },
    loadFile: vi.fn<(path: string) => Promise<undefined>>().mockResolvedValue(undefined),
    isDestroyed: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
    show: vi.fn(),
    once: vi.fn<(name: string, callback: () => void) => void>(),
  }
}

beforeEach(() => { electron.create.mockReset(); electron.handlers.clear() })

const operations = {
  startSignIn: async () => ({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out' as const, attempt: null }),
  cancelSignIn: async () => ({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out' as const, attempt: null }),
  copySignInLink: async () => undefined,
  saveApiKey: () => Promise.resolve({ ok: true as const }),
  skip: () => Promise.resolve(),
  readMcp: async () => ({
    required: true,
    entryRequired: true,
    endpoint: 'http://127.0.0.1:8787/mcp',
    storePath: '/profile/mcp-credentials.json',
    stored: false,
    fingerprints: {},
    fromEnvironment: [],
    servers: [],
  }),
  saveMcp: () => Promise.resolve({ ok: true as const }),
  clearMcp: () => Promise.resolve({ ok: true as const }),
  finishMcp: () => Promise.resolve(),
  readiness: () => Promise.resolve({ ok: true as const, readiness: { ok: false, summary: '', items: [] } }),
}

describe('desktop welcome window', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('keeps the %s preview fixed-size and sandboxed', (platform) => {
    const options = welcomeWindowOptions(platform, resolveDesktopLocale('zh-CN'))
    expect(options).toMatchObject({
      width: 600, height: 700, useContentSize: true, center: true, show: false,
      resizable: false, maximizable: false, fullscreenable: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        additionalArguments: ['--dsh-welcome-locale=zh-CN'],
      },
    })
    expect(options.webPreferences?.preload).toMatch(/preload-welcome\.cjs$/u)
    if (platform === 'darwin') {
      expect(options.vibrancy).toBe('menu')
      expect(options.visualEffectState).toBe('active')
      expect(options.trafficLightPosition).toEqual({ x: 21, y: 21 })
    } else if (platform === 'win32') {
      expect(options.backgroundMaterial).toBe('acrylic')
      expect(options.titleBarOverlay).toMatchObject({ height: 42 })
    } else {
      expect(options.backgroundColor).toBe('#FFFFFF')
      expect(options.vibrancy).toBeUndefined()
      expect(options.backgroundMaterial).toBeUndefined()
    }
  })

  it('waits for its local document and blocks renderer navigation', async () => {
    const window = createWindow()
    const loaded = Promise.withResolvers<undefined>()
    window.loadFile.mockReturnValue(loaded.promise)
    electron.create.mockReturnValue(window)
    const opening = openWelcomeWindow(resolveDesktopLocale('en'), operations)
    expect(window.show).not.toHaveBeenCalled()
    expect(window.loadFile).toHaveBeenCalledWith(join(electron.root, 'renderer', 'welcome.html'))
    expect(window.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    window.webContents.on.mock.calls[0]![1](event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    loaded.resolve(undefined)
    expect(await opening).toBe(window)
    expect(window.show).toHaveBeenCalledOnce()
  })

  it('destroys a window whose document fails to load', async () => {
    const window = createWindow()
    window.loadFile.mockRejectedValue(new Error('missing welcome document'))
    electron.create.mockReturnValue(window)
    await expect(openWelcomeWindow(resolveDesktopLocale('en'), operations)).rejects.toThrow('missing welcome document')
    expect(window.destroy).toHaveBeenCalledOnce()
    expect(electron.handlers.size).toBe(0)
    expect(window.show).not.toHaveBeenCalled()
  })

  it('does not show a window closed while its document was loading', async () => {
    const window = createWindow()
    window.isDestroyed.mockReturnValue(true)
    electron.create.mockReturnValue(window)
    await openWelcomeWindow(resolveDesktopLocale('en'), operations)
    expect(window.show).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
  })

  it('accepts actions only from its own top frame and removes handlers on close', async () => {
    const window = createWindow()
    electron.create.mockReturnValue(window)
    const saveApiKey = vi.fn(operations.saveApiKey)
    const skip = vi.fn(operations.skip)
    const copySignInLink = vi.fn(operations.copySignInLink)
    await openWelcomeWindow(resolveDesktopLocale('en'), { ...operations, saveApiKey, skip, copySignInLink })
    const own = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const save = electron.handlers.get(WELCOME_IPC.saveApiKey)!
    await expect(save({ sender: {}, senderFrame: {} }, 'sk-test')).rejects.toThrow('unowned frame')
    await expect(save({ ...own, senderFrame: {} }, 'sk-test')).rejects.toThrow('unowned frame')
    expect(await save(own, 'bad key')).toEqual({ ok: false })
    expect(saveApiKey).not.toHaveBeenCalled()
    expect(await save(own, 'sk-test')).toEqual({ ok: true })
    await electron.handlers.get(WELCOME_IPC.skip)!(own)
    expect(skip).toHaveBeenCalledOnce()
    const copy = electron.handlers.get(WELCOME_IPC.copyLink)!
    await expect(copy({ ...own, senderFrame: {} }, 'attempt')).rejects.toThrow('unowned frame')
    await expect(copy(own, 42)).rejects.toThrow('invalid attempt')
    await copy(own, 'attempt')
    expect(copySignInLink).toHaveBeenCalledExactlyOnceWith('attempt')
    window.once.mock.calls[0]![1]()
    expect(electron.handlers.size).toBe(0)
  })

  it('does not show a superseded window when its delayed document finishes loading', async () => {
    const previous = createWindow()
    const current = createWindow()
    const loaded = Promise.withResolvers<undefined>()
    previous.loadFile.mockReturnValue(loaded.promise)
    electron.create.mockReturnValueOnce(previous).mockReturnValueOnce(current)
    const opening = openWelcomeWindow(resolveDesktopLocale('en'), operations)
    await openWelcomeWindow(resolveDesktopLocale('en'), operations)
    loaded.resolve(undefined)
    await opening
    expect(previous.show).not.toHaveBeenCalled()
    expect(current.show).toHaveBeenCalledOnce()
    previous.once.mock.calls[0]![1]()
    current.once.mock.calls[0]![1]()
  })

  it('replaces handlers before the previous native window emits closed', async () => {
    const previous = createWindow()
    const current = createWindow()
    electron.create.mockReturnValueOnce(previous).mockReturnValueOnce(current)
    const previousStart = vi.fn(operations.startSignIn)
    const currentStart = vi.fn(operations.startSignIn)
    await openWelcomeWindow(resolveDesktopLocale('en'), { ...operations, startSignIn: previousStart })
    const previousHandler = electron.handlers.get(WELCOME_IPC.start)!
    const previousSender = { sender: previous.webContents, senderFrame: previous.webContents.mainFrame }
    await openWelcomeWindow(resolveDesktopLocale('en'), { ...operations, startSignIn: currentStart })
    const currentHandler = electron.handlers.get(WELCOME_IPC.start)!
    await expect(previousHandler(previousSender)).rejects.toThrow('unowned frame')
    await expect(currentHandler(previousSender)).rejects.toThrow('unowned frame')
    previous.once.mock.calls[0]![1]()
    expect(electron.handlers.get(WELCOME_IPC.start)).toBe(currentHandler)
    await currentHandler({ sender: current.webContents, senderFrame: current.webContents.mainFrame })
    expect(currentStart).toHaveBeenCalledOnce()
    expect(previousStart).not.toHaveBeenCalled()
    current.once.mock.calls[0]![1]()
    expect(electron.handlers.size).toBe(0)
  })

  it('shows the entry after logout only without a separately configured API key', () => {
    expect(needsWelcome({ loggedIn: true, hasApiKey: false })).toBe(false)
    expect(needsWelcome({ loggedIn: false, hasApiKey: false })).toBe(true)
    expect(needsWelcome({ loggedIn: false, hasApiKey: true })).toBe(false)
    expect(needsWelcome({ loggedIn: true, hasApiKey: true })).toBe(false)
  })

  it('opens the MCP step only when first run asks for it', () => {
    expect(welcomeWindowOptions('win32', resolveDesktopLocale('en')).webPreferences?.additionalArguments)
      .toEqual(['--dsh-welcome-locale=en'])
    expect(welcomeWindowOptions('win32', resolveDesktopLocale('en'), 'mcp').webPreferences?.additionalArguments)
      .toEqual(['--dsh-welcome-locale=en', '--dsh-welcome-page=mcp'])
  })

  it('accepts MCP actions only from its own top frame and validates the transport shape', async () => {
    const window = createWindow()
    electron.create.mockReturnValue(window)
    const readMcp = vi.fn(operations.readMcp)
    const saveMcp = vi.fn(operations.saveMcp)
    const clearMcp = vi.fn(operations.clearMcp)
    const finishMcp = vi.fn(operations.finishMcp)
    await openWelcomeWindow(resolveDesktopLocale('en'), { ...operations, readMcp, saveMcp, clearMcp, finishMcp }, 'mcp')
    const own = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const read = electron.handlers.get(WELCOME_IPC.readMcp)!
    await expect(read({ ...own, senderFrame: {} })).rejects.toThrow('unowned frame')
    expect(await read(own)).toMatchObject({ required: true, stored: false })
    const save = electron.handlers.get(WELCOME_IPC.saveMcp)!
    expect(await save(own, 'ssk-not-an-object')).toEqual({ ok: false })
    expect(await save(own, { secscan: 42, seclayer: '', runner: '', endpoint: '' })).toEqual({ ok: false })
    expect(await save(own, { secscan: 'x'.repeat(5000), seclayer: '', runner: '', endpoint: '' })).toEqual({ ok: false })
    // The handler rebuilds the draft field by field, so the seclayer field is
    // shape-checked like the others: absent, non-string, or over-long is refused
    // here rather than stripped on its way to the store.
    expect(await save(own, { secscan: '', runner: '', endpoint: '' })).toEqual({ ok: false })
    expect(await save(own, { secscan: '', seclayer: 42, runner: '', endpoint: '' })).toEqual({ ok: false })
    expect(await save(own, { secscan: '', seclayer: 'x'.repeat(5000), runner: '', endpoint: '' })).toEqual({ ok: false })
    expect(saveMcp).not.toHaveBeenCalled()
    expect(await save(own, { secscan: 'ssk_window-test-token', seclayer: 'seclayer-window-test-token', runner: '', endpoint: '' })).toEqual({ ok: true })
    expect(saveMcp).toHaveBeenCalledExactlyOnceWith({ secscan: 'ssk_window-test-token', seclayer: 'seclayer-window-test-token', runner: '', endpoint: '' })
    expect(await electron.handlers.get(WELCOME_IPC.clearMcp)!(own)).toEqual({ ok: true })
    expect(clearMcp).toHaveBeenCalledOnce()
    await electron.handlers.get(WELCOME_IPC.finishMcp)!(own)
    expect(finishMcp).toHaveBeenCalledOnce()
  })
})
