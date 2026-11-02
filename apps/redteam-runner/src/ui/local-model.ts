/**
 * The desktop's local model, as the model catalog sees it.
 *
 * The desktop app owns the bundled llama-server: it downloads GGUF models
 * into a models directory (`registry.json`), records the operator's pick in
 * `settings.json` (`activeModelId`), and — since the picker fix — publishes
 * the server's live state to `server-state.json` on every transition (the
 * document's schema is owned by `apps/desktop/src/llama-server-state.ts`).
 * The runner is a separate process spawned once, so this module reads those
 * documents at request time and then PROBES the published endpoint: an
 * entry is produced only while the server provably serves the active
 * model. A stopped server, a crashed desktop, a missing file — everything
 * fails soft to no entry, so the chat picker never offers a model that
 * would error on send.
 *
 * Path resolution mirrors the desktop's `resolveModelsDirectory`:
 * `DSH_LOCAL_MODELS_DIR` wins, then `%LOCALAPPDATA%\SecScan Red Team\models`
 * on Windows, then `~/.secscan-redteam/models`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** One pickable local model: the active GGUF while its server is serving it. */
export interface LocalModelEntry {
  readonly provider: 'local'
  /** The model id the server answers to (the registry id, its `--alias`). */
  readonly model: string
  /** Picker label: the model's file stem plus its local marker. */
  readonly label: string
  /** OpenAI-compatible base URL of the serving endpoint (`.../v1`). */
  readonly baseUrl: string
}

/**
 * Ask an endpoint which models it serves. Resolves to the served model ids,
 * or null when the endpoint does not answer with a usable list. Injectable
 * so tests never open a socket.
 */
export type LocalModelProbe = (baseUrl: string) => Promise<readonly string[] | null>

/** How long a catalog lookup waits for the local endpoint to answer. */
const PROBE_TIMEOUT_MS = 800

/**
 * Resolve the directory holding the desktop's downloaded models and its
 * state documents.
 * @param env - Environment to read (defaults to `process.env`).
 * @returns absolute models directory.
 */
export function resolveLocalModelsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['DSH_LOCAL_MODELS_DIR']?.trim()
  if (override !== undefined && override !== '') return resolve(override)
  if (process.platform === 'win32') {
    const localAppData = env['LOCALAPPDATA']?.trim()
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
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
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
 * The default probe: `GET {baseUrl}/models` against the llama.cpp
 * OpenAI-compatible surface. llama.cpp answers with the loaded model's id
 * (the registry id, published through `--alias`) in the `data` list; some
 * builds also carry a `models` list — both are read.
 * @param baseUrl - the published endpoint root (`.../v1`).
 * @returns served model ids, or null when the endpoint does not answer.
 */
async function probeServedModelIds(baseUrl: string): Promise<readonly string[] | null> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  } catch {
    return null
  }
  if (!res.ok) return null
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  const ids: string[] = []
  for (const key of ['data', 'models'] as const) {
    const list = record[key]
    if (!Array.isArray(list)) continue
    for (const item of list as unknown[]) {
      if (typeof item !== 'object' || item === null) continue
      const entry = item as Record<string, unknown>
      const id = nonEmptyString(entry['id']) ?? nonEmptyString(entry['name'])
      if (id !== undefined) ids.push(id)
    }
  }
  return ids
}

/**
 * Resolve the pickable local model right now: the registry's active model,
 * while the published server state says its server is running AND the
 * endpoint itself confirms it serves that model.
 * @param env - Environment to read (defaults to `process.env`).
 * @param probe - Endpoint probe seam (tests substitute a fake).
 * @returns the catalog entry, or null when no local model is pickable.
 */
export async function readLocalModelEntry(
  env: NodeJS.ProcessEnv = process.env,
  probe: LocalModelProbe = probeServedModelIds,
): Promise<LocalModelEntry | null> {
  const directory = resolveLocalModelsDirectory(env)

  const settings = readJsonDocument(join(directory, 'settings.json'))
  const activeModelId = settings ? nonEmptyString(settings['activeModelId']) : undefined
  if (activeModelId === undefined) return null

  const registry = readJsonDocument(join(directory, 'registry.json'))
  const models = registry && Array.isArray(registry['models']) ? registry['models'] : []
  let modelFile: string | undefined
  let modelPath: string | undefined
  for (const item of models as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    if (entry['id'] === activeModelId) {
      modelFile = nonEmptyString(entry['file'])
      modelPath = nonEmptyString(entry['path'])
      break
    }
  }
  // An active id the registry no longer holds (or whose file is gone) is
  // not a model the operator can pick.
  if (modelFile === undefined || modelPath === undefined || !existsSync(modelPath)) return null

  const state = readJsonDocument(join(directory, 'server-state.json'))
  if (!state || state['status'] !== 'running') return null
  const baseUrl = nonEmptyString(state['baseUrl'])
  if (baseUrl === undefined || state['modelId'] !== activeModelId) return null

  // The document alone is not proof: the desktop may have died since it
  // wrote it. The endpoint must confirm it serves the active model.
  let served: readonly string[] | null
  try {
    served = await probe(baseUrl)
  } catch {
    served = null
  }
  if (served === null || !served.includes(activeModelId)) return null

  const stem = basename(modelFile).replace(/\.gguf$/i, '')
  return { provider: 'local', model: activeModelId, label: `${stem} · Local`, baseUrl }
}
