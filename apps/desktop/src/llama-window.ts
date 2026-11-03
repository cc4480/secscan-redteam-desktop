/** Native manager window for the bundled local-model feature; presentation only, with every operation crossing the llama preload bridge. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from 'electron'

/** Native title of the manager window; the document repeats it so a late load keeps the same caption. */
const WINDOW_TITLE = 'Local models'

/**
 * Height of the renderer-drawn title strip. It is reserved in `renderer/llama.css`
 * (`.titlebar`) and in the Windows caption overlay below, so the native buttons
 * land on the strip instead of on page content.
 */
const TITLEBAR_HEIGHT = 42

/**
 * Opaque window fill. The window paints a themed surface instead of using a native
 * material: materials need a transparent window and are ignored by Windows 10, and
 * the renderer's base surface is the same color, so the first paint never flashes.
 */
const WINDOW_FILL = { light: '#f9fafb', dark: '#1b1b1c' } as const

/** Resolve the compiled preload beside this module in both packaged (asar) and unpackaged layouts. */
function defaultPreload(): string {
  return fileURLToPath(new URL('./preload-llama.cjs', import.meta.url))
}

/** Test-injectable seams; production callers pass nothing. */
export interface LlamaWindowOptions {
  /** Absolute path of the compiled preload; defaults to the sibling `preload-llama.cjs`. */
  readonly preload?: string
  /** Absolute path of the document to load; defaults to `<appPath>/renderer/llama.html`. */
  readonly html?: string
  /** Reveal the window once its document has loaded; tests pass `false` to stay hidden. Defaults to `true`. */
  readonly show?: boolean
  /** Resolved palette for the window fill; defaults to Electron's current native theme. */
  readonly dark?: boolean
}

/**
 * Build the manager window's native options.
 * @param platform - operating system hosting Electron; selects the caption chrome.
 * @param dark - whether the applied palette is dark, so the fill and caption symbols match.
 * @param options - injectable preload path for tests.
 * @returns a resizable window with the welcome window's isolation settings and minimum usable size.
 */
export function llamaWindowOptions(
  platform: NodeJS.Platform,
  dark: boolean,
  options: LlamaWindowOptions = {},
): BrowserWindowConstructorOptions {
  const fill = dark ? WINDOW_FILL.dark : WINDOW_FILL.light
  return {
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 720,
    useContentSize: true,
    center: true,
    resizable: true,
    show: false,
    title: WINDOW_TITLE,
    backgroundColor: fill,
    // The renderer draws its own title strip, so the native caption is hidden where the
    // platform can overlay its controls; Linux keeps the ordinary frame and strip.
    ...(platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: fill, symbolColor: dark ? '#f9fafb' : '#0f1115', height: TITLEBAR_HEIGHT },
    } as const : {}),
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
 * Open the process's Local models manager window.
 * @param options - test seams for the preload, document, visibility and palette.
 * @returns the visible window; a failed document load destroys it before rejecting.
 */
export async function openLlamaWindow(options: LlamaWindowOptions = {}): Promise<BrowserWindow> {
  const window = new BrowserWindow(llamaWindowOptions(process.platform, options.dark ?? nativeTheme.shouldUseDarkColors, options))
  // The manager renderer talks to the shell only through the preload bridge; it has no use for
  // navigation or popups, so both are refused the way the welcome window refuses them.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  try {
    await window.loadFile(options.html ?? join(app.getAppPath(), 'renderer', 'llama.html'))
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  if (options.show !== false && !window.isDestroyed()) {
    // show() alone is not enough: a window created from an IPC handler while the chat
    // window holds focus can be raised BEHIND it on Windows, which looks like the app
    // ignored the click. focus() raises it, and moveTop() settles the z-order race that
    // show() loses when the foreground window is being activated in the same tick.
    if (process.platform === 'win32') window.moveTop()
    window.show()
    window.focus()
  }
  return window
}
