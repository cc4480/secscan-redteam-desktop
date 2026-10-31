/** Persisted local-model settings: defaults, clamping, atomic writes and token hygiene. */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_FILENAME,
  readSettings,
  resolveSettingsPath,
  writeSettings,
} from '../src/llama-settings.ts'
import { resolveModelsDirectory } from '../src/llama-models.ts'

/** Mirrors the module's floor-at-one thread default. */
const cpuCount = Math.max(1, cpus().length)
const TOKEN = 'hf_desktop_settings_test_token_0001'

const roots: string[] = []

/** A throwaway models directory that cleanup always removes. */
function modelsDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llama-settings-'))
  roots.push(root)
  return root
}

/** The environment that points the settings module at a temp models directory. */
function environment(directory: string): NodeJS.ProcessEnv {
  return { DSH_LOCAL_MODELS_DIR: directory }
}

/** Write a raw or JSON-encoded settings document into a temp models directory. */
function seeded(document: unknown): string {
  const directory = modelsDirectory()
  const text = typeof document === 'string' ? document : JSON.stringify(document)
  writeFileSync(join(directory, SETTINGS_FILENAME), text)
  return directory
}

/** Read a document through a temp models directory. */
function read(document: unknown) {
  return readSettings(environment(seeded(document)))
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('DEFAULT_SETTINGS', () => {
  it('matches the contract defaults and is frozen', () => {
    expect(DEFAULT_SETTINGS).toStrictEqual({
      activeModelId: null,
      contextLength: 32768,
      threads: cpuCount,
      startOnLaunch: false,
    })
    expect(Object.hasOwn(DEFAULT_SETTINGS, 'huggingFaceToken')).toBe(false)
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true)
  })
})

describe('resolveSettingsPath', () => {
  it('joins settings.json under the DSH_LOCAL_MODELS_DIR override', () => {
    const directory = modelsDirectory()
    expect(resolveSettingsPath(environment(directory))).toBe(join(directory, SETTINGS_FILENAME))
  })

  it('otherwise joins settings.json under the models directory', () => {
    expect(resolveSettingsPath({})).toBe(join(resolveModelsDirectory({}), SETTINGS_FILENAME))
  })
})

describe('readSettings defaults', () => {
  it('returns the defaults when the document is absent, without creating it', () => {
    const directory = modelsDirectory()
    expect(readSettings(environment(directory))).toStrictEqual(DEFAULT_SETTINGS)
    expect(existsSync(join(directory, SETTINGS_FILENAME))).toBe(false)
  })

  it('returns the defaults when the models directory itself is absent', () => {
    const directory = join(modelsDirectory(), 'not-created', 'models')
    expect(readSettings(environment(directory))).toStrictEqual(DEFAULT_SETTINGS)
  })

  it('returns the defaults for corrupt JSON, non-object JSON and unreadable targets', () => {
    for (const document of ['{ not json', 'null', '[]', '"a string"', '42', 'true', '', '{"contextLength":']) {
      expect(read(document)).toStrictEqual(DEFAULT_SETTINGS)
    }
    const directory = modelsDirectory()
    mkdirSync(join(directory, SETTINGS_FILENAME))
    expect(readSettings(environment(directory))).toStrictEqual(DEFAULT_SETTINGS)
  })

  it('merges missing keys over the defaults and drops unknown keys', () => {
    expect(read({ contextLength: 8192, bogus: 'drop me' })).toStrictEqual({ ...DEFAULT_SETTINGS, contextLength: 8192 })
    expect(read({})).toStrictEqual(DEFAULT_SETTINGS)
  })
})

describe('readSettings clamping and coercion', () => {
  it('clamps the thread count to 1..CPU count * 2', () => {
    expect(read({ threads: 0 }).threads).toBe(1)
    expect(read({ threads: -4 }).threads).toBe(1)
    expect(read({ threads: 3.9 }).threads).toBe(3)
    expect(read({ threads: cpuCount * 2 }).threads).toBe(cpuCount * 2)
    expect(read({ threads: cpuCount * 2 + 1 }).threads).toBe(cpuCount * 2)
    expect(read({ threads: '6' }).threads).toBe(6)
    expect(read({ threads: 'many' }).threads).toBe(DEFAULT_SETTINGS.threads)
    expect(read({ threads: true }).threads).toBe(DEFAULT_SETTINGS.threads)
    expect(read({ threads: null }).threads).toBe(DEFAULT_SETTINGS.threads)
  })

  it('clamps the context length to 1024..262144', () => {
    expect(read({ contextLength: 0 }).contextLength).toBe(1024)
    expect(read({ contextLength: 1000 }).contextLength).toBe(1024)
    expect(read({ contextLength: 262145 }).contextLength).toBe(262144)
    expect(read({ contextLength: 999999999 }).contextLength).toBe(262144)
    expect(read({ contextLength: 32768.9 }).contextLength).toBe(32768)
    expect(read({ contextLength: '8192' }).contextLength).toBe(8192)
    expect(read({ contextLength: 'lots' }).contextLength).toBe(32768)
    expect(read({ contextLength: null }).contextLength).toBe(32768)
  })

  it('coerces booleans and falls back on unrecognised forms', () => {
    expect(read({ startOnLaunch: true }).startOnLaunch).toBe(true)
    expect(read({ startOnLaunch: false }).startOnLaunch).toBe(false)
    expect(read({ startOnLaunch: 'true' }).startOnLaunch).toBe(true)
    expect(read({ startOnLaunch: ' FALSE ' }).startOnLaunch).toBe(false)
    expect(read({ startOnLaunch: '1' }).startOnLaunch).toBe(true)
    expect(read({ startOnLaunch: '0' }).startOnLaunch).toBe(false)
    expect(read({ startOnLaunch: 1 }).startOnLaunch).toBe(true)
    expect(read({ startOnLaunch: 0 }).startOnLaunch).toBe(false)
    expect(read({ startOnLaunch: 2 }).startOnLaunch).toBe(false)
    expect(read({ startOnLaunch: 'maybe' }).startOnLaunch).toBe(false)
  })

  it('normalizes the active model id and the optional token', () => {
    expect(read({ activeModelId: ' qwen ' }).activeModelId).toBe('qwen')
    expect(read({ activeModelId: '' }).activeModelId).toBeNull()
    expect(read({ activeModelId: '   ' }).activeModelId).toBeNull()
    expect(read({ activeModelId: 5 }).activeModelId).toBeNull()
    expect(read({ huggingFaceToken: ' hf_abc ' }).huggingFaceToken).toBe('hf_abc')
    for (const document of [{ huggingFaceToken: '' }, { huggingFaceToken: '   ' }, { huggingFaceToken: 7 }]) {
      expect(read(document)).toStrictEqual(DEFAULT_SETTINGS)
    }
  })
})

