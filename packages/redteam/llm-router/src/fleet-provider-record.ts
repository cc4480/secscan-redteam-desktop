/**
 * Published fleet provider selection: the one document another process
 * reads to learn which provider family the engagement fleet dispatches
 * on — one of the registered fleet families (see
 * FLEET_PROVIDER_SELECTIONS).
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
 *     "provider": <one of FLEET_PROVIDER_SELECTIONS>,
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
export type FleetProviderSelection =
  | 'meta'
  | 'deepseek'
  | 'local'
  | 'qwen'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'zai'
  | 'gemini'

/** Every selection the record may carry; a value outside this list is not a record this build wrote. */
export const FLEET_PROVIDER_SELECTIONS: readonly FleetProviderSelection[] = [
  'meta',
  'deepseek',
  'local',
  'qwen',
  'openai',
  'anthropic',
  'xai',
  'zai',
  'gemini',
]

/**
 * Provider ids under which a fleet family also travels: chat route ids
 * and common aliases for the SAME provider (the chat stack's DeepSeek
 * route is `deepseek-official`; pi-ai's Gemini route is `google`; GLM
 * is Z.ai's `zai`). An alias maps to its own provider only — it never
 * substitutes a different provider.
 */
const FLEET_PROVIDER_ALIASES: Readonly<Record<string, FleetProviderSelection>> = {
  'deepseek-official': 'deepseek',
  'google': 'gemini',
  'glm': 'zai',
  'claude': 'anthropic',
  'grok': 'xai',
  'chatgpt': 'openai',
  'dashscope': 'qwen',
}

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
 * explicit value names its own fleet family (aliases included); an
 * explicit value that names NO fleet family is an operator error and
 * throws — it is never silently converted to DeepSeek. With no explicit
 * value a serving local server selects `local`, else the operator's
 * saved model selection names the fleet through its family, and an
 * operator who has never chosen leaves the fleet on its DeepSeek
 * default (operator ruling, 2026-11-07: DeepSeek is the fleet's
 * default; every other provider is an option, never the default).
 * @param operatorValue - the operator's own `REDTEAM_LLM_PROVIDER` value, or undefined when they never set one.
 * @param localServing - whether the bundled local server is serving (running, with an endpoint and a model).
 * @param selectedProvider - provider id of the operator's saved model selection (the agent-default-model profile entry the model picker writes), or undefined when the operator has never saved one. Consulted only when neither an explicit selector nor a serving local server names the fleet: the operator's own pick outranks the DeepSeek fallback, which is the default for an operator who has never chosen.
 * @returns the selection to publish.
 * @throws When the explicit selector names no fleet family.
 */
export function effectiveFleetProvider(
  operatorValue: string | undefined,
  localServing: boolean,
  selectedProvider?: string,
): FleetProviderSelection {
  const explicit = (operatorValue ?? '').trim().toLowerCase()
  if (explicit !== '') {
    const family = fleetProviderFamilyForProvider(explicit)
    if (family !== undefined) return family
    throw new Error(
      `[llm-router] REDTEAM_LLM_PROVIDER names '${explicit}', which is not a fleet provider. ` +
        `Known fleet providers: ${FLEET_PROVIDER_SELECTIONS.join(', ')}. ` +
        'Name one of those, or unset REDTEAM_LLM_PROVIDER to follow the saved model selection.',
    )
  }
  if (localServing) return 'local'
  return fleetProviderFamilyForProvider(selectedProvider) ?? 'deepseek'
}

/**
 * Read the published fleet provider record, tolerating any unusable
 * document.
 * @param environment - environment holding the Harness home override.
 * @returns the published record, or undefined when there is nothing
 *   usable: no document, an unparseable document, a foreign schema
 *   version, or a document whose fields do not validate.
 */
/**
 * Map a provider id from the operator's saved model selection onto the
 * fleet provider family it names. Every registered fleet family names
 * itself; the aliases in FLEET_PROVIDER_ALIASES name the same provider
 * under its chat-route id. An id that names no fleet family (a
 * chat-only provider, a typo) yields undefined — the pick names no
 * fleet selection, and NO other provider is substituted for it.
 * @param providerId - provider id from the saved selection, or undefined.
 * @returns the fleet provider family, or undefined when the id names no fleet family.
 */
export function fleetProviderFamilyForProvider(
  providerId: string | undefined,
): FleetProviderSelection | undefined {
  const normalized = (providerId ?? '').trim().toLowerCase()
  if (normalized === '') return undefined
  if ((FLEET_PROVIDER_SELECTIONS as readonly string[]).includes(normalized)) {
    return normalized as FleetProviderSelection
  }
  return FLEET_PROVIDER_ALIASES[normalized]
}

/**
 * Read the provider id of the operator's saved model selection: the
 * `agent-default-model` entry the model picker saves into the desktop
 * profile's patch document, which lives in the same Harness home as the
 * fleet provider record (`profiles/desktop/cordis.patch.yml` under it).
 * The document is machine-written in a stable entry format; the read is
 * a line scan for that entry's `provider` value, not a YAML parse. Best
 * effort by design: a missing document, a missing entry, or no provider
 * value yields undefined (no saved selection), never a thrown error,
 * because this read sits on the fleet's publication and dispatch paths.
 * @param environment - environment holding the Harness home override.
 * @returns the saved selection's provider id, or undefined.
 */
export function readSavedModelSelectionProvider(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  let text: string
  try {
    text = readFileSync(
      join(dirname(resolveFleetProviderPath(environment)), 'profiles', 'desktop', 'cordis.patch.yml'),
      'utf8',
    )
  } catch {
    return undefined
  }
  let inEntry = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*-\s*id:\s*agent-default-model\s*$/.test(line)) {
      inEntry = true
      continue
    }
    if (!inEntry) continue
    if (/^\s*-\s*id:/.test(line)) return undefined
    const match = /^\s+provider:\s*"?([^"\s]+)"?\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

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
