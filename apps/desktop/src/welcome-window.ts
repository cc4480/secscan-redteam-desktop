import type { SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
/** Native welcome window and its presentation-only renderer. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent } from 'electron'
import type { DesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeOperations, type WelcomePage } from './welcome-api.ts'

/**
 * Resolve the fixed-size welcome window's native material and controls.
 * @param platform - operating system hosting Electron.
 * @param locale - shell-owned localized copy.
 * @param startPage - page the window opens on; the account entry unless this run has to ask for MCP access.
 * @returns sandboxed window options with a locale-only preload.
 */
export function welcomeWindowOptions(platform: NodeJS.Platform, locale: DesktopLocale, startPage: WelcomePage = 'entry'): BrowserWindowConstructorOptions {
  return {
    width: 600,
    height: 700,
    useContentSize: true,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: locale.messages.welcomeTitle,
    backgroundColor: platform === 'darwin' || platform === 'win32' ? '#00000000' : '#FFFFFF',
    ...(platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 21, y: 21 },
      vibrancy: 'menu',
      visualEffectState: 'active',
    } as const : {}),
    ...(platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#0F1115', height: 42 },
      backgroundMaterial: 'acrylic',
    } as const : {}),
    webPreferences: {
      preload: fileURLToPath(new URL('./preload-welcome.cjs', import.meta.url)),
      additionalArguments: [
        `--dsh-welcome-locale=${locale.id}`,
        ...startPage === 'mcp' ? ['--dsh-welcome-page=mcp'] : [],
      ],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  }
}

let disposeActiveHandlers: (() => void) | undefined

/**
 * Open the process's sole welcome window with desktop-owned operations.
 * Replaces IPC ownership immediately; the caller closes the previous native window.
 * @param locale - shell-owned localized copy.
 * @param operations - credential write and this-launch-only skip actions.
 * @param startPage - page the window opens on.
 * @returns the visible window; a failed load destroys it before rejecting.
 */
export async function openWelcomeWindow(locale: DesktopLocale, operations: WelcomeOperations, startPage: WelcomePage = 'entry'): Promise<BrowserWindow> {
  const window = new BrowserWindow(welcomeWindowOptions(process.platform, locale, startPage))
  disposeActiveHandlers?.()
  let active = true
  const disposeHandlers = (): void => {
    if (!active) return
    active = false
    for (const channel of [WELCOME_IPC.saveApiKey, WELCOME_IPC.skip, WELCOME_IPC.start, WELCOME_IPC.cancel, WELCOME_IPC.copyLink,
      WELCOME_IPC.readMcp, WELCOME_IPC.saveMcp, WELCOME_IPC.clearMcp, WELCOME_IPC.finishMcp]) {
      ipcMain.removeHandler(channel)
    }
    disposeActiveHandlers = undefined
  }
  disposeActiveHandlers = disposeHandlers
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (!active || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('desktop welcome: rejected action from an unowned frame')
    }
  }
  ipcMain.handle(WELCOME_IPC.saveApiKey, async (event, value: unknown) => {
    assertSender(event)
    if (typeof value !== 'string' || !/^[\x21-\x7e]+$/.test(value)) return { ok: false }
    return operations.saveApiKey(value)
  })
  ipcMain.handle(WELCOME_IPC.skip, async (event) => {
    assertSender(event)
    await operations.skip()
  })
  ipcMain.handle(WELCOME_IPC.start, async (event) => { assertSender(event); return operations.startSignIn() })
  ipcMain.handle(WELCOME_IPC.cancel, async (event, id: unknown) => {
    assertSender(event)
    if (typeof id !== 'string') throw new Error('desktop welcome: invalid attempt')
    return operations.cancelSignIn(id as SignInAttemptId)
  })
  ipcMain.handle(WELCOME_IPC.copyLink, async (event, id: unknown) => {
    assertSender(event)
    if (typeof id !== 'string') throw new Error('desktop welcome: invalid attempt')
    return operations.copySignInLink(id as SignInAttemptId)
  })
  ipcMain.handle(WELCOME_IPC.readMcp, async (event) => { assertSender(event); return operations.readMcp() })
  ipcMain.handle(WELCOME_IPC.saveMcp, async (event, input: unknown) => {
    assertSender(event)
    // Only the transport shape is checked here; the credential rules live with the document, so a
    // refused value leaves the shell's failure copy to the renderer and reaches no log.
    if (typeof input !== 'object' || input === null) return { ok: false }
    const fields = input as Record<string, unknown>
    if (typeof fields.secscan !== 'string' || typeof fields.seclayer !== 'string' || typeof fields.runner !== 'string' || typeof fields.endpoint !== 'string') return { ok: false }
    if (fields.secscan.length > 4096 || fields.seclayer.length > 4096
      || fields.runner.length > 4096 || fields.endpoint.length > 4096) return { ok: false }
    return operations.saveMcp({ secscan: fields.secscan, seclayer: fields.seclayer, runner: fields.runner, endpoint: fields.endpoint })
  })
  ipcMain.handle(WELCOME_IPC.clearMcp, async (event) => { assertSender(event); return operations.clearMcp() })
  ipcMain.handle(WELCOME_IPC.finishMcp, async (event) => { assertSender(event); await operations.finishMcp() })
  window.once('closed', disposeHandlers)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  try {
    await window.loadFile(join(app.getAppPath(), 'renderer', 'welcome.html'))
  } catch (error) {
    disposeHandlers()
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Another window can replace ownership during loadFile.
  if (active && !window.isDestroyed()) window.show()
  return window
}
