/**
 * Local GGUF model store: directory resolution, registry persistence, id
 * derivation and file-name metadata.
 *
 * Every mutation rewrites `<models>/registry.json` atomically (temporary file
 * plus rename) and mutations are serialized in this process, so a UI delete and
 * a finishing download cannot overwrite each other with a stale snapshot.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import type { LlamaModel } from './llama-api.ts'

/** Environment variable pinning the models directory (tests and operators). */
export const LOCAL_MODELS_DIR_ENV = 'DSH_LOCAL_MODELS_DIR'

/** Registry document name inside the models directory. */
export const MODEL_REGISTRY_FILENAME = 'registry.json'

/** Suffix of a partially downloaded model file. */
export const MODEL_PARTIAL_SUFFIX = '.part'

/** On-disk registry schema version. */
export const MODEL_REGISTRY_VERSION = 1

/** Product directory under `%LOCALAPPDATA%` on Windows. */
const APP_DIRECTORY = 'SecScan Red Team'

/** Home-relative fallback used outside Windows. */
const FALLBACK_DIRECTORY = '.secscan-redteam'

/** Models directory name inside either root. */
const MODELS_DIRECTORY = 'models'

/** Download metadata of one GGUF file, keyed by id. */
export interface ModelRegistry {
  readonly version: typeof MODEL_REGISTRY_VERSION
  readonly models: readonly LlamaModel[]
}

/** Quantization and parameter size parsed from a model file name. */
export interface LlamaModelMetadata {
  readonly quantization?: string
  readonly parameterSize?: string
}

/** Repository and file name an id is derived from. */
export interface ModelIdInput {
  readonly repo: string
  readonly file: string
}

/** In-process mutation tail; registry writes are read-modify-write. */
let storeTail: Promise<unknown> = Promise.resolve()
/** Distinguishes temporary files written by concurrent processes. */
let temporarySequence = 0

/**
 * Resolve the directory that holds downloaded GGUF files.
 *
 * `%LOCALAPPDATA%\SecScan Red Team\models` on Windows; a home-relative
 * `.secscan-redteam/models` elsewhere (and on Windows without `LOCALAPPDATA`).
 * `DSH_LOCAL_MODELS_DIR` overrides both, which is what tests use. Resolution is
 * side-effect free; the directory is created by {@link ensureModelsDirectory}
 * and by the first registry write.
 * @param environment - environment holding the override and the platform roots.
 * @returns absolute models directory.
 */
export function resolveModelsDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment[LOCAL_MODELS_DIR_ENV]?.trim()
  if (override !== undefined && override !== '') return resolve(override)
  if (process.platform === 'win32') {
    const localAppData = environment['LOCALAPPDATA']?.trim()
    if (localAppData !== undefined && localAppData !== '') return join(localAppData, APP_DIRECTORY, MODELS_DIRECTORY)
  }
  return join(homedir(), FALLBACK_DIRECTORY, MODELS_DIRECTORY)
}

/**
 * Resolve the registry document path inside the models directory.
 * @param environment - environment holding the override and the platform roots.
 * @returns absolute `registry.json` path.
 */
export function resolveRegistryPath(environment: NodeJS.ProcessEnv = process.env): string {
  return join(resolveModelsDirectory(environment), MODEL_REGISTRY_FILENAME)
}

/**
 * Create the models directory on first use.
 * @param environment - environment holding the override and the platform roots.
 * @returns the absolute models directory.
 */
export async function ensureModelsDirectory(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const directory = resolveModelsDirectory(environment)
  await mkdir(directory, { recursive: true })
  return directory
}

/**
 * List installed models, newest download first.
 *
 * A missing or corrupt registry reads as no entries, and entries whose file is
 * gone (a manual deletion or an interrupted download) are dropped from the
 * result. `sizeBytes` reports the file's current size on disk.
 * @param environment - environment holding the override and the platform roots.
 * @returns present models ordered by descending `downloadedAt`.
 */
