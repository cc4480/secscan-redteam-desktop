/**
 * The Ollama service: the operations object the IPC layer registers.
 *
 * Composes the daemon client into the contract the surface talks to, and owns
 * the two behaviours that belong at this seam and nowhere else:
 *
 * - Cancellation: `pullModel` keeps an `AbortController` per model name while
 *   the pull runs and `cancelPull` aborts exactly that one, so a cancel can never
 *   stop a different model's transfer.
 * - Event fan-out: pull progress is forwarded to every subscriber as it lands,
 *   with a failing subscriber logged rather than allowed to break the pull.
 *
 * Nothing here supervises the daemon. The app detects and attaches; it never
 * starts or kills an Ollama process the operator owns.
 */

import type {
  OllamaConnection,
  OllamaModel,
  OllamaModelDetails,
  OllamaOperations,
  OllamaPullProgress,
  OllamaSelection,
} from './ollama-api.ts'
import type {
  ModelNameOptions,
  OllamaClientOptions,
  PullModelOptions,
} from './ollama-client.ts'

/** Prefix every operator-facing failure this module raises carries. */
const PREFIX = 'desktop ollama:'

/** The daemon client surface the service reads; the real module satisfies it. */
export interface OllamaServiceDeps {
  readonly client: {
    readonly probeDaemon: (options?: OllamaClientOptions) => Promise<OllamaConnection>
    readonly listInstalled: (options?: OllamaClientOptions) => Promise<OllamaModel[]>
    readonly showInstalled: (options: ModelNameOptions) => Promise<OllamaModelDetails>
    readonly pullModel: (options: PullModelOptions) => Promise<OllamaModel>
    readonly deleteInstalled: (options: ModelNameOptions) => Promise<void>
  }
  /** Daemon root and optional token; resolved once here and forwarded to every call. */
  readonly connection?: { readonly baseUrl?: string; readonly token?: string }
  /**
   * Selection persistence and publication, supplied by the shell. Absent in a
   * bare service (tests, headless use), where selection reads as "none chosen"
   * and choosing one is a no-op beyond persisting nothing.
   */
  readonly selection?: {
    readonly read: () => OllamaSelection
    readonly write: (selection: OllamaSelection) => void
    /**
     * Publish the choice to the fleet: the provider record plus the runner
     * environment (address, model, detected context). `null` stands the fleet
     * back down.
     */
    readonly publish: (
      selection: OllamaSelection | null,
      limits: { readonly contextLength?: number; readonly maxOutputTokens?: number },
    ) => void
  }
}

/** The service the IPC layer registers and the shell owns. */
export interface OllamaService extends OllamaOperations {
  /** Forget every subscriber and abort the in-flight pulls. Leaves the daemon untouched. */
  dispose(): void
}

/** @returns the message of an unknown failure, for a log line or an event payload. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the OllamaOperations implementation.
 * @param deps - client surface and connection settings.
 * @returns the service plus a disposer for what it added.
 */
export function createOllamaService(deps: OllamaServiceDeps): OllamaService {
  const pullListeners = new Set<(progress: OllamaPullProgress) => void>()
  /** Abort handle of each in-flight pull, keyed by the model name it will install. */
  const controllers = new Map<string, AbortController>()

  /** The client options every call shares. */
  const options = (): OllamaClientOptions => ({
    ...deps.connection?.baseUrl === undefined ? {} : { baseUrl: deps.connection.baseUrl },
    ...deps.connection?.token === undefined ? {} : { token: deps.connection.token },
  })

  const emit = (progress: OllamaPullProgress): void => {
    for (const listener of [...pullListeners]) {
      try {
        listener(progress)
      } catch (error) {
        console.error(`${PREFIX} a pull progress listener failed: ${messageOf(error)}`)
      }
    }
  }

  const pullModel = async (name: string): Promise<OllamaModel> => {
    if (name.trim() === '') throw new Error(`${PREFIX} the model name must be a non-empty string`)
    if (controllers.has(name)) throw new Error(`${PREFIX} a pull for ${name} is already in progress`)
    const controller = new AbortController()
    controllers.set(name, controller)
    try {
      return await deps.client.pullModel({
        ...options(),
        name,
        signal: controller.signal,
        onProgress: emit,
      })
    } finally {
      if (controllers.get(name) === controller) controllers.delete(name)
    }
  }

  const cancelPull = (name: string): Promise<void> => {
    // Unknown names are a no-op so a UI retry of a finished pull stays harmless.
    controllers.get(name)?.abort()
    return Promise.resolve()
  }

  return {
    getConnection: () => deps.client.probeDaemon(options()),
    listModels: () => deps.client.listInstalled(options()),
    showModel: async (name: string) => {
      if (name.trim() === '') throw new Error(`${PREFIX} the model name must be a non-empty string`)
      return deps.client.showInstalled({ ...options(), name })
    },
    pullModel,
    cancelPull,
    deleteModel: async (name: string) => {
      if (name.trim() === '') throw new Error(`${PREFIX} the model name must be a non-empty string`)
      return deps.client.deleteInstalled({ ...options(), name })
    },
    getSelection: async () => deps.selection?.read()
      ?? { activeModel: null, baseUrl: deps.connection?.baseUrl ?? '' },
    selectModel: async (name: string | null) => {
      const current = deps.selection?.read()
        ?? { activeModel: null, baseUrl: deps.connection?.baseUrl ?? '' }
      if (name === null) {
        // Standing the fleet down: the choice is cleared and the selection published
        // as "nothing", so nothing keeps pointing at a model that may be deleted next.
        const cleared: OllamaSelection = { activeModel: null, baseUrl: current.baseUrl }
        deps.selection?.write(cleared)
        deps.selection?.publish(null, {})
        return cleared
      }
      if (name.trim() === '') throw new Error(`${PREFIX} the model name must be a non-empty string`)
      // Choosing a model the daemon does not have would publish a selection that fails
      // at the first agent call, so the choice is verified and its limits read first.
      const details = await deps.client.showInstalled({ ...options(), name })
      // A model that explicitly declares no tool capability would run an engagement
      // that casts tools and never calls one, which looks like a broken agent rather
      // than an incapable model. Refuse it by name. An older daemon that declares no
      // capability list at all is allowed: "unknown" is not "no".
      if (details.capabilitiesDeclared && !details.supportsTools) {
        throw new Error(
          `${PREFIX} ${name} does not declare tool support, so the fleet could not use the app's tools with it. ` +
            'Choose a model whose capabilities include "tools".',
        )
      }
      const selection: OllamaSelection = { activeModel: name, baseUrl: current.baseUrl }
      deps.selection?.write(selection)
      deps.selection?.publish(selection, {
        contextLength: details.contextLength,
        maxOutputTokens: details.maxOutputTokens,
      })
      return selection
    },
    onPullProgress: (listener) => {
      pullListeners.add(listener)
      return () => { pullListeners.delete(listener) }
    },
    dispose: () => {
      pullListeners.clear()
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    },
  }
}
