/**
 * The Ollama IPC surface.
 *
 * Registers the service's operations on private invoke channels and pushes pull
 * progress on one event channel, mirroring the local-model feature's IPC seam.
 *
 * Every invoke channel refuses a caller that is not the Ollama renderer
 * document's top frame before dispatching, exactly as the manager window's
 * surface does: the preload bridge lives in that document's top frame, so a
 * subframe — or any other renderer — owns no channel here.
 */

import { OLLAMA_IPC, type OllamaPullProgress } from './ollama-api.ts'
import type { OllamaService } from './ollama-service.ts'

/** Prefix every operator-facing failure this module raises carries. */
const PREFIX = 'desktop ollama:'

/** The Ollama renderer document, relative to the application directory. */
const SURFACE_DOCUMENT = 'renderer/ollama.html'

/** Longest accepted renderer-supplied name; a model reference is far shorter. */
const MAX_INPUT_CHARS = 1024

/** One live renderer the event channel is pushed to. */
export interface OllamaIpcWindow {
  /** Delivers one event-channel payload to that renderer. */
  readonly send: (channel: string, payload: unknown) => void
}

/** The IPC sink the shell backs with `ipcMain` and its renderers; tests pass fakes. */
export interface OllamaIpcHost {
  /** Installs one invoke handler, exactly like `ipcMain.handle`. */
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>): void
  /** @returns the live renderers an event is broadcast to. */
  windows(): readonly OllamaIpcWindow[]
}

/** One invoke channel and the service call it performs after argument validation. */
interface InvokeRoute {
  readonly channel: string
  readonly dispatch: (service: OllamaService, args: readonly unknown[]) => Promise<unknown>
}

/**
 * @param value - a renderer-supplied value.
 * @param label - what the value names, for the failure message.
 * @returns the value when it is a non-empty string of a sane length.
 * @throws Error naming the field; the rejected text is not echoed.
 */
function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${PREFIX} the ${label} must be a non-empty string`)
  }
  if (value.length > MAX_INPUT_CHARS) throw new Error(`${PREFIX} the ${label} is too long`)
  return value
}

/**
 * Validate a renderer value that may legitimately be null.
 * @param value - the renderer-supplied value.
 * @param label - what the value names, for the failure message.
 * @returns null, or the value when it is a non-empty string of a sane length.
 * @throws Error naming the field when the value is neither.
 */
function optionalText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  return requiredText(value, label)
}

/** The invoked channels, in the contract's order; the event channel is not handled. */const INVOKE_ROUTES: readonly InvokeRoute[] = [
  { channel: OLLAMA_IPC.getConnection, dispatch: service => service.getConnection() },
  { channel: OLLAMA_IPC.listModels, dispatch: service => service.listModels() },
  {
    channel: OLLAMA_IPC.showModel,
    dispatch: (service, [name]) => service.showModel(requiredText(name, 'model name')),
  },
  {
    channel: OLLAMA_IPC.pullModel,
    dispatch: (service, [name]) => service.pullModel(requiredText(name, 'model name')),
  },
  {
    channel: OLLAMA_IPC.cancelPull,
    dispatch: (service, [name]) => service.cancelPull(requiredText(name, 'model name')),
  },
  {
    channel: OLLAMA_IPC.deleteModel,
    dispatch: (service, [name]) => service.deleteModel(requiredText(name, 'model name')),
  },
  { channel: OLLAMA_IPC.getSelection, dispatch: service => service.getSelection() },
  {
    channel: OLLAMA_IPC.selectModel,
    // null is a valid payload here: it stands the fleet back down.
    dispatch: (service, [name]) => service.selectModel(optionalText(name, 'model name')),
  },
]

/**
 * @param url - a renderer document URL.
 * @returns whether it is this surface's document.
 */
function isSurfaceDocument(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' && parsed.pathname.replace(/\\/gu, '/').endsWith(`/${SURFACE_DOCUMENT}`)
  } catch {
    // A frame without a parseable URL owns no channel.
    return false
  }
}

/**
 * Read the document URL of the top frame that issued an IPC call.
 *
 * A subframe is refused outright: the preload bridge lives in the surface
 * document's top frame, so a frame with a parent is not the renderer this
 * surface serves.
 * @param event - the handler's first argument, an `IpcMainInvokeEvent` in production.
 * @returns the frame URL, or `undefined` when the caller is not a top frame.
 */
function senderFrameUrl(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const frame = (event as { senderFrame?: unknown }).senderFrame
  if (typeof frame !== 'object' || frame === null) return undefined
  const candidate = frame as { url?: unknown; parent?: unknown }
  if (candidate.parent !== null && candidate.parent !== undefined) return undefined
  return typeof candidate.url === 'string' ? candidate.url : undefined
}

/**
 * Install the Ollama surface's private IPC.
 * @param service - the composed operations.
 * @param host - the ipcMain-shaped sink and the live renderer list.
 * @returns a disposer that removes the progress subscription. Handlers stay with the host.
 */
export function registerOllamaIpc(service: OllamaService, host: OllamaIpcHost): () => void {
  const owned = (event: unknown): void => {
    const url = senderFrameUrl(event)
    if (url === undefined || !isSurfaceDocument(url)) {
      throw new Error(`${PREFIX} rejected IPC from an unowned renderer`)
    }
  }

  for (const route of INVOKE_ROUTES) {
    host.handle(route.channel, async (event, ...args) => {
      owned(event)
      return route.dispatch(service, args)
    })
  }

  return service.onPullProgress((progress: OllamaPullProgress) => {
    for (const window of host.windows()) window.send(OLLAMA_IPC.pullProgress, progress)
  })
}