export async function listModels(environment: NodeJS.ProcessEnv = process.env): Promise<LlamaModel[]> {
  const directory = resolveModelsDirectory(environment)
  const models = await readRegistryModels(directory)
  const present: LlamaModel[] = []
  for (const model of models) {
    const details = await stat(model.path).catch(() => undefined)
    if (details === undefined || !details.isFile()) continue
    present.push({ ...model, sizeBytes: details.size })
  }
  return present.sort((left, right) => right.downloadedAt - left.downloadedAt || left.id.localeCompare(right.id))
}

/**
 * Insert or replace one model and persist the registry atomically.
 * @param model - validated download metadata; an existing entry with the same id is replaced.
 * @param environment - environment holding the override and the platform roots.
 * @returns the registered model.
 */
export function registerModel(model: LlamaModel, environment: NodeJS.ProcessEnv = process.env): Promise<LlamaModel> {
  const directory = resolveModelsDirectory(environment)
  return serializeStore(async () => {
    const models = await readRegistryModels(directory)
    await writeRegistry(directory, [...models.filter(entry => entry.id !== model.id), model])
    return model
  })
}

/**
 * Delete a model file, its partial download sidecar and the registry entry.
 *
 * Unknown ids and already-missing files are a successful no-op so the UI can
 * retry a delete without special cases.
 * @param id - model id to remove.
 * @param environment - environment holding the override and the platform roots.
 */
export function deleteModel(id: string, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const directory = resolveModelsDirectory(environment)
  return serializeStore(async () => {
    const models = await readRegistryModels(directory)
    const target = models.find(entry => entry.id === id)
    if (target === undefined) return
    await rm(target.path, { force: true })
    await rm(`${target.path}${MODEL_PARTIAL_SUFFIX}`, { force: true })
    await writeRegistry(directory, models.filter(entry => entry.id !== id))
  })
}

/**
 * Derive the stable model id `<owner>--<name>--<stem>`.
 *
 * Each part is lowercased, every run of non-alphanumerics becomes one hyphen
 * and the ends are trimmed; the parts keep their `--` separators so the scheme
 * stays readable. A repository without an owner segment contributes only its
 * name, e.g. `gpt2--gpt2-q4-0`. Callers register by this id, so two names that
 * normalize to the same id are the same model (the later registration wins).
 * @param input - Hugging Face repository and file name.
 * @returns normalized id.
 */
export function deriveModelId(input: ModelIdInput): string {
  const [first, ...rest] = input.repo.split('/').map(normalizeIdPart).filter(part => part !== '')
  if (first === undefined) throw new Error('local models: cannot derive an id from an empty repository')
  const stem = normalizeIdPart(fileStem(input.file))
  if (stem === '') throw new Error('local models: cannot derive an id from an empty file name')
  if (rest.length === 0) return `${first}--${stem}`
  return `${first}--${rest.join('-')}--${stem}`
}

/** Whole-token GGUF quantization labels. */
const QUANTIZATION_TOKEN = /^(?:IQ[1-4](?:_[A-Z0-9]+)+|Q[2-8](?:_[A-Z0-9]+)+|BF16|F16|F32)$/i

/** `<number><B|M>` parameter size not glued to letters, digits or a version dot (case-insensitive). */
const PARAMETER_SIZE_TOKEN = /(?<![A-Z0-9.])(?<value>\d+(?:\.\d+)?)(?<unit>[BM])(?![A-Z0-9])/gi

/**
 * Parse quantization and parameter size from a model file name.
 *
 * Quantization labels (`Q4_K_M`, `IQ4_XS`, `Q8_0`, `F16`, ...) are recognized as
 * whole name tokens; the parameter size (`27B`, `8B`, `1.5B`, `350M`) is the
 * last `<number><B|M>` token that is not glued to a word or a version dot.
 * @param file - file name or path of a GGUF file.
 * @returns whichever labels the name carries, or an empty object.
 */
