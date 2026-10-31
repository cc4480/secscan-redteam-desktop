/**
 * Wave brief assembly (Q-CAMPAIGN, scoping N5).
 *
 * The brief is what makes a campaign more than a loop: each wave's
 * engagement is briefed from the campaign's accumulated state — the
 * verified scope, every earlier wave's aim and outcome rollup, the
 * hypotheses earlier waves killed, and the coverage gaps that remain —
 * so wave N+1 starts where wave N stopped instead of re-deriving it.
 *
 * Knowledge boundary (scoping §1/§7): this module composes from the
 * campaign record's own wave outcomes plus an optional caller-supplied
 * history digest (the Q-MEMTIER recall seam — ranking and retrieval
 * live there when it lands). It builds NO parallel knowledge store:
 * nothing here persists, indexes, or ranks findings.
 */

import type { CampaignKind, CampaignVector } from './kinds.js'
import type { WavePlan } from './planner.js'
import type { CampaignRecord } from './types.js'

/** One earlier wave, reduced to what a later brief needs from it. */
export interface WaveHistoryLine {
  waveIndex: number
  status: string
  aim?: string
  engagementStatus?: string
  totalFindings: number
  confirmed: number
  killed: number
  deferred: number
}

/** The assembled brief for one wave: objective + context for the engagement. */
export interface WaveBrief {
  campaignId: string
  waveIndex: number
  kind: string
  scopeHosts: string[]
  /** The engagement objective: campaign objective + this wave's aim. */
  objective: string
  /** The context block: scope, prior waves, killed lines, gaps, focus. */
  context: string
  focusVectors: string[]
  coverageGaps: string[]
  priorWaves: WaveHistoryLine[]
}

/**
 * Every launched wave of the record, oldest first, as history lines.
 * Planned-but-unlaunched waves are excluded — a plan is not history.
 * @param rec - The campaign record.
 * @returns The history lines for waves that have been launched.
 */
export function waveHistory(rec: CampaignRecord): WaveHistoryLine[] {
  return rec.waves
    .filter(w => w.launchedAt !== undefined)
    .map(w => ({
      waveIndex: w.index,
      status: w.status,
      ...(w.aim ? { aim: w.aim } : {}),
      ...(w.outcome
        ? {
          engagementStatus: w.outcome.engagementStatus,
          totalFindings: w.outcome.rollup.totalFindings,
          confirmed: w.outcome.rollup.confirmed,
          killed: w.outcome.rollup.killed,
          deferred: w.outcome.rollup.deferred,
        }
        : { totalFindings: 0, confirmed: 0, killed: 0, deferred: 0 }),
    }))
    .sort((a, b) => a.waveIndex - b.waveIndex)
}

/**
 * The kind's vectors that no wave has focused yet — the campaign's
 * remaining coverage gaps, in roster order.
 * @param kind - The campaign kind (its vector roster defines coverage).
 * @param focusedNames - Vector names already focused by earlier waves/plans.
 * @returns The unfocused vectors.
 */
export function coverageGaps(kind: CampaignKind, focusedNames: Iterable<string>): CampaignVector[] {
  const focused = new Set(focusedNames)
  return kind.vectors.filter(v => !focused.has(v.name))
}

/**
 * Assemble the brief for one planned wave.
 * @param rec - The campaign record (scope + objective + wave outcomes).
 * @param kind - The campaign kind.
 * @param plan - The wave plan this brief serves.
 * @param opts - Optional history digest (recall seam output: earlier
 *   findings and killed hypotheses in detail) and the vector names
 *   earlier waves focused (from their plan artifacts), for gap math.
 * @returns The wave brief.
 */
export function buildWaveBrief(
  rec: CampaignRecord,
  kind: CampaignKind,
  plan: WavePlan,
  opts: { historyDigest?: string; priorFocusVectors?: string[] } = {},
): WaveBrief {
  const prior = waveHistory(rec).filter(h => h.waveIndex < plan.waveIndex)
  const gaps = coverageGaps(kind, [...(opts.priorFocusVectors ?? []), ...plan.focusVectors])
  const focusDetail = kind.vectors.filter(v => plan.focusVectors.includes(v.name))

  const lines: string[] = []
  lines.push('CAMPAIGN CONTEXT — read before acting; this ground is already covered.')
  lines.push(`Campaign: ${rec.name} (${rec.id}) · doctrine: ${kind.name} · wave ${plan.waveIndex} of at most ${rec.caps.maxWaves}.`)
  lines.push(`Verified scope (do not widen): ${rec.scope.hosts.join(', ')} — verification reference ${rec.scope.verificationRef}.`)
  lines.push('')
  if (prior.length === 0) {
    lines.push('PRIOR WAVES: none — this is the opening wave.')
  } else {
    lines.push('PRIOR WAVES (aim and outcome — do not re-run an identical probe):')
    for (const h of prior) {
      const outcome = h.engagementStatus
        ? `engagement ${h.engagementStatus}: ${h.totalFindings} finding(s) — ${h.confirmed} confirmed, ${h.killed} killed, ${h.deferred} deferred`
        : `no outcome recorded (${h.status})`
      lines.push(`- Wave ${h.waveIndex}${h.aim ? ` — ${h.aim}` : ''} → ${outcome}`)
    }
    const killedTotal = prior.reduce((n, h) => n + h.killed, 0)
    if (killedTotal > 0) {
      lines.push(
        `Killed hypotheses so far: ${killedTotal}. A killed line is closed — revisit it only with a materially different probe, and say what changed.`,
      )
    }
  }
  if (opts.historyDigest && opts.historyDigest.trim() !== '') {
    lines.push('')
    lines.push('PRIOR FINDINGS AND KILLED HYPOTHESES (from the campaign history):')
    lines.push(opts.historyDigest.trim())
  }
  lines.push('')
  lines.push('FOCUS THIS WAVE:')
  for (const v of focusDetail) lines.push(`- ${v.name} (${v.owns}): ${v.brief}`)
  if (gaps.length > 0) {
    lines.push('')
    lines.push(`COVERAGE GAPS AFTER THIS WAVE (not yet focused by any wave): ${gaps.map(v => v.name).join(', ')}.`)
    lines.push("Later waves take these up; note anything you observe that bears on them, but stay on this wave's focus.")
  }

  return {
    campaignId: rec.id,
    waveIndex: plan.waveIndex,
    kind: kind.name,
    scopeHosts: [...rec.scope.hosts],
    objective: `${rec.objective}\n\nWave ${plan.waveIndex} aim: ${plan.aim}`,
    context: lines.join('\n'),
    focusVectors: [...plan.focusVectors],
    coverageGaps: gaps.map(v => v.name),
    priorWaves: prior,
  }
}
