/**
 * Fixture models directory shared by the llm-local suites: a registry with
 * two downloaded models and one registered-but-absent model, the
 * operator's settings naming the first model active, and a GGUF file on
 * disk for each downloaded model (contents are irrelevant; presence is
 * what the catalog reads).
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Registry id of the fixture's active (first) model. */
export const ACTIVE_MODEL_ID = 'qwen3-6-35b-a3b-v5-apex-compact'
/** GGUF file name of the fixture's active model. */
export const ACTIVE_MODEL_FILE = 'qwen3-6-35b-a3b-v5-apex-compact.gguf'
/** Registry id of the fixture's second downloaded model. */
export const SECOND_MODEL_ID = 'llama-3-2-3b-instruct'
/** GGUF file name of the fixture's second downloaded model. */
export const SECOND_MODEL_FILE = 'llama-3-2-3b-instruct.gguf'
/** Registry id of the fixture's registered-but-not-downloaded model. */
export const MISSING_MODEL_ID = 'registered-not-downloaded'
/** Loopback base URL the fixture's running server state publishes. */
export const FIXTURE_BASE_URL = 'http://127.0.0.1:18080/v1'

/**
 * Create one fixture models directory in a fresh temp folder.
 * @returns the absolute models directory path.
 */
export async function createFixtureModelsDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-llm-local-'))
  await writeFile(join(directory, ACTIVE_MODEL_FILE), 'gguf-fixture')
  await writeFile(join(directory, SECOND_MODEL_FILE), 'gguf-fixture')
  await writeFile(join(directory, 'registry.json'), JSON.stringify({
    models: [
      { id: ACTIVE_MODEL_ID, file: ACTIVE_MODEL_FILE, path: join(directory, ACTIVE_MODEL_FILE), sizeBytes: 12 },
      { id: SECOND_MODEL_ID, file: SECOND_MODEL_FILE, path: join(directory, SECOND_MODEL_FILE), sizeBytes: 12 },
      { id: MISSING_MODEL_ID, file: 'registered-not-downloaded.gguf', path: join(directory, 'registered-not-downloaded.gguf'), sizeBytes: 12 },
    ],
  }))
  await writeFile(join(directory, 'settings.json'), JSON.stringify({
    version: 1,
    activeModelId: ACTIVE_MODEL_ID,
    contextLength: 32768,
    threads: 4,
    startOnLaunch: false,
  }))
  return directory
}

/**
 * Publish one server-state document into a fixture models directory.
 * @param directory - the fixture models directory.
 * @param state - the state fields to publish.
 */
export async function writeServerState(directory: string, state: Record<string, unknown>): Promise<void> {
  await writeFile(join(directory, 'server-state.json'), JSON.stringify({ version: 1, updatedAt: 1793626756311, ...state }))
}
