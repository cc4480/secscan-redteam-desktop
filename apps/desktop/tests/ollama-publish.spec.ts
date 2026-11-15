/**
 * Fleet publication: choosing an Ollama model must move both surfaces the runner
 * reads — the inherited environment and the published provider record.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OLLAMA_BASE_URL_ENV,
  OLLAMA_MAX_OUTPUT_TOKENS_ENV,
  OLLAMA_MODEL_ENV,
  OLLAMA_NUM_CTX_ENV,
  PROVIDER_ENVIRONMENT_NAME,
  publishOllamaSelection,
} from '../src/ollama-publish.ts'

let directory: string | undefined

/** @returns an environment whose Harness home is a fresh temp dir. */
function isolated(): NodeJS.ProcessEnv {
  directory ??= mkdtempSync(join(tmpdir(), 'ollama-publish-'))
  return { DSH_HOME: directory }
}

/** @returns the published provider name. */
function publishedProvider(environment: NodeJS.ProcessEnv): string {
  const raw = readFileSync(join(String(environment['DSH_HOME']), 'fleet-provider.json'), 'utf8')
  return String((JSON.parse(raw) as { provider?: unknown }).provider)
}

afterEach(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('publishOllamaSelection', () => {
  it('routes the fleet to Ollama and mirrors the detected limits', () => {
    const environment = isolated()
    publishOllamaSelection(
      environment,
      { activeModel: 'llama3.2:3b', baseUrl: 'http://127.0.0.1:11434' },
      { contextLength: 131072, maxOutputTokens: 8192 },
    )
    expect(environment[PROVIDER_ENVIRONMENT_NAME]).toBe('ollama')
    expect(environment[OLLAMA_BASE_URL_ENV]).toBe('http://127.0.0.1:11434')
    expect(environment[OLLAMA_MODEL_ENV]).toBe('llama3.2:3b')
    // The context is the whole point: without it dispatch asks for a small default.
    expect(environment[OLLAMA_NUM_CTX_ENV]).toBe('131072')
    expect(environment[OLLAMA_MAX_OUTPUT_TOKENS_ENV]).toBe('8192')
    expect(publishedProvider(environment)).toBe('ollama')
  })

  it('clears the model-specific names when no limits were detected', () => {
    const environment = isolated()
    environment[OLLAMA_NUM_CTX_ENV] = '999'
    publishOllamaSelection(environment, { activeModel: 'm', baseUrl: 'http://127.0.0.1:11434' })
    expect(environment[OLLAMA_NUM_CTX_ENV]).toBeUndefined()
    expect(environment[OLLAMA_MAX_OUTPUT_TOKENS_ENV]).toBeUndefined()
    expect(publishedProvider(environment)).toBe('ollama')
  })

  it('restores the DeepSeek default when the fleet is stood down', () => {
    const environment = isolated()
    publishOllamaSelection(environment, { activeModel: 'm', baseUrl: 'http://x' }, { contextLength: 4096 })
    publishOllamaSelection(environment, null)
    expect(environment[PROVIDER_ENVIRONMENT_NAME]).toBeUndefined()
    expect(environment[OLLAMA_MODEL_ENV]).toBeUndefined()
    expect(environment[OLLAMA_BASE_URL_ENV]).toBeUndefined()
    expect(environment[OLLAMA_NUM_CTX_ENV]).toBeUndefined()
    expect(publishedProvider(environment)).toBe('deepseek')
  })
})
