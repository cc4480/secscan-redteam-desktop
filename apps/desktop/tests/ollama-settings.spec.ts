/** Ollama selection persistence: defaults, round-trip, corruption tolerance. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_OLLAMA_SELECTION,
  OLLAMA_SETTINGS_FILENAME,
  readOllamaSelection,
  resolveOllamaSettingsPath,
  writeOllamaSelection,
} from '../src/ollama-settings.ts'

let directory: string | undefined

/** @returns an environment pinning the models directory to a fresh temp dir. */
function isolated(): NodeJS.ProcessEnv {
  directory ??= mkdtempSync(join(tmpdir(), 'ollama-settings-'))
  return { DSH_LOCAL_MODELS_DIR: directory }
}

afterEach(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('ollama selection', () => {
  it('reports the default when nothing has been saved', () => {
    const environment = isolated()
    expect(readOllamaSelection(environment)).toEqual(DEFAULT_OLLAMA_SELECTION)
  })

  it('round-trips a chosen model and address', () => {
    const environment = isolated()
    const written = writeOllamaSelection(
      { activeModel: 'llama3.2:3b', baseUrl: 'http://127.0.0.1:11434' },
      environment,
    )
    expect(written).toEqual({ activeModel: 'llama3.2:3b', baseUrl: 'http://127.0.0.1:11434' })
    expect(readOllamaSelection(environment)).toEqual(written)
  })

  it('falls back to the environment address when the environment names one', () => {
    const environment = { ...isolated(), OLLAMA_BASE_URL: 'http://127.0.0.1:12345' }
    expect(readOllamaSelection(environment).baseUrl).toBe('http://127.0.0.1:12345')
  })

  it('treats a corrupt document as nothing selected', () => {
    const environment = isolated()
    writeFileSync(resolveOllamaSettingsPath(environment), '{ not json', 'utf8')
    expect(readOllamaSelection(environment)).toEqual(DEFAULT_OLLAMA_SELECTION)
  })

  it('normalizes a blank model name to null', () => {
    const environment = isolated()
    expect(writeOllamaSelection({ activeModel: '   ', baseUrl: 'http://x' }, environment).activeModel).toBeNull()
  })

  it('writes the document under the models directory', () => {
    const environment = isolated()
    writeOllamaSelection({ activeModel: 'm', baseUrl: 'http://x' }, environment)
    expect(resolveOllamaSettingsPath(environment).endsWith(OLLAMA_SETTINGS_FILENAME)).toBe(true)
  })
})
