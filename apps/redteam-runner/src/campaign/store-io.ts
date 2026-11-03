/**
 * Campaign store — file I/O and the record-audit spine.
 *
 * Extracted verbatim from store.ts in a structural split (no file under
 * src/ may exceed 300 lines). This module owns the primitives every
 * campaign writer shares: campaigns-dir resolution, the atomic
 * write/load/validate pair, the synchronous read-modify-write
 * transaction, and the single transition writer that keeps the audit
 * spine gapless. store.ts (creation, resume repair) and store-wave.ts
 * (wave lifecycle) are both built on it. No logic changed in the move.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CampaignSchemaError, isSafeCampaignId, validateCampaignRecord } from './schema.js'
import type { CampaignRecord, CampaignStatus } from './types.js'

export class CampaignStoreError extends Error {
  constructor(message: string) {
    super(`[campaign] ${message}`)
    this.name = 'CampaignStoreError'
  }
}

export const CAMPAIGN_FILE_NAME = 'campaign.json'

/** Mirror of config.ts resolution: opts → REDTEAM_CAMPAIGNS_DIR →
 *  REDTEAM_HOME/engagements/campaigns → cwd/engagements/campaigns.
 *  Campaigns sit beside the registry under the engagements home (D-6). */
export function resolveCampaignsDir(opts: {
  campaignsDir?: string
  env?: NodeJS.ProcessEnv
  cwd?: string
} = {}): string {
  const env = opts.env ?? process.env
  if (opts.campaignsDir) return opts.campaignsDir
  if (env['REDTEAM_CAMPAIGNS_DIR']) return env['REDTEAM_CAMPAIGNS_DIR']
  const home = env['REDTEAM_HOME']
  const base = home ? join(home, 'engagements') : join(opts.cwd ?? process.cwd(), 'engagements')
  return join(base, 'campaigns')
}

export function campaignDir(campaignsDir: string, campaignId: string): string {
  return join(campaignsDir, campaignId)
}

export function campaignFile(campaignsDir: string, campaignId: string): string {
  return join(campaignDir(campaignsDir, campaignId), CAMPAIGN_FILE_NAME)
}

/** Timestamp helper, exported for the wave module (same format everywhere). */
export function iso(now: Date): string {
  return now.toISOString()
}

/** Atomic replace: write a sibling tmp file, then rename over the
 *  target. A crash between the two leaves the old record intact. */
function atomicWriteFileSync(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, content)
    renameSync(tmp, path)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* tmp already gone — the original error is the one that matters */
    }
    throw err
  }
}

/** Validate then persist a record (normalized form is what lands). */
export function saveCampaignFile(path: string, rec: CampaignRecord): void {
  const normalized = validateCampaignRecord(rec)
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, JSON.stringify(normalized, null, 2))
}

/** Load + validate one campaign record file. Throws CampaignSchemaError
 *  on a missing, unparsable, or invalid record — fail loud, never a
 *  quietly-invented empty campaign. */
export function loadCampaignFile(path: string): CampaignRecord {
  let rawText: string
  try {
    rawText = readFileSync(path, 'utf8')
  } catch (err) {
    throw new CampaignSchemaError(
      `campaign record unreadable at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (err) {
    throw new CampaignSchemaError(
      `campaign record is not valid JSON at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return validateCampaignRecord(parsed)
}

export function loadCampaign(campaignsDir: string, campaignId: string): CampaignRecord {
  if (!isSafeCampaignId(campaignId)) {
    throw new CampaignStoreError(`unsafe campaign id: ${JSON.stringify(campaignId)}`)
  }
  return loadCampaignFile(campaignFile(campaignsDir, campaignId))
}

/** Ids of all campaigns with a record file under campaignsDir, sorted.
 *  A missing campaigns directory is an empty store, not an error. */
export function listCampaignIds(campaignsDir: string): string[] {
  if (!existsSync(campaignsDir)) return []
  return readdirSync(campaignsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(campaignsDir, e.name, CAMPAIGN_FILE_NAME)))
    .map(e => e.name)
    .sort()
}

/**
 * Atomic read-modify-write transaction on one campaign record
 * (registry transact precedent). The mutator runs against the freshly
 * loaded record; the result is validated and saved atomically, with
 * updatedAt refreshed. If the mutator throws, nothing is written.
 */
export function transactCampaign<T>(
  campaignsDir: string,
  campaignId: string,
  fn: (rec: CampaignRecord) => T,
  now: Date = new Date(),
): T {
  const file = campaignFile(campaignsDir, campaignId)
  const rec = loadCampaignFile(file)
  const out = fn(rec)
  rec.updatedAt = iso(now)
  saveCampaignFile(file, rec)
  return out
}

/** Append a transition entry and move the status. This is the SINGLE
 *  transition writer for campaign records: seq always equals the
 *  entry's index in transitions[] (creation is seq 0), so the audit
 *  spine stays gapless and duplicate-free no matter which module
 *  records the move. Callers outside the store (lifecycle, executor)
 *  must use this — never push transition entries by hand. */
export function applyCampaignTransition(
  rec: CampaignRecord,
  to: CampaignStatus,
  reason: string,
  opts: { waveIndex?: number; now?: Date } = {},
): void {
  rec.transitions.push({
    seq: rec.transitions.length,
    ts: iso(opts.now ?? new Date()),
    from: rec.status,
    to,
    reason,
    ...(opts.waveIndex !== undefined ? { waveIndex: opts.waveIndex } : {}),
  })
  rec.status = to
}

/** Record a lifecycle status change (the executor/lifecycle's path for
 *  transitions not owned by beginWave/recordWaveOutcome — arm, pause,
 *  resume, stop, complete). */
export function recordTransition(
  campaignsDir: string,
  campaignId: string,
  to: CampaignStatus,
  reason: string,
  opts: { waveIndex?: number; now?: Date } = {},
): CampaignRecord {
  const now = opts.now ?? new Date()
  return transactCampaign(
    campaignsDir,
    campaignId,
    (rec) => {
      applyCampaignTransition(rec, to, reason, { waveIndex: opts.waveIndex, now })
      return rec
    },
    now,
  )
}
