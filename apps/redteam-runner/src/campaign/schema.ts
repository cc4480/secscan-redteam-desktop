/**
 * Campaign record validation (Q-CAMPAIGN, scoping N1).
 *
 * File-boundary validation per repo rule: a campaign record read from
 * disk is untrusted until it passes validateCampaignRecord. Fail loud
 * with path-specific messages — a corrupt or foreign record must surface
 * as an error, never be silently repaired into a different campaign.
 * (Restart repair of *stranded waves* is a different, explicit act —
 * see resumeCampaigns in store.ts — and is recorded in the record when
 * it happens.)
 */

import type {
  AutoAdvanceState,
  CampaignRecord,
  CampaignStatus,
  OperatorDecision,
  OperatorDecisionKind,
  TransitionEntry,
  WaveRecord,
  WaveSeverity,
  WaveStatus,
} from './types.js'

export class CampaignSchemaError extends Error {
  constructor(message: string) {
    super(`[campaign] ${message}`)
    this.name = 'CampaignSchemaError'
  }
}

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'draft',
  'armed',
  'wave-running',
  'awaiting-advance',
  'paused',
  'complete',
  'stopped',
]

export const WAVE_STATUSES: readonly WaveStatus[] = [
  'planned',
  'running',
  'complete',
  'halted',
  'interrupted',
  'failed',
]

export const OPERATOR_DECISION_KINDS: readonly OperatorDecisionKind[] = [
  'start',
  'advance',
  'enable-auto-advance',
  'disable-auto-advance',
  'pause',
  'resume',
  'stop',
  'complete',
]

export const WAVE_SEVERITIES: readonly WaveSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

/** Campaign ids double as directory names — same safety shape as
 *  engagement ids (util.ts safeEngagementId): no separators, no dots
 *  beyond the slug body, bounded length. */
const CAMPAIGN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/

export function isSafeCampaignId(id: unknown): id is string {
  return typeof id === 'string' && CAMPAIGN_ID_RE.test(id)
}

/** The one kind name that must never exist in this product: the donor's
 *  /ad kind is forbidden by the canonical manifest, Part C. Enforced
 *  here at the file boundary and at creation, not just by convention. */
export function isForbiddenKind(kind: unknown): boolean {
  return typeof kind === 'string' && kind.trim().toLowerCase() === 'ad'
}

function fail(path: string, problem: string): never {
  throw new CampaignSchemaError(`campaign record invalid at ${path}: ${problem}`)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function reqString(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(path, 'must be a non-empty string')
  return v as string
}

function optString(v: unknown, path: string): string | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string') fail(path, 'must be a string when present')
  return v as string
}

function reqIntAtLeast(v: unknown, path: string, min: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || (v as number) < min) {
    fail(path, `must be an integer >= ${min}`)
  }
  return v as number
}

function optIntAtLeast(v: unknown, path: string, min: number): number | undefined {
  if (v === undefined) return undefined
  return reqIntAtLeast(v, path, min)
}

function reqNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'must be a finite number')
  return v as number
}

function validateAutoAdvance(v: unknown, path: string): AutoAdvanceState {
  if (!isObj(v)) fail(path, 'must be an object')
  const o = v as Record<string, unknown>
  if (typeof o.enabled !== 'boolean') fail(`${path}.enabled`, 'must be a boolean')
  const out: AutoAdvanceState = { enabled: o.enabled as boolean }
  const maxWave = optIntAtLeast(o.maxWave, `${path}.maxWave`, 1)
  if (maxWave !== undefined) out.maxWave = maxWave
  const enabledBy = optString(o.enabledBy, `${path}.enabledBy`)
  if (enabledBy !== undefined) out.enabledBy = enabledBy
  const enabledAt = optString(o.enabledAt, `${path}.enabledAt`)
  if (enabledAt !== undefined) out.enabledAt = enabledAt
  const decisionSeq = optIntAtLeast(o.decisionSeq, `${path}.decisionSeq`, 0)
  if (decisionSeq !== undefined) out.decisionSeq = decisionSeq
  // Shape invariant: an enabled state must carry its authorization
  // coordinates. Whether decisionSeq *resolves* to an enable decision is
  // the gate's check (gate.ts), not the schema's.
  if (out.enabled && (out.maxWave === undefined || !out.enabledBy || !out.enabledAt || out.decisionSeq === undefined)) {
    fail(path, 'enabled auto-advance must record maxWave, enabledBy, enabledAt and decisionSeq')
  }
  return out
}

