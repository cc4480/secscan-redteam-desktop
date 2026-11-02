/**
 * The desktop's local-model state documents, read from the models directory
 * the desktop app owns. The desktop (Electron main) downloads GGUF models
 * into that directory (`registry.json`), records the operator's pick and
 * server settings in `settings.json`, and publishes the bundled
 * llama-server's live state to `server-state.json` on every transition
 * (schema owned by `apps/desktop/src/llama-server-state.ts`). The Host is a
 * separate process, so these documents are its only window onto that state;
 * every read here is fail-soft, mirroring the runner's
 * `apps/redteam-runner/src/ui/local-model.ts`: a missing or unusable
 * document resolves to absence, never to a thrown error, so a machine
 * without local models simply has no local catalog entries.
 */

import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Environment name that overrides the local models directory. */
export const LOCAL_MODELS_DIR_ENV = 'DSH_LOCAL_MODELS_DIR'

/** File name of the downloaded-model registry inside the models directory. */
export const REGISTRY_FILENAME = 'registry.json'

/** File name of the local-model settings document inside the models directory. */
export const SETTINGS_FILENAME = 'settings.json'

/** File name of the published llama-server state document inside the models directory. */
export const SERVER_STATE_FILENAME = 'server-state.json'

/** On-disk server-state schema version the desktop publishes. */
const SERVER_STATE_VERSION = 1

/** One downloaded model, as the registry records it. */
export interface LocalRegistryModel {
  /** Model id the server answers to (the registry id, its `--alias`). */
  readonly id: string
  /** GGUF file name inside the models directory. */
  readonly file: string
  /** Absolute path of the downloaded GGUF. */
  readonly path: string
}

/** The operator's local-model settings, narrowed to the fields this package reads. */
export interface LocalModelsSettings {
  /** Registry id of the operator's active model, when one is selected. */
  readonly activeModelId?: string
  /** Context length the operator configured for the server, when valid. */
  readonly contextLength?: number
}

/** One published llama-server state document, as the desktop writes it. */
export interface LocalServerState {
  /** Server lifecycle state. */
  readonly status: 'stopped' | 'starting' | 'running' | 'error'
  /** OpenAI-compatible base URL (`http://127.0.0.1:<port>/v1`), present while an endpoint exists. */
  readonly baseUrl?: string
  /** Model id the server is serving or was asked to serve. */
  readonly modelId?: string
}

/** Everything the catalog and the dispatch gate read from the models directory. */
export interface LocalModelsDirectoryState {
  /** Absolute models directory the documents were read from. */
  readonly directory: string
  /** Registry entries with usable string fields, in registry order. */
  readonly models: readonly LocalRegistryModel[]
  /** The operator's settings, narrowed to the fields this package reads. */
  readonly settings: LocalModelsSettings
  /** The published server state, or undefined when no usable document exists. */
  readonly server: LocalServerState | undefined
}

/**
 * Whether one local-model call may dispatch, and where.
 * Decided from the published server state alone; the endpoint itself is the
 * final authority once a request is sent.
 */
export type LocalDispatch =
  | { readonly kind: 'ready'; readonly baseUrl: string }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'error' }
  | { readonly kind: 'serving-other'; readonly servingModelId: string }

const SERVER_STATUSES: readonly string[] = ['stopped', 'starting', 'running', 'error']

/**
 * Resolve the directory holding the desktop's downloaded models and its
 * state documents. Mirrors the desktop's `resolveModelsDirectory` and the
 * runner's `resolveLocalModelsDirectory`: an explicit override wins, then
 * `DSH_LOCAL_MODELS_DIR`, then `%LOCALAPPDATA%\SecScan Red Team\models` on
 * Windows, then `~/.secscan-redteam/models`.
 * @param environment - environment to read (defaults to `process.env`).
 * @param override - explicit directory from plugin configuration, when set.
 * @returns absolute models directory.
 */
export function resolveLocalModelsDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  override?: string,
): string {
  const configured = override?.trim()
  if (configured !== undefined && configured !== '') return resolve(configured)
  const fromEnvironment = environment[LOCAL_MODELS_DIR_ENV]?.trim()
  if (fromEnvironment !== undefined && fromEnvironment !== '') return resolve(fromEnvironment)
  if (process.platform === 'win32') {
    const localAppData = environment['LOCALAPPDATA']?.trim()
    if (localAppData !== undefined && localAppData !== '') {
      return join(localAppData, 'SecScan Red Team', 'models')
    }
  }
  return join(homedir(), '.secscan-redteam', 'models')
}

/**
 * Read one JSON document, tolerating a missing or unparseable file.
 * @param path - absolute document path.
 * @returns the parsed value as a record, or undefined when unusable.
 */
function readJsonDocument(path: string): Record<string, unknown> | undefined {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    // A missing document is the normal no-local-models state, not a failure.
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    // A document mid-write or corrupt reads as absent; the next read retries.
    return undefined
  }
}

/**
 * @param value - candidate document field.
 * @returns the value when it is a non-empty string.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Read the registry, settings, and server-state documents of one models
 * directory. Every document is optional; absence narrows the result instead
 * of failing.
 * @param directory - absolute models directory.
 * @returns the directory state the catalog and the dispatch gate consume.
 */