describe('writeSettings', () => {
  it('round-trips every field and returns the normalized document', () => {
    const directory = modelsDirectory()
    const written = writeSettings({
      activeModelId: 'owner--repo--model',
      contextLength: 4096,
      threads: 2,
      startOnLaunch: true,
      huggingFaceToken: TOKEN,
    }, environment(directory))
    expect(written).toStrictEqual({
      activeModelId: 'owner--repo--model',
      contextLength: 4096,
      threads: 2,
      startOnLaunch: true,
      huggingFaceToken: TOKEN,
    })
    expect(readSettings(environment(directory))).toStrictEqual(written)
    const file = join(directory, SETTINGS_FILENAME)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual(written)
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true)
  })

  it('normalizes before writing and omits an empty token', () => {
    const directory = modelsDirectory()
    expect(writeSettings({ contextLength: 5, threads: 0, startOnLaunch: 'yes', huggingFaceToken: '' }, environment(directory)))
      .toStrictEqual({ activeModelId: null, contextLength: 1024, threads: 1, startOnLaunch: false })
    const parsed = JSON.parse(readFileSync(join(directory, SETTINGS_FILENAME), 'utf8')) as Record<string, unknown>
    expect(parsed).toStrictEqual({ activeModelId: null, contextLength: 1024, threads: 1, startOnLaunch: false })
    expect(Object.hasOwn(parsed, 'huggingFaceToken')).toBe(false)
  })

  it('writes the defaults for non-object input', () => {
    const directory = modelsDirectory()
    expect(writeSettings(undefined, environment(directory))).toStrictEqual(DEFAULT_SETTINGS)
    expect(readSettings(environment(directory))).toStrictEqual(DEFAULT_SETTINGS)
  })

  it('restricts the document to owner-only permissions on POSIX', () => {
    if (process.platform === 'win32') return
    const directory = modelsDirectory()
    writeSettings({ huggingFaceToken: TOKEN }, environment(directory))
    expect(statSync(join(directory, SETTINGS_FILENAME)).mode & 0o777).toBe(0o600)
  })
})

describe('atomic write', () => {
  it('replaces the document without leaving a temporary file behind', () => {
    const directory = modelsDirectory()
    writeSettings({ contextLength: 4096 }, environment(directory))
    writeSettings({ contextLength: 8192 }, environment(directory))
    expect(readdirSync(directory)).toStrictEqual([SETTINGS_FILENAME])
    expect(readSettings(environment(directory)).contextLength).toBe(8192)
  })

  it('cleans up its temporary file when the rename fails', () => {
    const directory = modelsDirectory()
    mkdirSync(join(directory, SETTINGS_FILENAME))
    expect(() => writeSettings({ contextLength: 4096 }, environment(directory))).toThrow()
    expect(readdirSync(directory)).toStrictEqual([SETTINGS_FILENAME])
  })

  it('creates no document when the models directory cannot be created', () => {
    const directory = join(modelsDirectory(), 'models')
    // A regular file where the models directory should be makes the write fail
    // before any document or temporary exists.
    writeFileSync(directory, 'not a directory')
    expect(() => writeSettings({ contextLength: 8192 }, environment(directory))).toThrow()
    expect(existsSync(join(directory, SETTINGS_FILENAME))).toBe(false)
  })
})

describe('token hygiene', () => {
  it('never mentions the token in a write error and logs nothing', () => {
    const log = vi.spyOn(console, 'log')
    const info = vi.spyOn(console, 'info')
    const warn = vi.spyOn(console, 'warn')
    const error = vi.spyOn(console, 'error')
    const directory = modelsDirectory()
    mkdirSync(join(directory, SETTINGS_FILENAME))
    let thrown: unknown
    try {
      writeSettings({ huggingFaceToken: TOKEN }, environment(directory))
    } catch (writeError) {
      thrown = writeError
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).not.toContain(TOKEN)
    expect(readSettings(environment(directory))).toStrictEqual(DEFAULT_SETTINGS)
    for (const spy of [log, info, warn, error]) expect(spy).not.toHaveBeenCalled()
  })

  it('returns the defaults for corrupt JSON that embeds a token', () => {
    const directory = seeded(`{"huggingFaceToken":"${TOKEN}",`)
    expect(readSettings(environment(directory))).toStrictEqual(DEFAULT_SETTINGS)
  })
})
