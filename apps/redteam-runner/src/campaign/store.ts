/**
 * Campaign store (Q-CAMPAIGN, scoping N2).
 *
 * Directory-per-campaign (scoping D-2): `<campaignsDir>/<id>/campaign.json`
 * holds the one versioned record; wave plan artifacts may live alongside
 * it in `wave-<n>/` subdirectories (the planner's territory). The record
 * is the single source of truth for campaign state.
 *
 * Discipline, following the registry store's precedent:
 *  - Synchronous transact: load → mutate → validate → atomic save, so
 *    within one process two writers can never silently lose each other.
 *  - Atomic file replacement (tmp + rename): a crash mid-save leaves the
 *    prior record byte-identical, never a torn half-record.
 *  - No delete, no silent overwrite: creating over an existing campaign
 *    is an error, and a corrupt record fails loud at load (schema.ts).
 *  - Every status change is written through a transition entry — the
 *    record's audit spine cannot be skipped by a caller.
 *
 * Restart honesty (resumeCampaigns): a wave still marked "running" when
 * a new process loads the store was stranded by the old process's death.
 * It is marked "interrupted" — with when and why — and the campaign
 * returns to "awaiting-advance" for an operator decision. An interrupted
 * wave is NEVER silently counted complete, and its engagementId (what
 * was actually launched) stays on the record.
 */

import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CampaignRecord, CampaignStatus } from './types.js'
import { isForbiddenKind, isSafeCampaignId } from './schema.js'
import {
  applyCampaignTransition,
  CampaignStoreError,
  campaignFile,
  iso,
  listCampaignIds,
  loadCampaign,
  loadCampaignFile,
  saveCampaignFile,
} from './store-io.js'

// The store's public surface is unchanged by the structural split: the
// original paths still export every name. I/O + the transition spine live
// in store-io.ts, the wave lifecycle in store-wave.ts.
export {
  CampaignStoreError,
  CAMPAIGN_FILE_NAME,
  resolveCampaignsDir,
  campaignDir,
  campaignFile,
  saveCampaignFile,
  loadCampaignFile,
  loadCampaign,
  listCampaignIds,
  transactCampaign,
  applyCampaignTransition,
  recordTransition,
} from './store-io.js'
export { beginWave, computeRollup, recordWaveOutcome, settleFailedWave } from './store-wave.js'
export type { BeginWaveInput, EngagementResultLike } from './store-wave.js'

export interface CreateCampaignInput {
  id: string
  name: string
  kind: string
  objective: string
  scope: { hosts: string[]; verificationRef: string; roeRef?: string }
  caps: { maxWaves: number; maxBudget?: number }
  createdBy: string
}

/**
 * Create a new campaign in "draft" with auto-advance OFF (C-1 default)
 * and the creation transition recorded. Throws if a campaign with this
 * id already exists — creation never overwrites an existing record.
 */
