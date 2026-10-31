/**
 * Shared contract for the bundled local-model feature.
 *
 * Every part of the feature codes against this module: the model store, the
 * Hugging Face client, the llama-server supervisor, the manager window, the
 * preload bridge and the shell wiring. Types and channel names live here so the
 * pieces cannot drift.
 */

/** One GGUF model the operator has downloaded. */
export interface LlamaModel {
  /** Stable id: `<repoOwner>--<repoName>--<fileStem>`, lowercased. */
  readonly id: string
  /** Hugging Face repo, e.g. `mradermacher/Huihui-Qwen3.8-27B-abliterated-GGUF`. */
  readonly repo: string
  /** File name inside the repo, e.g. `Huihui-Qwen3.8-27B-abliterated.Q4_K_M.gguf`. */
  readonly file: string
  /** Absolute path of the downloaded file. */
  readonly path: string
  /** Bytes on disk. */
  readonly sizeBytes: number
  /** Quantization label parsed from the file name (`Q4_K_M`, `IQ4_XS`, ...), when present. */
  readonly quantization?: string
  /** Parameter size parsed from the repo/file name (`27B`, `8B`, ...), when present. */
  readonly parameterSize?: string
  /** Epoch milliseconds when the download completed. */
  readonly downloadedAt: number
}

/** One file offered by a Hugging Face repo. */
export interface LlamaRepoFile {
  /** File name inside the repo. */
  readonly file: string
  /** Bytes, when the Hub reports it. */
  readonly sizeBytes?: number
  /** True for `.gguf` files the manager offers. */
  readonly isGguf: boolean
}

/** llama-server lifecycle. */
export type LlamaServerStatus = 'stopped' | 'starting' | 'running' | 'error'

/** Observable state of the managed llama-server child. */
export interface LlamaServerState {
  readonly status: LlamaServerStatus
  /** OpenAI-compatible base URL while running, e.g. `http://127.0.0.1:52731/v1`. */
  readonly baseUrl?: string
  /** Loopback port while running. */
  readonly port?: number
  /** Model id the server is serving. */
  readonly modelId?: string
  /** Which bundled binary was used (`cpu`), useful for diagnostics. */
  readonly binary?: string
  /** Operator-facing failure when status is `error`. */
  readonly error?: string
}

/** Download phases surfaced to the UI. */
export type LlamaDownloadPhase = 'listing' | 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled'

/** Progress event for one download. */
export interface LlamaDownloadProgress {
  /** Model id being downloaded (stable before the file exists). */
  readonly id: string
  readonly phase: LlamaDownloadPhase
  readonly receivedBytes: number
  /** Total bytes, when known (from the Hub's size or Content-Length). */
  readonly totalBytes?: number
  /** Failure message when phase is `error`. */
  readonly error?: string
}

/** Runtime settings persisted outside the model registry. */
export interface LlamaSettings {
  /** Model id to serve on start; `null` when none selected. */
  readonly activeModelId: string | null
  /** Context window passed as `-c`. Defaults to 32768. */
  readonly contextLength: number
  /** Threads passed as `-t`. Defaults to the CPU count. */
  readonly threads: number
  /** Start llama-server when the app launches. */
  readonly startOnLaunch: boolean
  /** Optional HF token for gated repos; never logged. */
  readonly huggingFaceToken?: string
}

/** Operations the manager window invokes over IPC. */
export interface LlamaOperations {
  /** Installed models, newest first. */
  listModels(): Promise<LlamaModel[]>
  /** Files offered by a repo, `.gguf` only. */
  listRepoFiles(repo: string): Promise<LlamaRepoFile[]>
  /** Start a download; progress arrives through `onProgress`. */
  downloadModel(input: { repo: string; file: string }): Promise<LlamaModel>
  /** Cancel an in-flight download by id. */
  cancelDownload(id: string): Promise<void>
  /** Delete a downloaded model file and its registry entry. */
  deleteModel(id: string): Promise<void>
  /** Current settings. */
  getSettings(): Promise<LlamaSettings>
  /** Persist settings. */
  saveSettings(settings: LlamaSettings): Promise<LlamaSettings>
  /** Current server state. */
  getServerState(): Promise<LlamaServerState>
  /** Start llama-server for the active model. */
  startServer(): Promise<LlamaServerState>
  /** Stop llama-server. */
  stopServer(): Promise<LlamaServerState>
  /** Subscribe to download progress; returns a disposer. */
  onDownloadProgress(listener: (progress: LlamaDownloadProgress) => void): () => void
  /** Subscribe to server state; returns a disposer. */
  onServerState(listener: (state: LlamaServerState) => void): () => void
}

/** Private IPC channels for the manager window. */
export const LLAMA_IPC = {
  listModels: 'dsh-llama:list-models',
  listRepoFiles: 'dsh-llama:list-repo-files',
  downloadModel: 'dsh-llama:download-model',
  cancelDownload: 'dsh-llama:cancel-download',
  deleteModel: 'dsh-llama:delete-model',
  getSettings: 'dsh-llama:get-settings',
  saveSettings: 'dsh-llama:save-settings',
  getServerState: 'dsh-llama:get-server-state',
  startServer: 'dsh-llama:start-server',
  stopServer: 'dsh-llama:stop-server',
  downloadProgress: 'dsh-llama:download-progress',
  serverState: 'dsh-llama:server-state',
} as const

/** Environment the shell injects into the engagement-runner child when a model is active. */
export interface LlamaRunnerEnvironment {
  readonly REDTEAM_LLM_PROVIDER: 'local'
  readonly REDTEAM_LOCAL_BASE_URL: string
  readonly REDTEAM_LOCAL_MODEL: string
}
