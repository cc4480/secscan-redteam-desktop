/**
 * Published llama-server state: the one document another process reads to
 * learn whether the bundled local server is serving, at which loopback
 * endpoint, and which model.
 *
 * The engagement runner is a child process spawned once; the environment
 * mirror in `llama-shell.ts` can only speak to a spawn that happens after
 * the server starts, and an operator who starts the server from the Local
 * Models page does so long after the runner is up. The catalog behind the
 * runner's `GET /api/models` therefore reads this document at request time
 * (and probes the endpoint before believing it): `<models
 * dir>/server-state.json`, rewritten on every server state transition. The
 * state carries no secret — a loopback URL and a model id — so it is
 * written with default permissions, unlike `settings.json`.
 *
 * Schema written to disk:
 *
 *   {
 *     "version": 1,
 *     "status": "stopped" | "starting" | "running" | "error",
 *     "baseUrl": string,   // present only while a server endpoint exists
 *     "modelId": string,   // present when the state names a model
 *     "updatedAt": number  // milliseconds since the epoch
 *   }
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LlamaServerState, LlamaServerStatus } from './llama-api.ts'
import { resolveModelsDirectory } from './llama-models.ts'

/** File name of the published server-state document inside the models directory. */
export const SERVER_STATE_FILENAME = 'server-state.json'

/** On-disk server-state schema version. */
export const SERVER_STATE_VERSION = 1

/** One published server-state document, as written and as read back. */
export interface PublishedLlamaServerState {
  readonly version: typeof SERVER_STATE_VERSION
  readonly status: LlamaServerStatus
  /** OpenAI-compatible base URL (`http://127.0.0.1:<port>/v1`) while running. */
  readonly baseUrl?: string
  /** Model id the server is serving or was asked to serve. */
  readonly modelId?: string
  /** When this document was written, milliseconds since the epoch. */
  readonly updatedAt: number
}

const SERVER_STATUSES: readonly LlamaServerStatus[] = ['stopped', 'starting', 'running', 'error']

/**
 * Path of the server-state document: the models directory with
 * `server-state.json`.
 * @param environment - environment holding the models-directory override.
 * @returns absolute path of the server-state document.
 */
export function resolveServerStatePath(environment: NodeJS.ProcessEnv = process.env): string {
  return join(resolveModelsDirectory(environment), SERVER_STATE_FILENAME)
}

/**
 * Publish one server state, replacing the document atomically.
 *
 * The document is written to a same-directory temporary file and renamed
 * over `server-state.json`, so a reader never observes a partial document
 * and a failed write leaves the previous document untouched.
 * @param state - the supervisor's current state.
 * @param environment - environment holding the models-directory override.
 * @param now - clock seam for tests; milliseconds since the epoch.
 */
export function writeServerState(
  state: LlamaServerState,
  environment: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now,
): void {
  const document: PublishedLlamaServerState = {
    version: SERVER_STATE_VERSION,
    status: state.status,
    ...state.baseUrl === undefined ? {} : { baseUrl: state.baseUrl },
    ...state.modelId === undefined ? {} : { modelId: state.modelId },
    updatedAt: now(),
  }
  const file = resolveServerStatePath(environment)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
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
}

/**
 * Read the published server state, tolerating any unusable document.
 * @param environment - environment holding the models-directory override.
 * @returns the published state, or undefined when there is nothing usable:
 *   no document, an unparseable document, a foreign schema version, or a
 *   document whose fields do not validate.
 */
export function readServerState(
  environment: NodeJS.ProcessEnv = process.env,
): PublishedLlamaServerState | undefined {
  let raw: string
  try {
    raw = readFileSync(resolveServerStatePath(environment), 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const document = parsed as Record<string, unknown>
  if (document['version'] !== SERVER_STATE_VERSION) return undefined
  const status = document['status']
  if (typeof status !== 'string' || !SERVER_STATUSES.includes(status as LlamaServerStatus)) return undefined
  const updatedAt = document['updatedAt']
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return undefined
  const baseUrl = document['baseUrl']
  const modelId = document['modelId']
  if (baseUrl !== undefined && typeof baseUrl !== 'string') return undefined
  if (modelId !== undefined && typeof modelId !== 'string') return undefined
  return {
    version: SERVER_STATE_VERSION,
    status: status as LlamaServerStatus,
    ...baseUrl === undefined ? {} : { baseUrl },
    ...modelId === undefined ? {} : { modelId },
    updatedAt,
  }
}
