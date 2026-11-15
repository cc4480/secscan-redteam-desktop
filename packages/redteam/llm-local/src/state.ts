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

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
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
  /** Hugging Face repository the model was downloaded from, when the registry records it. */
  readonly repo?: string
  /** Absolute path of the model's vision projector companion, when the registry records one. */
  readonly companionPath?: string
}

/** The operator's local-model settings, narrowed to the fields this package reads. */
export interface LocalModelsSettings {
  /** Registry id of the operator's active model, when one is selected. */
  readonly activeModelId?: string
  /**
   * Context length the operator configured for the llama server, when
   * valid. This is the llama mode value: the bundled server serves one
   * model at a time, so one global value is the store's shape for it,
   * and `llama.ts` reads this same field into the server's `-c` argv.
   */
  readonly contextLength?: number
  /**
   * Per-model context lengths the operator configured in Ollama mode,
   * keyed by model id. Ollama serves many models from one endpoint, so
   * a single global value (the llama shape above) would silently apply
   * one model's setting to every other model; the per-model record is
   * the minimal extension of the same `settings.json` document. Absent
   * for a model means unset: Start loads it at its catalog maximum.
   */
  readonly contextLengthByModel?: Readonly<Record<string, number>>
  /** Thread count the operator configured for the server, when valid. */
  readonly threads?: number
}

/**
 * Largest context length a set may persist, mirroring the desktop
 * settings bound `llama.ts` clamps the llama server's `-c` to
 * (`CONTEXT_LENGTH_MAX` there). A set above a model's own known
 * maximum is rejected against that maximum first; this is the ceiling
 * when no per-model maximum is known.
 */
export const LOCAL_MODEL_CONTEXT_LENGTH_MAX = 262144

/** Smallest context length the llama server accepts (the desktop settings bound `llama.ts` clamps `-c` to). */
export const LOCAL_MODEL_CONTEXT_LENGTH_MIN_LLAMA = 1024

/** One published llama-server state document, as the desktop writes it. */
export interface LocalServerState {
  /** Server lifecycle state. */
  readonly status: 'stopped' | 'starting' | 'running' | 'error'
  /** OpenAI-compatible base URL (`http://127.0.0.1:<port>/v1`), present while an endpoint exists. */
  readonly baseUrl?: string
  /** Model id the server is serving or was asked to serve. */
  readonly modelId?: string
  /**
   * Process id of the server, recorded by the host when the host started
   * it (an extension of the desktop's document: the desktop supervises
   * its own child in-process and records no pid, so a document without
   * one names a server this host did not start). When a switch spawns a
   * replacement while the previous child's exit has not yet been
   * observed, the previous pid is carried here so the next stop can
   * still reach it; the array is emptied once the primary `pid` has
   * exited.
   */
  readonly pid?: number
  /** Previously spawned pids whose exit this host has not yet observed (leak insurance). */
  readonly previousPids?: readonly number[]
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
  | { readonly kind: 'serving-other'; readonly servingModelId: string; readonly baseUrl: string }

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
    if (id === undefined || file === undefined || path === undefined) continue
    const repo = nonEmptyString(entry['repo'])
    const companionPath = nonEmptyString(entry['companionPath'])
    models.push({
      id,
      file,
      path,
      ...repo === undefined ? {} : { repo },
      ...companionPath === undefined ? {} : { companionPath },
    })
  }

  const settingsDocument = readJsonDocument(join(directory, SETTINGS_FILENAME))
  const activeModelId = settingsDocument ? nonEmptyString(settingsDocument['activeModelId']) : undefined
  const rawContext = settingsDocument?.['contextLength']
  const contextLength = typeof rawContext === 'number' && Number.isFinite(rawContext) && rawContext > 0
    ? Math.floor(rawContext)
    : undefined
  const rawThreads = settingsDocument?.['threads']
  const threads = typeof rawThreads === 'number' && Number.isFinite(rawThreads) && rawThreads > 0
    ? Math.floor(rawThreads)
    : undefined
  const rawByModel = settingsDocument?.['contextLengthByModel']
  const contextLengthByModel: Record<string, number> = {}
  if (typeof rawByModel === 'object' && rawByModel !== null && !Array.isArray(rawByModel)) {
    for (const [modelId, value] of Object.entries(rawByModel as Record<string, unknown>)) {
      if (modelId !== '' && typeof value === 'number' && Number.isFinite(value) && value > 0) {
        contextLengthByModel[modelId] = Math.floor(value)
      }
    }
  }
  const settings: LocalModelsSettings = {
    ...activeModelId === undefined ? {} : { activeModelId },
    ...contextLength === undefined ? {} : { contextLength },
    ...Object.keys(contextLengthByModel).length === 0 ? {} : { contextLengthByModel },
    ...threads === undefined ? {} : { threads },
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
  const pid = document['pid']
  const validPid = typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
  const rawPrevious = document['previousPids']
  const previousPids = Array.isArray(rawPrevious)
    ? rawPrevious
        .filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    : undefined
  return {
    status: status as LocalServerState['status'],
    ...baseUrl === undefined ? {} : { baseUrl },
    ...modelId === undefined ? {} : { modelId },
    ...validPid === undefined ? {} : { pid: validPid },
    ...previousPids === undefined || previousPids.length === 0 ? {} : { previousPids },
  }
}

