/**
 * Browser-safe status vocabulary for the Local Models panel: the payload
 * of the `localModels` Remote namespace (see `./local-models-service.ts`)
 * and of the adapter read that backs it. Type-only, per the package
 * convention for `src/types.ts`; the serving-mode mechanics that produce
 * these values live in `./ollama.ts` (Ollama mode) and `./adapter.ts`
 * (both modes).
 */

/** How the `local` provider is served: the desktop's bundled llama-server, or a host Ollama. */
export type LocalServingMode = 'llama' | 'ollama'

/** Status of one model for the Local Models panel, in Ollama serving mode terms. */
export interface LocalModelStatusEntry {
  /** Model id, verbatim. */
  readonly id: string
  /** Whether Ollama currently has the model loaded. */
  readonly loaded: boolean
  /** Runtime context allocation, present while the model is loaded and Ollama reports it. */
  readonly contextLength?: number
  /** The model's maximum context length, as display metadata. */
  readonly maxContextLength?: number
  /** VRAM the loaded model occupies, in bytes, when reported. */
  readonly sizeVram?: number
}

/** One registry GGUF present on disk in the models directory. */
export interface LocalFolderModel {
  /** Registry id of the downloaded model. */
  readonly id: string
  /** Absolute path of the GGUF on disk. */
  readonly path: string
}

/**
 * The Local Models panel's status read: endpoint reachability, the served
 * models with their load state, and the on-disk GGUFs listed separately
 * (being on disk does not mean being served).
 */
export interface LocalModelsStatus {
  /** How the `local` provider is served on this host. The panel offers its lifecycle actions in both modes: against the host Ollama in Ollama mode, and against the store and the host's llama-server in llama mode. In llama mode `endpoint.up` is probe-verified, never read from the published state document alone. */
  readonly serving: LocalServingMode
  /** The serving endpoint's reachability and address. */
  readonly endpoint: { readonly up: boolean; readonly baseUrl: string }
  /** Models the endpoint serves (Ollama mode) or the registry holds (llama mode). */
  readonly models: readonly LocalModelStatusEntry[]
  /** Registry GGUFs present on disk, whether or not anything serves them. */
  readonly folderModels: readonly LocalFolderModel[]
}

/** Verified outcome of one load or unload action on a served model. */
export interface LocalModelActionResult {
  /** Model id the action ran on, verbatim. */
  readonly modelId: string
  /** Whether the endpoint reports the model loaded after the action (read back from the endpoint, never assumed). */
  readonly loaded: boolean
}

/**
 * The operator's persisted context-window setting for one model, as the
 * context actions read and write it: `contextLength` is the persisted
 * value, absent when unset (an unset model starts at its own maximum
 * in both modes: the catalog maximum in Ollama mode, the GGUF-declared
 * maximum in llama mode), and `maxContextLength` is the model's known
 * maximum — the ceiling a set is validated against — when the host
 * knows one.
 */
export interface LocalModelContextResult {
  /** Model id the setting belongs to, verbatim. */
  readonly modelId: string
  /** Persisted context length for the model, absent when unset. */
  readonly contextLength?: number
  /** The model's known maximum context length, when known. */
  readonly maxContextLength?: number
}

/** Verified outcome of one delete action on a served model. */
export interface LocalModelDeleteResult {
  /** Model id the delete ran on, verbatim. */
  readonly modelId: string
  /** Whether the endpoint's library no longer lists the model after the delete (read back, never assumed). */
  readonly deleted: boolean
}

/**
 * One file a Hugging Face repository offers, as the repository-listing
 * action reports it (the browser-safe projection of `LlamaRepoFile` in
 * `./llama.ts`): the page lists these and the operator picks one to
 * download, so no step requires typing an exact file name.
 */
export interface LocalModelRepoFile {
  /** File path inside the repository, verbatim. */
  readonly file: string
  /** Bytes, when the Hub reports the file's size. */
  readonly sizeBytes?: number
  /** True for `.gguf` files the manager offers (never a projector). */
  readonly isGguf: boolean
  /** True for a vision projector (`mmproj-*.gguf`), a companion asset fetched automatically with a model from the same repository. */
  readonly isProjector?: boolean
}

/** Handle of one running or settled model pull, returned when the pull starts. */
export interface LocalModelPullStart {
  /** Opaque id the panel polls for this pull's progress. */
  readonly jobId: string
}

/**
 * Progress of one model pull. In Ollama mode the status text and byte
 * counts are the endpoint's own, from its pull stream: `status` is the
 * current phase the endpoint reports, and the byte counts describe the
 * layer currently downloading. In llama mode the byte counts are the
 * Hugging Face download's own landed/total bytes for the model file, so
 * a percent is computable while both counts exist in either mode.
 */
export interface LocalModelPullStatus {
  /** The pull's job id. */
  readonly jobId: string
  /** Model id being pulled: the pull target verbatim while the job runs; in llama mode, the registered registry id once the download has landed and registered. */
  readonly modelId: string
  /** Lifecycle state: still pulling, finished, or failed. */
  readonly state: 'running' | 'done' | 'failed'
  /** The endpoint's current pull phase text, when it has reported one. */
  readonly status?: string
  /** Bytes of the layer currently downloading, as the endpoint reports. */
  readonly completedBytes?: number
  /** Total bytes of the layer currently downloading, as the endpoint reports. */
  readonly totalBytes?: number
  /** Why the pull failed, present only in the failed state. */
  readonly error?: string
}
