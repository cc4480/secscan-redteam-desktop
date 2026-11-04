/**
 * Store-backed fleet configuration resolver for the runner host.
 *
 * The fleet's provider keys and selection live in the app's credentials
 * store — the `.credentials.yaml` document under the harness home that
 * the desktop's credentials service owns and the web Models page writes
 * through (see @deepseek-ai/dsh-credentials-local). The desktop host and
 * this runner are separate processes, so the shared medium is that file:
 * the store's own design reloads it on external change, and this resolver
 * does the same at dispatch time — a key seated or rotated in the app
 * reaches the fleet's next dispatch without a runner restart.
 *
 * The provider selection (`REDTEAM_LLM_PROVIDER`) has one more source,
 * consulted after the store file: the desktop's published fleet provider
 * record (`fleet-provider.json` beside the store document), which the
 * desktop rewrites whenever the app's effective selection changes —
 * including local-server transitions that happen long after this process
 * launched, which no environment the runner inherited can describe. The
 * record serves the selection name only; keys never come from it.
 *
 * Resolution order mirrors the store's own: the launching environment
 * wins (a per-run override stays an override), then the stored file,
 * then — for the selection alone — the desktop's record, and finally
 * the router's own default. Values are never logged and never included
 * in error strings.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  parseCredentialsDocument,
  resolveSpec,
} from '@deepseek-ai/dsh-credentials-local'
import { LLM_PROVIDER_ENV } from '@secscan/redteam-llm-router'
import type { FleetConfigResolver } from '@secscan/redteam-llm-router'

/** Basename of the desktop's published fleet provider record inside the harness home. */
const FLEET_PROVIDER_FILENAME = 'fleet-provider.json'

/** Schema version of the fleet provider record this build reads. */
const FLEET_PROVIDER_VERSION = 1

/** Provider values the record may name; anything else is not a record the desktop wrote. */
const FLEET_PROVIDERS: ReadonlySet<string> = new Set(['meta', 'deepseek', 'local'])

/**
 * Create the store-backed fleet resolver over the app credentials store.
 * Both documents are loaded once here: a malformed document fails loud
 * at startup, exactly as the credentials provider itself refuses it.
 * Later edits are picked up per call; a document that turns malformed
 * after startup keeps serving its last good contents (the store's own
 * live reload posture), and a document that disappears stops serving,
 * exactly as an absent store stops serving keys.
 * @param env - environment to resolve against; defaults to `process.env`.
 * @returns the resolver to install via the router's `setFleetConfigResolver`.
 */
export function createStoreFleetConfigResolver(
  env: NodeJS.ProcessEnv = process.env,
): FleetConfigResolver {
  const dshHome = env['DSH_HOME']?.trim()
  const filename = resolveSpec(dshHome ? { dshHome } : {}).filename
  const recordFilename = join(dirname(filename), FLEET_PROVIDER_FILENAME)
  let cache: { mtimeMs: number; size: number; refs: Map<string, string> } | undefined
  let lastGood: Map<string, string> = new Map()
  let startup = true
  let recordCache: { mtimeMs: number; size: number; provider: string | undefined } | undefined
  let recordLastGood: string | undefined
  let recordStartup = true

  function load(): Map<string, string> {
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(filename)
    } catch {
      cache = undefined
      lastGood = new Map()
      startup = false
      return lastGood
    }
    if (cache !== undefined && cache.mtimeMs === st.mtimeMs && cache.size === st.size) {
      return cache.refs
    }
    try {
      const doc = parseCredentialsDocument(readFileSync(filename, 'utf8'), filename)
      cache = { mtimeMs: st.mtimeMs, size: st.size, refs: doc.refs }
      lastGood = doc.refs
    } catch (err) {
      if (startup) throw err
      // Live reload of a malformed edit: keep serving the last good
      // contents, as the credentials provider does.
    }
    startup = false
    return lastGood
  }

  function parseRecord(text: string): string {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`fleet provider record at ${recordFilename} is not valid JSON`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`fleet provider record at ${recordFilename} is not a JSON object`)
    }
    const doc = parsed as Record<string, unknown>
    if (doc['version'] !== FLEET_PROVIDER_VERSION) {
      throw new Error(`fleet provider record at ${recordFilename} names an unsupported version`)
    }
    const provider = doc['provider']
    if (typeof provider !== 'string' || !FLEET_PROVIDERS.has(provider)) {
      throw new Error(`fleet provider record at ${recordFilename} names an unknown provider`)
    }
    return provider
  }

  function loadRecord(): string | undefined {
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(recordFilename)
    } catch {
      recordCache = undefined
      recordLastGood = undefined
      recordStartup = false
      return undefined
    }
    if (
      recordCache !== undefined &&
      recordCache.mtimeMs === st.mtimeMs &&
      recordCache.size === st.size
    ) {
      return recordCache.provider
    }
    try {
      const provider = parseRecord(readFileSync(recordFilename, 'utf8'))
      recordCache = { mtimeMs: st.mtimeMs, size: st.size, provider }
      recordLastGood = provider
    } catch (err) {
      if (recordStartup) throw err
      // Live reload of a malformed edit: keep serving the last good
      // selection, as the store loader above does for credentials.
    }
    recordStartup = false
    return recordLastGood
  }

  load()
  loadRecord()

  return {
    valueFor(name: string): string | undefined {
      const fromEnv = env[name]
      if (fromEnv !== undefined && fromEnv !== '') return fromEnv
      const stored = load().get(name)
      if (stored !== undefined) return stored
      if (name === LLM_PROVIDER_ENV) return loadRecord()
      return undefined
    },
  }
}
