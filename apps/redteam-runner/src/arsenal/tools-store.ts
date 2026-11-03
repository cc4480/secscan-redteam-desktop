/**
 * Serving-store plumbing and shared bounds — extracted from `tools.ts` so
 * every module stays inside the runner's 300-line file budget. Binds the
 * endpoint's config (ARS-1), opens the serving generation lazily, and owns
 * the empty-index envelope every tool answers with.
 */
import type { DatabaseSync } from 'node:sqlite'

import { resolveArsenalServingConfig, type ArsenalConfig } from './config.js'
import {
  openArsenalServingStore,
  type ArsenalIndexMeta,
  type ArsenalServingStore,
} from './index-store.js'
/** The fix string every empty-index answer carries (spec §7.1). */
export const ARSENAL_EMPTY_FIX = 'Run: redteam-runner arsenal refresh'

export const TARGET_IDS = ['SS', 'SL', 'WA', 'WS', 'LX'] as const
export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 50

/* ------------------------------------------------------------------ */
/* Config + serving-store plumbing                                     */
/* ------------------------------------------------------------------ */

let boundConfig: ArsenalConfig | undefined
let servingStore: ArsenalServingStore | undefined

/**
 * Bind the config the endpoint resolved for this server (ARS-1's seam calls
 * this with `resolveArsenalServingConfig(process.env, { engagementsDir })`,
 * so the DB path follows the console's real engagements dir — brief §1.4).
 * Until bound, handlers resolve from the process env on every call.
 */
export function bindArsenalConfig(config: ArsenalConfig): void {
  boundConfig = config
  servingStore = undefined
}

function currentConfig(): ArsenalConfig {
  return boundConfig ?? resolveArsenalServingConfig(process.env)
}

/** The serving generation's handle + meta, or null when no index exists. */
export function serving(): { db: DatabaseSync; meta: ArsenalIndexMeta } | null {
  const config = currentConfig()
  if (servingStore === undefined || servingStore.dbPath !== config.dbPath) {
    servingStore?.close()
    servingStore = openArsenalServingStore(config.dbPath)
  }
  return servingStore.current()
}

export function emptyIndexResult(): string {
  return JSON.stringify({
    error: { code: 'ARSENAL_INDEX_EMPTY', fix: ARSENAL_EMPTY_FIX },
  })
}

export function indexStamp(meta: ArsenalIndexMeta): Record<string, unknown> {
  return {
    generation: meta.generation,
    built_at: meta.builtAt,
    source_commit: meta.sourceCommit,
  }
}