export function readLocalModelsDirectory(directory: string): LocalModelsDirectoryState {
  const registry = readJsonDocument(join(directory, REGISTRY_FILENAME))
  const models: LocalRegistryModel[] = []
  const entries = registry && Array.isArray(registry['models']) ? registry['models'] : []
  for (const item of entries) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const id = nonEmptyString(entry['id'])
    const file = nonEmptyString(entry['file'])
    const path = nonEmptyString(entry['path'])
    if (id !== undefined && file !== undefined && path !== undefined) models.push({ id, file, path })
  }

  const settingsDocument = readJsonDocument(join(directory, SETTINGS_FILENAME))
  const activeModelId = settingsDocument ? nonEmptyString(settingsDocument['activeModelId']) : undefined
  const rawContext = settingsDocument?.['contextLength']
  const contextLength = typeof rawContext === 'number' && Number.isFinite(rawContext) && rawContext > 0
    ? Math.floor(rawContext)
    : undefined
  const settings: LocalModelsSettings = {
    ...activeModelId === undefined ? {} : { activeModelId },
    ...contextLength === undefined ? {} : { contextLength },
  }

  return { directory, models, settings, server: readLocalServerState(directory) }
}

/**
 * Read and validate the published server-state document of one models
 * directory, applying the desktop reader's validation: schema version,
 * known status, finite write timestamp.
 * @param directory - absolute models directory.
 * @returns the published state, or undefined when there is nothing usable.
 */
export function readLocalServerState(directory: string): LocalServerState | undefined {
  const document = readJsonDocument(join(directory, SERVER_STATE_FILENAME))
  if (document === undefined || document['version'] !== SERVER_STATE_VERSION) return undefined
  const status = document['status']
  if (typeof status !== 'string' || !SERVER_STATUSES.includes(status)) return undefined
  const updatedAt = document['updatedAt']
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return undefined
  const baseUrl = document['baseUrl']
  const modelId = document['modelId']
  if (baseUrl !== undefined && typeof baseUrl !== 'string') return undefined
  if (modelId !== undefined && typeof modelId !== 'string') return undefined
  return {
    status: status as LocalServerState['status'],
    ...baseUrl === undefined ? {} : { baseUrl },
    ...modelId === undefined ? {} : { modelId },
  }
}

/**
 * Decide whether a call for one model may dispatch to the bundled server.
 * The server serves one model at a time: a running state naming a different
 * model is a refusal with the served model named, not a dispatch the
 * endpoint would misroute.
 * @param server - the published server state, or undefined when absent.
 * @param modelId - the registry id the caller selected.
 * @returns the dispatch decision.
 */
export function resolveLocalDispatch(server: LocalServerState | undefined, modelId: string): LocalDispatch {
  if (server === undefined) return { kind: 'stopped' }
  switch (server.status) {
    case 'stopped':
      return { kind: 'stopped' }
    case 'starting':
      return { kind: 'starting' }
    case 'error':
      return { kind: 'error' }
    case 'running': {
      if (server.baseUrl === undefined || server.baseUrl === '') return { kind: 'error' }
      if (server.modelId !== undefined && server.modelId !== modelId) {
        return { kind: 'serving-other', servingModelId: server.modelId }
      }
      return { kind: 'ready', baseUrl: server.baseUrl }
    }
  }
}

/**
 * Picker label for one registry model: the GGUF file stem plus the local
 * marker, the same label the runner console's catalog builds.
 * @param model - the registry entry.
 * @returns the display name, e.g. `Qwen3.6-35B · Local`.
 */
export function localModelLabel(model: LocalRegistryModel): string {
  return `${basename(model.file).replace(/\.gguf$/i, '')} · Local`
}

/** The state documents whose changes can change the catalog or the gate. */
const WATCHED_FILENAMES: ReadonlySet<string> = new Set([REGISTRY_FILENAME, SETTINGS_FILENAME, SERVER_STATE_FILENAME])

/** Injectable watcher seams; production passes nothing. */
export interface LocalModelsWatchOptions {
  /** Debounce window applied to change notifications, in milliseconds. */
  readonly debounceMs?: number
  /** Watch factory, defaulting to `node:fs` `watch`. */
  readonly watchImpl?: (path: string) => FSWatcher
}

/**
 * Watch the models directory and notify after its state documents change,
 * so a model downloaded or a server started after the Host booted still
 * reaches the catalog. Watches the directory itself when it exists and its
 * parent otherwise, re-arming when the target changes; notifications are
 * debounced and the watcher never throws into the caller.
 * @param directory - absolute models directory.
 * @param notify - called after a debounced change to a state document.
 * @param options - debounce and watcher seams.
 * @returns the disposer; calling it closes the watcher and cancels any pending notification.
 */
export function watchLocalModelsDirectory(
  directory: string,
  notify: () => void,
  options: LocalModelsWatchOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? 300
  const watchImpl = options.watchImpl ?? ((path: string) => watch(path))
  let watcher: FSWatcher | undefined
  let watchedPath: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (!closed) notify()
    }, debounceMs)
  }

  const arm = (): void => {
    const target = existsSync(directory) ? directory : dirname(directory)
    if (watcher !== undefined && watchedPath === target) return
    watcher?.close()
    watcher = undefined
    watchedPath = undefined
    try {
      watcher = watchImpl(target)
      watchedPath = target
      watcher.on('change', (_event, filename) => {
        if (closed) return
        const name = typeof filename === 'string' ? filename : filename.toString()
        if (watchedPath === directory && name !== '' && !WATCHED_FILENAMES.has(name)) return
        schedule()
        arm()
      })
      watcher.on('error', () => { /* a dead watcher only loses live refresh; reads stay correct */ })
    } catch {
      // Watching is a refresh convenience: an unwatcheable directory still
      // reads correctly on every catalog load, so absence stays silent.
      watcher = undefined
      watchedPath = undefined
    }
  }

  arm()
  return () => {
    closed = true
    if (timer !== undefined) clearTimeout(timer)
    watcher?.close()
    watcher = undefined
  }
}