/**
 * Publish one server state into a models directory, replacing the
 * document atomically (same-directory temporary file plus rename, the
 * desktop writer's pattern in `llama-server-state.ts`), so a reader
 * never observes a partial document. The host writes this document for
 * the servers it starts and stops; the format is the desktop's
 * (version, status, baseUrl, modelId, updatedAt) plus the host's pid
 * extension.
 * @param directory - absolute models directory.
 * @param state - the server state to publish.
 */
export function writeLocalServerState(directory: string, state: LocalServerState): void {
  const document = {
    version: SERVER_STATE_VERSION,
    status: state.status,
    ...state.baseUrl === undefined ? {} : { baseUrl: state.baseUrl },
    ...state.modelId === undefined ? {} : { modelId: state.modelId },
    ...state.pid === undefined ? {} : { pid: state.pid },
    ...state.previousPids === undefined || state.previousPids.length === 0
      ? {}
      : { previousPids: state.previousPids },
    updatedAt: Date.now(),
  }
  const file = join(directory, SERVER_STATE_FILENAME)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
  } catch (error) {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Keep the original write error; the temporary name is unique and stale.
    }
    throw error
  }
}

/** One settings update for {@link writeLocalModelsSettings}: a number sets a field, `null` clears it. */
export interface LocalModelsSettingsUpdate {
  /** New global (llama mode) context length, or `null` to clear it back to the server default. */
  readonly contextLength?: number | null
  /** Per-model (Ollama mode) context lengths to set, keyed by model id; a `null` value clears that model's entry back to its catalog maximum. */
  readonly contextLengthByModel?: Readonly<Record<string, number | null>>
}

/**
 * Apply one update to a models directory's `settings.json`, preserving
 * every field this package does not own (the desktop's `version`,
 * `huggingFaceToken`, and any future fields ride through untouched),
 * and publish the result atomically — the same same-directory
 * temporary file plus rename {@link writeLocalServerState} uses, so a
 * reader never observes a partial document.
 * @param directory - absolute models directory.
 * @param update - the fields to set or clear.
 */
export function writeLocalModelsSettings(directory: string, update: LocalModelsSettingsUpdate): void {
  const document: Record<string, unknown> = { ...readJsonDocument(join(directory, SETTINGS_FILENAME)) ?? {} }
  if (update.contextLength !== undefined) {
    if (update.contextLength === null) delete document['contextLength']
    else document['contextLength'] = update.contextLength
  }
  if (update.contextLengthByModel !== undefined) {
    const existing = document['contextLengthByModel']
    const byModel: Record<string, unknown> = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...existing as Record<string, unknown> }
      : {}
    for (const [modelId, value] of Object.entries(update.contextLengthByModel)) {
      if (value === null) delete byModel[modelId]
      else byModel[modelId] = value
    }
    if (Object.keys(byModel).length === 0) delete document['contextLengthByModel']
    else document['contextLengthByModel'] = byModel
  }
  const file = join(directory, SETTINGS_FILENAME)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
  } catch (error) {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Keep the original write error; the temporary name is unique and stale.
    }
    throw error
  }
}

/**
 * The persisted context length one model starts with in Ollama mode,
 * in the precedence Start must honor: the operator's persisted
 * per-model value wins, then the adapter's construction (plugin
 * configuration) override, then the model's catalog maximum — the
 * default an unset model loads at.
 * @param persisted - the store's per-model value for the model, when set.
 * @param constructionOverride - the adapter construction override, when set.
 * @param catalogMaximum - the model's catalog maximum, when known.
 * @returns the context length to load with, or undefined when no source names one.
 */
export function resolveEffectiveOllamaContextLength(
  persisted: number | undefined,
  constructionOverride: number | undefined,
  catalogMaximum: number | undefined,
): number | undefined {
  return persisted ?? constructionOverride ?? catalogMaximum
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
        return { kind: 'serving-other', servingModelId: server.modelId, baseUrl: server.baseUrl }
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
