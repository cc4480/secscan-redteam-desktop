/**
 * The published llama-server state document: the write/read pair the shell
 * and out-of-process readers (the runner's model catalog) share. Writes are
 * atomic and reads are total — a missing, corrupt or foreign document reads
 * as no state, never as an error and never as a half-trusted value.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveModelsDirectory } from '../src/llama-models.ts'
import {
  SERVER_STATE_FILENAME,
  readServerState,
  resolveServerStatePath,
  writeServerState,
} from '../src/llama-server-state.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** @returns a launch environment whose model directory is a fresh temp directory. */
function createEnvironment(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llama-server-state-'))
  roots.push(root)
  return { DSH_LOCAL_MODELS_DIR: join(root, 'models') }
}

describe('writeServerState / readServerState', () => {
  it('round-trips a running state with its endpoint and model', () => {
    const environment = createEnvironment()
    writeServerState(
      { status: 'running', baseUrl: 'http://127.0.0.1:52731/v1', modelId: 'owner--repo--model' },
      environment,
      () => 1_760_000_000_000,
    )
    expect(readServerState(environment)).toEqual({
      version: 1,
      status: 'running',
      baseUrl: 'http://127.0.0.1:52731/v1',
      modelId: 'owner--repo--model',
      updatedAt: 1_760_000_000_000,
    })
    // The document lives beside the registry and settings, under its own name.
    expect(resolveServerStatePath(environment))
      .toBe(join(resolveModelsDirectory(environment), SERVER_STATE_FILENAME))
  })

  it('writes a stopped state with no endpoint and no model keys', () => {
    const environment = createEnvironment()
    writeServerState({ status: 'stopped' }, environment, () => 42)
    const raw = JSON.parse(readFileSync(resolveServerStatePath(environment), 'utf8')) as Record<string, unknown>
    expect(raw).toEqual({ version: 1, status: 'stopped', updatedAt: 42 })
    expect(readServerState(environment)).toEqual({ version: 1, status: 'stopped', updatedAt: 42 })
  })

  it('reads a missing document as no state', () => {
    expect(readServerState(createEnvironment())).toBeUndefined()
  })

  it('reads a corrupt or foreign document as no state', () => {
    const environment = createEnvironment()
    const path = resolveServerStatePath(environment)
    writeServerState({ status: 'stopped' }, environment)
    writeFileSync(path, '{not json')
    expect(readServerState(environment)).toBeUndefined()
    writeFileSync(path, JSON.stringify({ version: 99, status: 'running', updatedAt: 1 }))
    expect(readServerState(environment)).toBeUndefined()
    writeFileSync(path, JSON.stringify({ version: 1, status: 'flying', updatedAt: 1 }))
    expect(readServerState(environment)).toBeUndefined()
    writeFileSync(path, JSON.stringify({ version: 1, status: 'running', baseUrl: 8080, updatedAt: 1 }))
    expect(readServerState(environment)).toBeUndefined()
  })

  it('replaces the previous document on every write', () => {
    const environment = createEnvironment()
    writeServerState(
      { status: 'running', baseUrl: 'http://127.0.0.1:1/v1', modelId: 'a--b--c' },
      environment,
      () => 1,
    )
    writeServerState({ status: 'stopped' }, environment, () => 2)
    expect(readServerState(environment)).toEqual({ version: 1, status: 'stopped', updatedAt: 2 })
  })
})
