/**
 * Shared contract for the Ollama feature.
 *
 * Ollama is its own component (operator requirement 2026-11-07): a named fleet
 * family in the router plus this desktop surface, which gives the same
 * operations the Hugging Face local-model feature offers — see what is
 * installed, fetch a model with real byte progress, cancel, delete — against the
 * Ollama daemon the operator already runs. Nothing here supervises the daemon:
 * the app detects it and attaches, and never starts or kills it.
 *
 * Types and channel names live here so the client, the service, the IPC layer,
 * the renderer and the preload bridge cannot drift.
 */

/** One model the daemon has installed. */
export interface OllamaModel {
  /** The name to reference it by, e.g. `llama3.2:3b` (Ollama's `name`, which always carries a tag). */
  readonly name: string
  /** The base model id, e.g. `llama3.2` (Ollama's `model` field). */
  readonly model: string
  /** Bytes on disk. */
  readonly sizeBytes: number
  /** Content digest, when the daemon reports one. */
  readonly digest?: string
  /** Epoch milliseconds of the model file's modification time, when parseable. */
  readonly modifiedAt?: number
  /** Parameter size from the model's details, e.g. `3.2B`. */
  readonly parameterSize?: string
  /** Quantization level from the model's details, e.g. `Q4_K_M`. */
  readonly quantization?: string
  /** Model family from the model's details, e.g. `llama`. */
  readonly family?: string
}

/**
 * What the daemon answers about itself. A stopped daemon is not an error state
 * the UI has to guess at: `reachable: false` is the answer, with the address
 * that was probed, and `error` carrying the operative reason.
 */
export interface OllamaConnection {
  /** True when `/api/version` answered. */
  readonly reachable: boolean
  /** Daemon root that was probed, e.g. `http://127.0.0.1:11434`. */
  readonly baseUrl: string
  /** Version string the daemon reported, when reachable. */
  readonly version?: string
  /** Operator-facing reason when not reachable. */
  readonly error?: string
  /** When this snapshot was taken, epoch milliseconds. */
  readonly checkedAt: number
}

/** Pull phases surfaced to the UI, mirroring the Hugging Face download phases. */
export type OllamaPullPhase = 'pulling' | 'verifying' | 'done' | 'error' | 'cancelled'

/** Progress event for one pull. */
export interface OllamaPullProgress {
  /** Model name being pulled; stable before it is installed. */
  readonly name: string
  /** Daemon-reported status line for this layer, e.g. `pulling manifest`, `verifying sha256 digest`. */
  readonly status?: string
  readonly phase: OllamaPullPhase
  /** Bytes of the current layer already transferred. */
  readonly receivedBytes: number
  /** Total bytes of the current layer, when the daemon reports it. */
  readonly totalBytes?: number
  /** Failure message when phase is `error`. */
  readonly error?: string
}

/** Detail the daemon reports for one installed model. */
export interface OllamaModelDetails {
  /** The name queried. */
  readonly name: string
  readonly parameterSize?: string
  readonly quantization?: string
  readonly family?: string
  /** Ollama's declared capabilities, e.g. `["completion","tools"]`. */
  readonly capabilities: readonly string[]
  /**
   * Whether the daemon declared its capability list at all. An older daemon
   * reports none, and "unknown" must not be read as "no tools": the two lead to
   * different decisions (allow with a warning vs refuse).
   */
  readonly capabilitiesDeclared: boolean
  /**
   * Whether the daemon declares the model tool-capable. This is the answer to
   * "can the app's tools run on this model", read from the daemon rather than
   * guessed from the name.
   */
  readonly supportsTools: boolean
  /** The context window that will be used, whether the daemon declared it or a fallback did. */
  readonly contextLength: number
  /**
   * The output budget the app will use for this model. Declared by the daemon
   * when it carries a `num_predict` parameter, otherwise derived from the
   * context window — `maxOutputSource` says which.
   */
  readonly maxOutputTokens: number
  /** Whether `contextLength` came from the daemon or from a fallback. */
  readonly contextSource: 'declared' | 'derived'
  /** Whether `maxOutputTokens` came from the daemon or was derived. */
  readonly maxOutputSource: 'declared' | 'derived'
  /** Bytes on disk, when the daemon reports it. */
  readonly sizeBytes?: number
}

/** The operator's chosen Ollama model and daemon address, as persisted. */
export interface OllamaSelection {
  /** Model the fleet should run; null when nothing is selected. */
  readonly activeModel: string | null
  /** Daemon root the selection was made against. */
  readonly baseUrl: string
}

/** Operations the surface invokes over IPC. */
export interface OllamaOperations {
  /** Probe the daemon and report what it is. */
  getConnection(): Promise<OllamaConnection>
  /** Installed models, as the daemon lists them. */
  listModels(): Promise<OllamaModel[]>
  /** Declared detail for one installed model. */
  showModel(name: string): Promise<OllamaModelDetails>
  /** Pull a model; progress arrives through `onPullProgress`. */
  pullModel(name: string): Promise<OllamaModel>
  /** Cancel an in-flight pull by name. */
  cancelPull(name: string): Promise<void>
  /** Delete an installed model. */
  deleteModel(name: string): Promise<void>
  /** The persisted selection. */
  getSelection(): Promise<OllamaSelection>
  /**
   * Choose the model the fleet runs, or `null` to stand it down. On selection the
   * shell publishes the fleet provider record and mirrors the daemon address,
   * model and detected context into the runner environment.
   */
  selectModel(name: string | null): Promise<OllamaSelection>
  /** Subscribe to pull progress; returns a disposer. */
  onPullProgress(listener: (progress: OllamaPullProgress) => void): () => void
}

/** Private IPC channels for the Ollama surface. */
export const OLLAMA_IPC = {
  getConnection: 'dsh-ollama:get-connection',
  listModels: 'dsh-ollama:list-models',
  showModel: 'dsh-ollama:show-model',
  pullModel: 'dsh-ollama:pull-model',
  cancelPull: 'dsh-ollama:cancel-pull',
  deleteModel: 'dsh-ollama:delete-model',
  getSelection: 'dsh-ollama:get-selection',
  selectModel: 'dsh-ollama:select-model',
  pullProgress: 'dsh-ollama:pull-progress',
} as const

/** Environment the shell injects into the engagement-runner child when Ollama is the active model. */
export interface OllamaRunnerEnvironment {
  readonly REDTEAM_LLM_PROVIDER: 'ollama'
  readonly OLLAMA_BASE_URL: string
  readonly OLLAMA_MODEL: string
}
