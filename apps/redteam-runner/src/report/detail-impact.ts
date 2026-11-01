/**
 * Q-REPORT-DETAIL §5 + Q-RP-4 — the impact derivations for report/detail.ts:
 * the report-level business-impact band and the per-finding Impact
 * statements. Both are composed ONLY from the spec's fixed statement
 * table (AREA_IMPACT) plus slots the record itself carries (severity,
 * tier, the finding's §4 risk area) — no freehand prose, no invented
 * consequences. A finding whose area has no clause fails loud via req(),
 * like every other derivation.
 */
import type { DetailFindingInput, DetailTier } from './detail.js'
import {
  AREA_IMPACT, SEVERITY_RANK, TIER_RANK, compareIds, plural, req,
} from './detail-tables.js'

export interface ImpactBand {
  level: 'critical' | 'high' | 'medium' | 'low' | 'none'
  text: string
}

/** §5 selection is worst-severity-first: the band names, and takes its
 * clause from, the most severe finding (tier, then F-id, break ties).
 * Supersedes the earlier tier-first reading — §6's tier-first order
 * governs the priority list only, never the impact clause's source. */
const bySeverityFirst = (a: DetailFindingInput, b: DetailFindingInput): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  TIER_RANK[a.tier] - TIER_RANK[b.tier] || compareIds(a.id, b.id)

/** §5 — the impact band selects the first matching fixed statement. */
export function buildImpact(
  actionable: DetailFindingInput[],
  areaOf: Map<string, string>,
): ImpactBand {
  if (actionable.length === 0) {
    return {
      level: 'none',
      text: 'No material business risk identified from this pass; continued monitoring is still recommended as the application evolves.',
    }
  }
  const ranked = [...actionable].sort(bySeverityFirst)
  const clause = (f: DetailFindingInput): string =>
    req(AREA_IMPACT[req(areaOf.get(f.id), `risk area for ${f.id}`)], 'impact clause')
  const critical = ranked.find(f => f.severity === 'critical')
  if (critical) {
    const area = req(areaOf.get(critical.id), `risk area for ${critical.id}`)
    const incident = area === 'API & Object Access' || area === 'Credential & Secret Exposure'
      ? ' Treat as an incident until the fix is verified by retest.' : ''
    return {
      level: 'critical',
      text: `Material business risk: ${critical.id} (${critical.title}) is confirmed against the live target. ${clause(critical)}${incident}`,
    }
  }
  const highs = ranked.filter(f => f.severity === 'high')
  if (highs.length > 0) {
    const top = req(highs[0], 'high finding')
    return {
      level: 'high',
      text: `Elevated business risk: ${highs.length} high-severity ${plural(highs.length, 'finding', 'findings')} confirmed, the most serious being ${top.title} (${req(areaOf.get(top.id), 'risk area')}). ${clause(top)} Remediate on the priority order in §6 before the next release.`,
    }
  }
  if (ranked.some(f => f.severity === 'medium')) {
    return {
      level: 'medium',
      text: `Moderate business risk: the confirmed findings are exploitable weaknesses without a demonstrated path to data loss in this pass. ${clause(req(ranked[0], 'actionable finding'))}`,
    }
  }
  return {
    level: 'low',
    text: `Low material risk from this pass: the confirmed items are hardening and exposure-reduction items. ${actionable.length} ${plural(actionable.length, 'item', 'items')} listed under Priority Actions.`,
  }
}

/** The per-finding lead-in: a fixed string keyed by the finding's own
 * recorded tier, with its recorded severity slotted in. Nothing else
 * about the finding is asserted — the consequence is the area clause. */
const FINDING_LEAD: Partial<Record<DetailTier, string>> = {
  proven: 'Demonstrated live against the target in this engagement',
  confirmed: 'Confirmed against the target in this engagement',
}

/** Q-RP-4 — one Impact statement per finding of record (PROVEN +
 * CONFIRMED; the caller passes exactly the actionable set). DEFERRED
 * findings get none — verification is outstanding, so no consequence
 * may be asserted — and ruled-out findings are not in the set at all.
 * The exemplar's per-finding Impact block, derived mechanically at
 * report time: status lead-in + the finding's §5 area clause. */
export function buildFindingImpacts(
  actionable: DetailFindingInput[],
  areaOf: Map<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of actionable) {
    const lead = req(FINDING_LEAD[f.tier], `impact lead-in for tier ${f.tier}`)
    const clause = req(
      AREA_IMPACT[req(areaOf.get(f.id), `risk area for ${f.id}`)],
      'impact clause',
    )
    out[f.id] = `${lead} (${f.severity} severity). ${clause}`
  }
  return out
}