function validateWave(v: unknown, path: string): WaveRecord {
  if (!isObj(v)) fail(path, 'must be an object')
  const o = v as Record<string, unknown>
  const index = reqIntAtLeast(o.index, `${path}.index`, 1)
  if (!WAVE_STATUSES.includes(o.status as WaveStatus)) {
    fail(`${path}.status`, `must be one of ${WAVE_STATUSES.join('|')}`)
  }
  const wave: WaveRecord = { index, status: o.status as WaveStatus }
  const aim = optString(o.aim, `${path}.aim`)
  if (aim !== undefined) wave.aim = aim
  const planRef = optString(o.planRef, `${path}.planRef`)
  if (planRef !== undefined) wave.planRef = planRef
  const engagementId = optString(o.engagementId, `${path}.engagementId`)
  if (engagementId !== undefined) wave.engagementId = engagementId
  const launchedAt = optString(o.launchedAt, `${path}.launchedAt`)
  if (launchedAt !== undefined) wave.launchedAt = launchedAt
  const finishedAt = optString(o.finishedAt, `${path}.finishedAt`)
  if (finishedAt !== undefined) wave.finishedAt = finishedAt
  if (o.outcome !== undefined) {
    if (!isObj(o.outcome)) fail(`${path}.outcome`, 'must be an object')
    const oc = o.outcome as Record<string, unknown>
    const engagementStatus = reqString(oc.engagementStatus, `${path}.outcome.engagementStatus`)
    if (!isObj(oc.rollup)) fail(`${path}.outcome.rollup`, 'must be an object')
    const r = oc.rollup as Record<string, unknown>
    const bySeverityRaw = isObj(r.bySeverity) ? (r.bySeverity as Record<string, unknown>) : undefined
    if (!bySeverityRaw) fail(`${path}.outcome.rollup.bySeverity`, 'must be an object')
    const bySeverity = {} as Record<WaveSeverity, number>
    for (const sev of WAVE_SEVERITIES) {
      bySeverity[sev] = reqNumber(bySeverityRaw[sev], `${path}.outcome.rollup.bySeverity.${sev}`)
    }
    wave.outcome = {
      engagementStatus,
      ...(optString(oc.blockedReason, `${path}.outcome.blockedReason`) !== undefined
        ? { blockedReason: oc.blockedReason as string }
        : {}),
      ...(optString(oc.reportPath, `${path}.outcome.reportPath`) !== undefined
        ? { reportPath: oc.reportPath as string }
        : {}),
      rollup: {
        totalFindings: reqNumber(r.totalFindings, `${path}.outcome.rollup.totalFindings`),
        confirmed: reqNumber(r.confirmed, `${path}.outcome.rollup.confirmed`),
        killed: reqNumber(r.killed, `${path}.outcome.rollup.killed`),
        deferred: reqNumber(r.deferred, `${path}.outcome.rollup.deferred`),
        bySeverity,
      },
    }
  }
  const interruptedAt = optString(o.interruptedAt, `${path}.interruptedAt`)
  if (interruptedAt !== undefined) wave.interruptedAt = interruptedAt
  const interruptReason = optString(o.interruptReason, `${path}.interruptReason`)
  if (interruptReason !== undefined) wave.interruptReason = interruptReason
  return wave
}

function validateDecision(v: unknown, path: string): OperatorDecision {
  if (!isObj(v)) fail(path, 'must be an object')
  const o = v as Record<string, unknown>
  if (!OPERATOR_DECISION_KINDS.includes(o.kind as OperatorDecisionKind)) {
    fail(`${path}.kind`, `must be one of ${OPERATOR_DECISION_KINDS.join('|')}`)
  }
  const d: OperatorDecision = {
    seq: reqIntAtLeast(o.seq, `${path}.seq`, 0),
    ts: reqString(o.ts, `${path}.ts`),
    operator: reqString(o.operator, `${path}.operator`),
    kind: o.kind as OperatorDecisionKind,
  }
  const waveIndex = optIntAtLeast(o.waveIndex, `${path}.waveIndex`, 1)
  if (waveIndex !== undefined) d.waveIndex = waveIndex
  const maxWave = optIntAtLeast(o.maxWave, `${path}.maxWave`, 1)
  if (maxWave !== undefined) d.maxWave = maxWave
  const note = optString(o.note, `${path}.note`)
  if (note !== undefined) d.note = note
  return d
}

