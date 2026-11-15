/**
 * Persisted Ollama selection.
 *
 * The Hugging Face feature remembers `activeModelId`; Ollama needs the same so a
 * chosen model survives a relaunch and the shell can republish the fleet
 * selection at startup. Kept beside the downloaded-model registry so a test temp
 * directory isolates it, written atomically, and read totally: a missing or
 * corrupt document yields "nothing selected" rather than throwing.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveModelsDirectory } from './llama-models.ts'
import { OLLAMA_BASE_URL_ENV, OLLAMA_DEFAULT_BASE_URL } from './ollama-client.ts'
import type { OllamaSelection } from './ollama-api.ts'

/** File name of the selection document inside the models directory. */
export const OLLAMA_SETTINGS_FILENAME = 'ollama-settings.json'

/** Schema version written to disk. */
const VERSION = 1

/** The selection used when no document exists. */
export const DEFAULT_OLLAMA_SELECTION: OllamaSelection = Object.freeze({
  activeModel: null,
  baseUrl: OLLAMA_DEFAULT_BASE_URL,
})

/**
 * @param environment - process environment supplying the models directory and daemon address.
 * @returns absolute path of the selection document.
 */
export function resolveOllamaSettingsPath(environment: NodeJS.ProcessEnv = process.env): string {
  return join(resolveModelsDirectory(environment), OLLAMA_SETTINGS_FILENAME)
}

/**
 * @param value - candidate model name.
 * @returns the trimmed name, or null when absent or blank.
 */
function modelName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name === '' ? null : name
}

/**
 * Read the persisted selection.
 * @param environment - process environment.
 * @returns the normalized selection; the default when nothing usable is on disk.
 */
export function readOllamaSelection(environment: NodeJS.ProcessEnv = process.env): OllamaSelection {
  const fallbackBase = environment[OLLAMA_BASE_URL_ENV]?.trim()
  const fallback: OllamaSelection = {
    activeModel: null,
    baseUrl: fallbackBase !== undefined && fallbackBase !== '' ? fallbackBase : OLLAMA_DEFAULT_BASE_URL,
  }
  let raw: string
  try {
    raw = readFileSync(resolveOllamaSettingsPath(environment), 'utf8')
  } catch {
    return fallback
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback
    const document = parsed as Record<string, unknown>
    if (document['version'] !== VERSION) return fallback
    const baseUrl = typeof document['baseUrl'] === 'string' && document['baseUrl'].trim() !== ''
      ? document['baseUrl'].trim()
      : fallback.baseUrl
    return { activeModel: modelName(document['activeModel']), baseUrl }
  } catch {
    return fallback
  }
}

/**
 * Persist the selection atomically.
 * @param input - candidate selection; unknown fields are ignored.
 * @param environment - process environment.
 * @returns the normalized selection now on disk.
 */
export function writeOllamaSelection(input: unknown, environment: NodeJS.ProcessEnv = process.env): OllamaSelection {
  const source = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const baseUrl = typeof source['baseUrl'] === 'string' && source['baseUrl'].trim() !== ''
    ? source['baseUrl'].trim()
    : readOllamaSelection(environment).baseUrl
  const selection: OllamaSelection = { activeModel: modelName(source['activeModel']), baseUrl }
  const file = resolveOllamaSettingsPath(environment)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: VERSION, ...selection }, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
  } catch (error) {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // The original write error is the one the caller must see.
    }
    throw error
  }
  return selection
}