export function createCampaign(
  campaignsDir: string,
  input: CreateCampaignInput,
  now: Date = new Date(),
): CampaignRecord {
  if (!isSafeCampaignId(input.id)) {
    throw new CampaignStoreError(`unsafe campaign id: ${JSON.stringify(input.id)}`)
  }
  if (typeof input.kind !== 'string' || input.kind.trim() === '') {
    throw new CampaignStoreError('campaign kind must be a non-empty string')
  }
  if (isForbiddenKind(input.kind)) {
    throw new CampaignStoreError('the "ad" kind is forbidden in this product (manifest Part C)')
  }
  if (!input.scope || !Array.isArray(input.scope.hosts) || input.scope.hosts.length === 0) {
    throw new CampaignStoreError('campaign scope.hosts must be a non-empty array — a campaign binds one verified scope')
  }
  if (typeof input.scope.verificationRef !== 'string' || input.scope.verificationRef.trim() === '') {
    throw new CampaignStoreError('campaign scope.verificationRef is required — waves inherit verified scope, they do not re-derive it')
  }
  if (typeof input.createdBy !== 'string' || input.createdBy.trim() === '') {
    throw new CampaignStoreError('campaign createdBy must name the operator creating it')
  }
  if (!Number.isInteger(input.caps?.maxWaves) || input.caps.maxWaves < 1) {
    throw new CampaignStoreError('campaign caps.maxWaves must be an integer >= 1')
  }
  const file = campaignFile(campaignsDir, input.id)
  // The store is directory-per-campaign, so a fresh campaignsDir has no
  // `<id>/` yet and the exclusive create below would fail with ENOENT instead
  // of creating the campaign. Creating the parent is not an overwrite: the
  // `wx` open still guarantees an existing record is never replaced.
  mkdirSync(dirname(file), { recursive: true })
  try {
    const fd = openSync(file, 'wx')
    closeSync(fd)
  } catch (err) {
    if ((err as { code?: string }).code === 'EEXIST') {
      throw new CampaignStoreError(`campaign already exists: ${input.id} (creation never overwrites a record)`)
    }
    throw err
  }
  const ts = iso(now)
  const rec: CampaignRecord = {
    version: 1,
    id: input.id,
    name: input.name,
    kind: input.kind,
    status: 'draft',
    scope: {
      hosts: [...input.scope.hosts],
      verificationRef: input.scope.verificationRef,
      ...(input.scope.roeRef !== undefined ? { roeRef: input.scope.roeRef } : {}),
    },
    objective: input.objective,
    caps: {
      maxWaves: input.caps.maxWaves,
      ...(input.caps.maxBudget !== undefined ? { maxBudget: input.caps.maxBudget } : {}),
    },
    autoAdvance: { enabled: false },
    waves: [],
    decisions: [],
    transitions: [
      { seq: 0, ts, from: null, to: 'draft', reason: `campaign created by ${input.createdBy}` },
    ],
    createdAt: ts,
    createdBy: input.createdBy,
    updatedAt: ts,
  }
  rmSync(file, { force: true })
  saveCampaignFile(file, rec)
  return loadCampaignFile(file)
}

export interface ResumeRepair {
  id: string
  interruptedWaves: number[]
  fromStatus: CampaignStatus
  toStatus: CampaignStatus
}

export interface ResumeReport {
  scanned: number
  repaired: ResumeRepair[]
  /** Campaigns whose records could not be loaded — reported, never
   *  silently skipped or invented around. */
  errors: Array<{ id: string; error: string }>
}

/**
 * Restart repair across the whole store. Any wave still "running" when
 * this runs was stranded by a previous process's death: it is marked
 * "interrupted" (interruptedAt + reason "process-restart") and the
 * campaign returns to "awaiting-advance" so an operator decides what
 * happens next. Idempotent — a second run over a repaired store changes
 * nothing. Repairs are persisted with transition entries (reason
 * "resume-repair: ..."), so the record itself shows what happened.
 */
export function resumeCampaigns(campaignsDir: string, now: Date = new Date()): ResumeReport {
  const report: ResumeReport = { scanned: 0, repaired: [], errors: [] }
  for (const id of listCampaignIds(campaignsDir)) {
    report.scanned += 1
    let rec: CampaignRecord
    try {
      rec = loadCampaign(campaignsDir, id)
    } catch (err) {
      report.errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      continue
    }
    const stranded = rec.waves.filter(w => w.status === 'running')
    const statusStranded = rec.status === 'wave-running' && stranded.length === 0
    if (stranded.length === 0 && !statusStranded) continue

    const fromStatus = rec.status
    for (const wave of stranded) {
      wave.status = 'interrupted'
      wave.interruptedAt = iso(now)
      wave.interruptReason = 'process-restart'
    }
    // A terminal campaign with a stranded wave is contradictory; the
    // wave repair still lands, but the campaign status is left as the
    // operator left it and the transition records the inconsistency.
    const terminal = rec.status === 'complete' || rec.status === 'stopped'
    const toStatus: CampaignStatus = terminal ? rec.status : 'awaiting-advance'
    const detail = stranded.length
      ? `wave(s) ${stranded.map(w => w.index).join(', ')} marked interrupted, never counted complete`
      : 'campaign was wave-running with no running wave'
    applyCampaignTransition(rec, toStatus, `resume-repair: process restart — ${detail}`, { now })
    rec.updatedAt = iso(now)
    saveCampaignFile(campaignFile(campaignsDir, id), rec)
    report.repaired.push({
      id,
      interruptedWaves: stranded.map(w => w.index),
      fromStatus,
      toStatus,
    })
  }
  return report
}
