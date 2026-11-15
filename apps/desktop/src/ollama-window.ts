/** Native window for the Ollama surface; presentation only, every operation crosses the Ollama preload bridge. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from 'electron'

/** Native title of the window; the document repeats it so a late load keeps the same caption. */
const WINDOW_TITLE = 'Ollama models'

/** Opaque window fill, matching the Local models window so the two read as one app. */
const WINDOW_FILL = { light: '#f9fafb', dark: '#1b1b1c' } as const

/** Resolve the compiled preload beside this module in both packaged (asar) and unpackaged layouts. */
function defaultPreload(): string {
  return fileURLToPath(new URL('./preload-ollama.cjs', import.meta.url))
}

/** Test-injectable seams; production callers pass nothing. */
export interface OllamaWindowOptions {
  /** Absolute path of the compiled preload; defaults to the sibling `preload-ollama.cjs`. */
  readonly preload?: string
  /** Absolute path of the document to load; defaults to `<appPath>/renderer/ollama.html`. */
  readonly html?: string
  /** Reveal the window once its document has loaded; tests pass `false`. Defaults to `true`. */
  readonly show?: boolean
  /** Resolved palette for the window fill; defaults to Electron's current native theme. */
  readonly dark?: boolean
}

/**
 * Build the window's native options, mirroring the Local models window's isolation.
 * @param platform - operating system hosting Electron.
 * @param dark - whether the applied palette is dark.
 * @param options - injectable preload/document paths for tests.
 * @returns the options for a resizable, isolated window.
 */
export function ollamaWindowOptions(
  platform: NodeJS.Platform,
  dark: boolean,
  options: OllamaWindowOptions = {},
): BrowserWindowConstructorOptions {
  const fill = dark ? WINDOW_FILL.dark : WINDOW_FILL.light
  return {
    width: 1080,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    useContentSize: true,
    center: true,
    resizable: true,
    show: false,
    title: WINDOW_TITLE,
    backgroundColor: fill,
    ...(platform === 'win32' ? { titleBarStyle: 'hidden' as const } : {}),
    ...(platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 21, y: 21 },
    } as const : {}),
    webPreferences: {
      preload: options.preload ?? defaultPreload(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  }
}

/**
 * Open the Ollama window.
 * @param options - test seams for the preload, document, visibility and palette.
 * @returns the visible window; a failed document load destroys it before rejecting.
 */
export async function openOllamaWindow(options: OllamaWindowOptions = {}): Promise<BrowserWindow> {
  const window = new BrowserWindow(ollamaWindowOptions(process.platform, options.dark ?? nativeTheme.shouldUseDarkColors, options))
  // The renderer talks to the shell only through the bridge; navigation and popups are refused.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  try {
    await window.loadFile(options.html ?? join(app.getAppPath(), 'renderer', 'ollama.html'))
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  if (options.show !== false && !window.isDestroyed()) {
    if (process.platform === 'win32') window.moveTop()
    window.show()
    window.focus()
  }
  return window
}
