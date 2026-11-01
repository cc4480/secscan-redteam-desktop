/**
 * Q-REPORT-DETAIL — pure derivations for the detail sections (spec
 * §§2–8): the predecessor diff, risk-area grouping, the business-impact
 * statement selection, and priority ranking. No rendering, no I/O —
 * every string is slot-filled here from the engagement record; the
 * renderer (html/detail-sections.ts) adds markup only. Fixed tables
 * live in detail-tables.ts, section-data builders in detail-blocks.ts,
 * the impact derivations (band + per-finding, Q-RP-4) in
 * detail-impact.ts. Honesty rules bind: a fact the record does not
 * carry stays absent, and an unclassifiable finding fails loud (§7.4),
 * never drops out.
 */
import {
  ARM_AREA, ARM_PILLAR, DEDUCTION_WEIGHT, ENGINE_ARM,
  FAMILY_AREA, SEVERITY_RANK, TIER_RANK, armOf, byRankThenId, compareIds,
  familyClass, isActionable, normalizeLabel, req,
} from './detail-tables.js'
import { buildBreakdown, buildPillars, buildSurface, coverageLine, diffFindings } from './detail-blocks.js'
import { buildFindingImpacts, buildImpact } from './detail-impact.js'

export { diffFindings } from './detail-blocks.js'

export type DetailTier = 'proven' | 'confirmed' | 'deferred'
export type DetailSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface DetailFindingInput {
  id: string
  title: string
  severity: DetailSeverity
  tier: DetailTier
  attackIds: string[]
  sourceLabel: string
  signals: string[]
  fix: string
}
export interface BaselineInput {
  engagementId: string
  startedAt: string
  dryRun: boolean
  score?: number
  grade?: string
  findings: DetailFindingInput[]
}
export interface ArmRun {
  name: string
  state: 'ran' | 'blocked' | 'not-covered'
  reason?: string
}
export interface CoverageFactsInput {
  totals: {
    total: number
    confirmed: number
    executedClean: number
    killed: number
    blocked: number
    na: number
    pending: number
  }
  probesUsed: number
  fullBattery: boolean
  notCovered: string[]
  planOnly: string[]
  arms: ArmRun[]
  pathProbes?: { executed: number; confirmedAmong: number }
  pagesDiscovered?: number
  endpointsDiscovered?: number
}
export interface SurfaceFactsInput {
  ips?: string[]
  nameservers?: string[]
  tlsGrade?: string
  tlsDetail?: string
  servedVia?: string
  technologies?: string[]
  serverHeaders?: string[]
}
export interface DetailInput {
  target: string
  mode: string
  dryRun: boolean
  posture: { score: number; grade: string; postureRating: string }
  worstConfirmed?: { id: string; severity: DetailSeverity; title: string } | null
  findingsBySeverity: Record<DetailSeverity, number>
  tierCounts: { proven: number; confirmed: number; deferred: number }
  findings: DetailFindingInput[]
  baseline?: BaselineInput
  coverage: CoverageFactsInput
  surface: SurfaceFactsInput
}
export interface DiffEntry {
  id?: string
  title: string
  severity: DetailSeverity
  note?: string
  fromSeverity?: DetailSeverity
  fromTier?: DetailTier
  toTier?: DetailTier
}
export interface FindingDiff {
  newFindings: DiffEntry[]
  resolved: DiffEntry[]
  worsened: DiffEntry[]
  improved: DiffEntry[]
  unchangedCount: number
  scoreDelta?: number
  findingsDelta: number
}
export interface RiskArea {
  name: string
  worst: DetailSeverity
  findings: { id: string; title: string; severity: DetailSeverity }[]
}
export interface PriorityEntry {
  id: string
  title: string
  severity: DetailSeverity
  tier: DetailTier
  fixSentence: string
}
export interface PillarCard {
  pillar: string
  scopeLabel: string
  status: 'NO ARM' | 'NOT COVERED' | 'FINDINGS' | 'SECURE' | 'MAPPED' | 'NO DATA'
  reason?: string
  findingCount: number
  bySeverity: Record<DetailSeverity, number>
  footnote?: string
}
export interface ReportDetail {
  breakdown: string[]
  diff: FindingDiff | null
  countsOnly: boolean
  baselineLabel?: string
  riskAreas: RiskArea[]
  deferredCount: number
  impact: { level: 'critical' | 'high' | 'medium' | 'low' | 'none'; text: string }
  /** Q-RP-4 — the per-finding Impact statements (detail-impact.ts),
   * keyed by finding id; findings of record only (PROVEN + CONFIRMED). */
  findingImpacts: Record<string, string>
  priority: { actions: PriorityEntry[]; verifyNext: PriorityEntry[]; zeroNote?: string }
  pillars: PillarCard[]
  surfaceNetwork: { label: string; value: string }[] | null
  surfaceDynamic: { label: string; value: string }[]
  actionableCount: number
}