function validateTransition(v: unknown, path: string): TransitionEntry {
  if (!isObj(v)) fail(path, 'must be an object')
  const o = v as Record<string, unknown>
  if (o.from !== null && !CAMPAIGN_STATUSES.includes(o.from as CampaignStatus)) {
    fail(`${path}.from`, `must be null or one of ${CAMPAIGN_STATUSES.join('|')}`)
  }
  if (!CAMPAIGN_STATUSES.includes(o.to as CampaignStatus)) {
    fail(`${path}.to`, `must be one of ${CAMPAIGN_STATUSES.join('|')}`)
  }
  const t: TransitionEntry = {
    seq: reqIntAtLeast(o.seq, `${path}.seq`, 0),
    ts: reqString(o.ts, `${path}.ts`),
    from: o.from as CampaignStatus | null,
    to: o.to as CampaignStatus,
    reason: reqString(o.reason, `${path}.reason`),
  }
  const waveIndex = optIntAtLeast(o.waveIndex, `${path}.waveIndex`, 1)
  if (waveIndex !== undefined) t.waveIndex = waveIndex
  return t
}

/**
 * Validate an untrusted value as a CampaignRecord. Returns a normalized
 * record (only known fields survive). Throws CampaignSchemaError on any
 * violation — including an unknown version: a record written by newer
 * code fails loud here instead of silently downgrading.
 */
export function validateCampaignRecord(raw: unknown): CampaignRecord {
  if (!isObj(raw)) fail('$', 'must be an object')
  const o = raw as Record<string, unknown>
  if (o.version !== 1) fail('$.version', `must be 1, got ${JSON.stringify(o.version)}`)
  if (!isSafeCampaignId(o.id)) fail('$.id', 'must be a safe campaign id (slug, <= 121 chars)')
  const kind = reqString(o.kind, '$.kind')
  if (isForbiddenKind(kind)) fail('$.kind', 'the "ad" kind is forbidden in this product (manifest Part C)')
  if (!CAMPAIGN_STATUSES.includes(o.status as CampaignStatus)) {
    fail('$.status', `must be one of ${CAMPAIGN_STATUSES.join('|')}`)
  }
  if (!isObj(o.scope)) fail('$.scope', 'must be an object')
  const scopeRaw = o.scope as Record<string, unknown>
  if (!Array.isArray(scopeRaw.hosts) || scopeRaw.hosts.length === 0) {
    fail('$.scope.hosts', 'must be a non-empty array of hosts')
  }
  const hosts = (scopeRaw.hosts as unknown[]).map((h, i) => reqString(h, `$.scope.hosts[${i}]`))
  if (!isObj(o.caps)) fail('$.caps', 'must be an object')
  const capsRaw = o.caps as Record<string, unknown>
  if (!Array.isArray(o.waves)) fail('$.waves', 'must be an array')
  if (!Array.isArray(o.decisions)) fail('$.decisions', 'must be an array')
  if (!Array.isArray(o.transitions)) fail('$.transitions', 'must be an array')

  const rec: CampaignRecord = {
    version: 1,
    id: o.id as string,
    name: reqString(o.name, '$.name'),
    kind,
    status: o.status as CampaignStatus,
    scope: {
      hosts,
      verificationRef: reqString(scopeRaw.verificationRef, '$.scope.verificationRef'),
      ...(optString(scopeRaw.roeRef, '$.scope.roeRef') !== undefined
        ? { roeRef: scopeRaw.roeRef as string }
        : {}),
    },
    objective: reqString(o.objective, '$.objective'),
    caps: {
      maxWaves: reqIntAtLeast(capsRaw.maxWaves, '$.caps.maxWaves', 1),
      ...(capsRaw.maxBudget !== undefined
        ? { maxBudget: reqNumber(capsRaw.maxBudget, '$.caps.maxBudget') }
        : {}),
    },
    autoAdvance: validateAutoAdvance(o.autoAdvance, '$.autoAdvance'),
    waves: (o.waves as unknown[]).map((w, i) => validateWave(w, `$.waves[${i}]`)),
    decisions: (o.decisions as unknown[]).map((d, i) => validateDecision(d, `$.decisions[${i}]`)),
    transitions: (o.transitions as unknown[]).map((t, i) => validateTransition(t, `$.transitions[${i}]`)),
    createdAt: reqString(o.createdAt, '$.createdAt'),
    createdBy: reqString(o.createdBy, '$.createdBy'),
    updatedAt: reqString(o.updatedAt, '$.updatedAt'),
  }
  return rec
}