export function parseModelMetadata(file: string): LlamaModelMetadata {
  const name = basename(file)
  let quantization: string | undefined
  for (const token of name.split(/[^A-Za-z0-9_]+/)) {
    if (QUANTIZATION_TOKEN.test(token)) quantization = token.toUpperCase()
  }
  let parameterSize: string | undefined
  for (const match of name.matchAll(PARAMETER_SIZE_TOKEN)) {
    const value = match.groups?.['value']
    const unit = match.groups?.['unit']
    if (value !== undefined && unit !== undefined) parameterSize = `${value}${unit.toUpperCase()}`
  }
  return {
    ...quantization === undefined ? {} : { quantization },
    ...parameterSize === undefined ? {} : { parameterSize },
  }
}

/**
 * @returns the file name with its final extension removed.
 */
function fileStem(file: string): string {
  const name = basename(file)
  return name.slice(0, name.length - extname(name).length)
}

/**
 * @returns lowercase, hyphen-collapsed form of one id part.
 */
function normalizeIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Run one registry mutation after every earlier mutation settled.
 * @param action - read-modify-write step to serialize.
 * @returns the step's result.
 */
function serializeStore<T>(action: () => Promise<T>): Promise<T> {
  const result = storeTail.then(action, action)
  storeTail = result.then(() => undefined, () => undefined)
  return result
}

/**
 * Read the registry, tolerating a missing or corrupt document.
 * @param directory - absolute models directory.
 * @returns every valid registry entry, including entries whose file is missing.
 */
async function readRegistryModels(directory: string): Promise<LlamaModel[]> {
  try {
    return registryModels(await readFile(join(directory, MODEL_REGISTRY_FILENAME), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Replace the registry atomically with one complete model list.
 * @param directory - absolute models directory.
 * @param models - complete next model list.
 */
async function writeRegistry(directory: string, models: readonly LlamaModel[]): Promise<void> {
  await mkdir(directory, { recursive: true })
  const file = join(directory, MODEL_REGISTRY_FILENAME)
  temporarySequence += 1
  const temporary = `${file}.${process.pid}.${temporarySequence}.tmp`
  const document: ModelRegistry = { version: MODEL_REGISTRY_VERSION, models }
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Parse and validate a registry document.
 * @param raw - file contents.
 * @returns validated entries, or an empty list when the document is unusable.
 */
function registryModels(raw: string): LlamaModel[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
  const document = parsed as Record<string, unknown>
  if (document['version'] !== MODEL_REGISTRY_VERSION) return []
  const entries = document['models']
  if (!Array.isArray(entries)) return []
  const models: LlamaModel[] = []
  for (const entry of entries as unknown[]) {
    const model = registryModel(entry)
    if (model !== undefined) models.push(model)
  }
  return models
}

/**
 * Validate one registry entry, dropping fields this build does not know.
 * @param value - candidate entry from the registry document.
 * @returns the validated model, or undefined when required fields are unusable.
 */
function registryModel(value: unknown): LlamaModel | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const id = nonEmptyString(record['id'])
  const repo = nonEmptyString(record['repo'])
  const file = nonEmptyString(record['file'])
  const path = nonEmptyString(record['path'])
  if (id === undefined || repo === undefined || file === undefined || path === undefined) return undefined
  const sizeBytes = record['sizeBytes']
  const downloadedAt = record['downloadedAt']
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes)) return undefined
  if (typeof downloadedAt !== 'number' || !Number.isFinite(downloadedAt)) return undefined
  const quantization = nonEmptyString(record['quantization'])
  const parameterSize = nonEmptyString(record['parameterSize'])
  return {
    id,
    repo,
    file,
    path,
    sizeBytes,
    downloadedAt,
    ...quantization === undefined ? {} : { quantization },
    ...parameterSize === undefined ? {} : { parameterSize },
  }
}

/**
 * @returns the value when it is a non-empty string.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