/** The finding's own fix, truncated at its first sentence boundary. */
export function firstSentence(text: string): string {
  const t = text.trim()
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(t)
  return m ? m[0].trim() : t
}

interface Classified { area: string; pillar: string }

/** §4/§7 attribution for one actionable finding: arm table first,
 * then the §4.3 family table (engine findings split EASM/DAST per
 * §7.2). A single-token label that is not a known arm throws — the
 * §7.4 build error, so a finding can never fall out of every pillar. */
function classify(f: DetailFindingInput): Classified {
  const arm = armOf(f.sourceLabel)
  if (arm) {
    const area = ARM_AREA[arm]
    const pillar = ARM_PILLAR[arm]
    if (area === undefined || pillar === undefined) {
      throw new Error(`report detail: arm ${arm} missing from an attribution table`)
    }
    return { area, pillar }
  }
  const raw = f.sourceLabel.trim()
  if (raw !== '' && !/\s/.test(raw) && normalizeLabel(raw) !== ENGINE_ARM) {
    throw new Error(`report detail: source label ${JSON.stringify(raw)} is not a known arm (§7.1 table)`)
  }
  const fam = familyClass(f)
  return { area: fam ? FAMILY_AREA[fam] : 'General', pillar: fam === 'exposure' ? 'EASM' : 'DAST' }
}

function buildRiskAreas(actionable: DetailFindingInput[], areaOf: Map<string, string>): RiskArea[] {
  const byArea = new Map<string, DetailFindingInput[]>()
  for (const f of actionable) {
    const name = req(areaOf.get(f.id), `risk area for ${f.id}`)
    byArea.set(name, [...(byArea.get(name) ?? []), f])
  }
  return [...byArea.entries()]
    .map(([name, fs]) => ({
      name,
      worst: req([...fs].sort(byRankThenId)[0], 'risk-area member').severity,
      findings: [...fs].sort(byRankThenId).map(f => ({ id: f.id, title: f.title, severity: f.severity })),
    }))
    .sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] ||
      b.findings.length - a.findings.length || (a.name < b.name ? -1 : 1))
}

/** §6.1 order: tier, then anchored deduction weight, then F-id. */
function priorityOrder(fs: DetailFindingInput[]): DetailFindingInput[] {
  return [...fs].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    DEDUCTION_WEIGHT[b.severity] - DEDUCTION_WEIGHT[a.severity] || compareIds(a.id, b.id))
}
const toEntry = (f: DetailFindingInput): PriorityEntry => ({
  id: f.id, title: f.title, severity: f.severity, tier: f.tier, fixSentence: firstSentence(f.fix),
})

/** Assemble every detail derivation for one report. */
export function buildReportDetail(input: DetailInput): ReportDetail {
  const actionable = input.findings.filter(isActionable)
  const deferred = input.findings.filter(f => !isActionable(f))
  const areaOf = new Map<string, string>()
  const pillarOf = new Map<string, string>()
  for (const f of actionable) {
    const c = classify(f)
    areaOf.set(f.id, c.area)
    pillarOf.set(f.id, c.pillar)
  }
  const riskAreas = buildRiskAreas(actionable, areaOf)
  const diff = input.baseline ? diffFindings(input.findings, input.baseline, input.posture.score) : null
  const countsOnly = input.baseline ? typeof input.baseline.score !== 'number' : false
  return {
    breakdown: buildBreakdown(input, riskAreas, diff, countsOnly),
    diff,
    countsOnly,
    ...(input.baseline
      ? { baselineLabel: `${input.baseline.engagementId} · ${input.baseline.startedAt}` } : {}),
    riskAreas,
    deferredCount: deferred.length,
    impact: buildImpact(actionable, areaOf),
    findingImpacts: buildFindingImpacts(actionable, areaOf),
    priority: {
      actions: priorityOrder(actionable).map(toEntry),
      verifyNext: [...deferred]
        .sort((a, b) => DEDUCTION_WEIGHT[b.severity] - DEDUCTION_WEIGHT[a.severity] || compareIds(a.id, b.id))
        .map(toEntry),
      ...(actionable.length === 0 && deferred.length === 0
        ? { zeroNote: coverageLine(input.coverage) } : {}),
    },
    pillars: buildPillars(input, pillarOf),
    ...buildSurface(input),
    actionableCount: actionable.length,
  }
}
