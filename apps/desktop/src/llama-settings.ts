/**
 * Persisted runtime settings for the bundled local-model feature.
 *
 * The document lives beside the downloaded models
 * (`<models dir>/settings.json`, redirectable with `DSH_LOCAL_MODELS_DIR`), so a
 * test temp directory fully isolates it. Reads are total: a missing, unreadable
 * or corrupt document yields the defaults and never throws. Writes normalize
 * exactly like reads and replace the file atomically (same-directory temporary
 * file + rename), so an interrupted write can never leave half a JSON document
 * and a reader never observes a partial one.
 *
 * Schema written to disk:
 *
 *   {
 *     "activeModelId": string | null,   // model id to serve on start
 *     "contextLength": number,          // integer, 1024..262144
 *     "threads": number,                // integer, 1..CPU count * 2
 *     "startOnLaunch": boolean,         // start llama-server with the app
 *     "huggingFaceToken": string        // optional; absent or "" means "not set"
 *   }
 *
 * `huggingFaceToken` is optional and never appears in a log or an error
 * message: this module performs no logging at all, and filesystem errors carry
 * paths and codes, never document contents. An empty token means "not set" and
 * is not persisted, so an unset token and an empty token read back identically.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { LlamaSettings } from './llama-api.ts'
import { LOCAL_MODELS_DIR_ENV, resolveModelsDirectory } from './llama-models.ts'

/** File name of the settings document inside the models directory. */
export const SETTINGS_FILENAME = 'settings.json'

/** Smallest accepted llama-server context window (`-c`). */
const CONTEXT_LENGTH_MIN = 1024

/** Largest accepted llama-server context window (`-c`). */
const CONTEXT_LENGTH_MAX = 262144

/** Context window used when the document carries no valid value. */
const DEFAULT_CONTEXT_LENGTH = 32768

/**
 * Logical CPU count, floored at one so the thread bound is always well formed
 * (a sandboxed host can report an empty CPU list).
 */
const CPU_COUNT = Math.max(1, cpus().length)

/** Largest accepted thread count (`-t`), twice the logical CPU count. */
const THREADS_MAX = CPU_COUNT * 2

/**
 * Settings used when no document exists or a field is missing or invalid.
 * `threads` defaults to the logical CPU count. A corrupt or absent document
 * always resolves to exactly these values.
 */
export const DEFAULT_SETTINGS: LlamaSettings = Object.freeze({
  activeModelId: null,
  contextLength: DEFAULT_CONTEXT_LENGTH,
  threads: CPU_COUNT,
  startOnLaunch: false,
})

/** A settings document's loose JSON shape before validation. */
type SettingsSource = Readonly<Record<string, unknown>>

/**
 * View arbitrary parsed JSON as a settings source object.
 * @param value - candidate document.
 * @returns the object form, or an empty object when the value is not an object.
 */
function settingsSource(value: unknown): SettingsSource {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as SettingsSource : {}
}

/**
 * Coerce a JSON value into an integer inside inclusive bounds.
 * @param value - number or numeric string from the document.
 * @param fallback - value used when `value` is not finite.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @returns the clamped integer.
 */
function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

/**
 * Coerce a JSON value into a boolean.
 * @param value - boolean, number (0 or 1) or string ("true"/"false"/"1"/"0").
 * @param fallback - value used when `value` is not a recognised boolean form.
 * @returns the coerced boolean.
 */
function coercedBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return fallback
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'true' || text === '1') return true
    if (text === 'false' || text === '0') return false
  }
  return fallback
}

/**
 * Coerce the persisted model id field.
 * @param value - candidate value.
 * @returns the trimmed id, or null when the field is absent, blank or not a string.
 */
function normalizedModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id === '' ? null : id
}

/**
 * Coerce the optional Hugging Face token.
 * @param value - candidate value.
 * @returns the trimmed token, or undefined when absent, blank or not a string.
 */
function normalizedToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const token = value.trim()
  return token === '' ? undefined : token
}

/**
 * A fresh defaults object so a caller can never mutate shared state.
 * @returns a copy of DEFAULT_SETTINGS.
 */
function defaults(): LlamaSettings {
  return { ...DEFAULT_SETTINGS }
}

/**
 * Validate a settings source and merge it over the defaults.
 * @param value - arbitrary parsed document.
 * @returns a complete, normalized settings object.
 */
function normalizeSettings(value: unknown): LlamaSettings {
  const source = settingsSource(value)
  const settings: LlamaSettings = {
    activeModelId: normalizedModelId(source.activeModelId),
    contextLength: boundedInteger(source.contextLength, DEFAULT_CONTEXT_LENGTH, CONTEXT_LENGTH_MIN, CONTEXT_LENGTH_MAX),
    threads: boundedInteger(source.threads, DEFAULT_SETTINGS.threads, 1, THREADS_MAX),
    startOnLaunch: coercedBoolean(source.startOnLaunch, DEFAULT_SETTINGS.startOnLaunch),
  }
  const huggingFaceToken = normalizedToken(source.huggingFaceToken)
  // exactOptionalPropertyTypes: an unset token is an absent key, never `undefined`.
  return huggingFaceToken === undefined ? settings : { ...settings, huggingFaceToken }
}

/**
 * Path of the settings document: the models directory with `settings.json`.
 * @param environment - process environment supplying `DSH_LOCAL_MODELS_DIR`.
 * @returns absolute path of the settings document.
 */
export function resolveSettingsPath(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment[LOCAL_MODELS_DIR_ENV]?.trim()
  if (override) return join(resolve(override), SETTINGS_FILENAME)
  return join(resolveModelsDirectory(environment), SETTINGS_FILENAME)
}

/**
 * Read the persisted settings, tolerating any unreadable or corrupt document.
 * Missing fields are merged over the defaults, numeric fields are clamped to
 * their accepted ranges, booleans are coerced, and an absent or empty token is
 * reported as an absent key.
 * @param environment - process environment supplying `DSH_LOCAL_MODELS_DIR`.
 * @returns the normalized settings; the defaults when there is nothing usable.
 */
export function readSettings(environment: NodeJS.ProcessEnv = process.env): LlamaSettings {
  let raw: string
  try {
    raw = readFileSync(resolveSettingsPath(environment), 'utf8')
  } catch {
    return defaults()
  }
  try {
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return defaults()
  }
}

/**
 * Validate and atomically persist the settings document.
 *
 * The document is written to a same-directory temporary file and renamed over
 * `settings.json`, so a reader never observes a partial document and a failed
 * write leaves the previous document untouched. The optional token is part of
 * the document only; it is never included in an error message.
 * @param input - candidate settings; unknown or non-object input normalizes to the defaults.
 * @param environment - process environment supplying `DSH_LOCAL_MODELS_DIR`.
 * @returns the normalized settings now on disk.
 */
export function writeSettings(input: unknown, environment: NodeJS.ProcessEnv = process.env): LlamaSettings {
  const settings = normalizeSettings(input)
  const file = resolveSettingsPath(environment)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    // 0600 before any byte lands: the document may carry an HF token, so it is
    // never group- or world-readable (Windows has no POSIX mode to set).
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    // Best effort: a stale temporary is harmless, the previous document is intact.
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Keep the original write error; the temporary name is unique and stale.
    }
    throw error
  }
  return settings
}
