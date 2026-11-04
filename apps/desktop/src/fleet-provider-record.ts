/**
 * Published fleet provider selection: the one document another process
 * reads to learn which provider family the engagement fleet dispatches
 * on — `meta`, `deepseek`, or `local`.
 *
 * The fleet's runner is a child process spawned once; the environment
 * mirror in `llama-shell.ts` can only speak to a spawn that happens
 * after a state change, and an operator who starts the bundled local
 * server from the Local Models page does so long after the runner is
 * up. The runner therefore resolves the selection at dispatch time
 * through its fleet configuration resolver, which reads this document
 * from the Harness home — the same home the credentials store lives in,
 * resolved the same way. The desktop publishes the record at install
 * (the startup seat), on every local-server state transition, and at
 * dispose; the runner's own resolution order keeps the launching
 * environment and a store-seated reference ahead of it, so the record
 * is the desktop's current statement, never an override of an explicit
 * operator value.
 *
 * The selection is configuration, not a secret: the document carries a
 * provider name and a timestamp, and is written with default
 * permissions, like `server-state.json`.
 *
 * Schema written to disk:
 *
 *   {
 *     "version": 1,
 *     "provider": "meta" | "deepseek" | "local",
 *     "updatedAt": number  // milliseconds since the epoch
 *   }
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** File name of the published fleet provider record inside the Harness home. */
export const FLEET_PROVIDER_FILENAME = 'fleet-provider.json'

/** On-disk fleet provider record schema version. */
export const FLEET_PROVIDER_VERSION = 1

/** The provider families the fleet selection names, in the router's vocabulary. */
export type FleetProviderSelection = 'meta' | 'deepseek' | 'local'

/** Every selection the record may carry; a value outside this list is not a record this build wrote. */
const FLEET_PROVIDER_SELECTIONS: readonly FleetProviderSelection[] = ['meta', 'deepseek', 'local']

/** One published fleet provider record, as written and as read back. */
export interface PublishedFleetProvider {
  readonly version: typeof FLEET_PROVIDER_VERSION
  /** The provider family the fleet dispatches on. */
  readonly provider: FleetProviderSelection
  /** When this document was written, milliseconds since the epoch. */
  readonly updatedAt: number
}

/**
 * Path of the fleet provider record: the Harness home — resolved exactly
 * as the credentials store resolves it, so writer and reader always name
 * the same directory — with `fleet-provider.json`.
 * @param environment - environment holding the Harness home override.
 * @returns absolute path of the record document.
 */
export function resolveFleetProviderPath(environment: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(environment['DSH_HOME'], environment), FLEET_PROVIDER_FILENAME)
}

/**
 * Compute the fleet's effective provider selection from the two facts the
 * desktop owns: the operator's own selector value, captured before any
 * mirror wrote into the environment, and whether the bundled local
 * server is serving. The mapping mirrors the router's policy exactly: an
 * explicit `local` or `meta` names itself, any other explicit value
 * reaches the explicit-selector (DeepSeek) table, and with no explicit
 * value a serving local server selects `local` while anything else
 * leaves the fleet on its Meta default.
 * @param operatorValue - the operator's own `REDTEAM_LLM_PROVIDER` value, or undefined when they never set one.
 * @param localServing - whether the bundled local server is serving (running, with an endpoint and a model).
 * @returns the selection to publish.
 */
export function effectiveFleetProvider(
  operatorValue: string | undefined,
  localServing: boolean,
): FleetProviderSelection {
  const explicit = (operatorValue ?? '').trim().toLowerCase()
  if (explicit === 'local') return 'local'
  if (explicit === 'meta') return 'meta'
  if (explicit !== '') return 'deepseek'
  return localServing ? 'local' : 'meta'
}

/**
 * Read the published fleet provider record, tolerating any unusable
 * document.
 * @param environment - environment holding the Harness home override.
 * @returns the published record, or undefined when there is nothing
 *   usable: no document, an unparseable document, a foreign schema
 *   version, or a document whose fields do not validate.
 */
export function readFleetProviderRecord(
  environment: NodeJS.ProcessEnv = process.env,
): PublishedFleetProvider | undefined {
  let raw: string
  try {
    raw = readFileSync(resolveFleetProviderPath(environment), 'utf8')
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
  if (document['version'] !== FLEET_PROVIDER_VERSION) return undefined
  const provider = document['provider']
  if (typeof provider !== 'string'
    || !FLEET_PROVIDER_SELECTIONS.includes(provider as FleetProviderSelection)) return undefined
  const updatedAt = document['updatedAt']
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return undefined
  return { version: FLEET_PROVIDER_VERSION, provider: provider as FleetProviderSelection, updatedAt }
}

/**
 * Publish one fleet provider selection, replacing the document
 * atomically. A record already naming the same selection is left
 * untouched, so a state transition that does not move the selection
 * costs no write and no reader-side reload.
 *
 * The document is written to a same-directory temporary file and renamed
 * over `fleet-provider.json`, so a reader never observes a partial
 * document and a failed write leaves the previous document untouched.
 * @param environment - environment holding the Harness home override.
 * @param selection - the selection to publish.
 * @param now - clock seam for tests; milliseconds since the epoch.
 */
export function writeFleetProviderRecord(
  environment: NodeJS.ProcessEnv,
  selection: FleetProviderSelection,
  now: () => number = Date.now,
): void {
  if (readFleetProviderRecord(environment)?.provider === selection) return
  const document: PublishedFleetProvider = {
    version: FLEET_PROVIDER_VERSION,
    provider: selection,
    updatedAt: now(),
  }
  const file = resolveFleetProviderPath(environment)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
  } catch (error) {
    // A stale temporary is harmless; the previous document is intact.
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Keep the original write error; the temporary name is unique and stale.
    }
    throw error
  }
}
