/**
 * The authoritative report document (Carlos's order, 2026-11-01: ONE
 * template system for every artifact, the HTML flagship).
 *
 * Every deliverable format — report.html, report.md, report.json,
 * report.txt, findings.csv, report.docx — renders THIS model, and no
 * format assembles its own structure anymore. The model is built once
 * from the report phase's structured input (html/render.ts's
 * EngagementReportInput) and fixes, in one place:
 *
 *   - the canonical section order (REPORT_SECTION_ORDER — the locked
 *     design's anatomy: cover → posture banner → executive summary →
 *     coverage → severity breakdown → findings by truth tier → fix
 *     prompt → priority actions → pillars → strengths → surface →
 *     inventory → activity → recorded frame → limitations → footer);
 *   - the truth-tier grouping (PROVEN → CONFIRMED → DEFERRED → RULED
 *     OUT), severity-ordered within a tier, with ruled-out negative
 *     proofs de-duplicated against killed findings by exact normalized
 *     title — the same grouping rule the HTML cards have always used,
 *     now shared by every format;
 *   - the canonical counts: severity counts are the grading seam's
 *     posture counts (confirmed findings), and tier counts include the
 *     de-duplicated negative proofs in ruled-out — so the grade line,
 *     the severity line, and the tier line read identically in every
 *     artifact (previously report.json/report.txt counted ALL findings
 *     by severity while the HTML/DOCX showed the posture counts, and
 *     the same engagement disagreed with itself across formats);
 *   - the consolidated fix prompt, composed once by the HTML section
 *     builder (html/sections.ts buildFixPrompt) and carried as data.
 *
 * Nothing here invents content: a section is present exactly when the
 * engagement record carries its data (what-changed renders only
 * against a real predecessor scan — that rule lives in detail.ts; the
 * PROVEN tier exists only behind execution-tier proof — tierOf).
 */
import { type PostureBanner, type SecurityPosture } from '#seclayer/server/scoring.js'
import { type Finding } from '../types.js'
import { type NegativeProof, type PocBundle } from '../proof/index.js'
import { type ReportMeta } from './html.js'
import { severityRank, tierOf, type FindingMeta } from './html/cards.js'
import { buildFixPrompt, type TeamMember } from './html/sections.js'
import { TIER_ORDER, type ReportTier, type SeverityName } from './html/tokens.js'
import {
  type ActivityInput,
  type CoverageInput,
  type EngagementReportInput,
} from './html/render.js'
import { type ReportDetail } from './detail.js'
import { type ReportMatter } from './detail-matter.js'
import { type HostInventoryArtifact } from './host-inventory.js'

/** The canonical anatomy, in order. Every renderer's section sequence
 * is a subsequence of this list; `sections` on the document names the
 * ones the record actually carries. */
export const REPORT_SECTION_ORDER = [
  'cover',
  'banner',
  'team',
  'executive-summary',
  'coverage',
  'severity-breakdown',
  'findings',
  'fix-prompt',
  'priority-actions',
  'pillars',
  'strengths',
  'surface',
  'inventory',
  'activity',
  'recorded-frame',
  'limitations',
  'footer',
] as const

export type ReportSectionId = (typeof REPORT_SECTION_ORDER)[number]

/** One truth tier of the Findings section: its findings in report
 * order, plus — on the ruled-out tier only — the negative proofs that
 * no killed finding already states. */
export interface ReportTierGroup {
  tier: ReportTier
  findings: Finding[]
  negativeProof: NegativeProof[]
}

export interface ReportDocument {
  meta: ReportMeta
  title: string
  /** Reporter narrative markdown (findings JSON already stripped). */
  narrativeMd: string
  /** The anchored grade over the confirmed findings (grading seam). */
  posture: SecurityPosture
  banner: PostureBanner | null
  /** The fleet seats that ran, when the record names them. */
  team?: TeamMember[]
  haltedReason?: string
  blockedReason?: string
  dryRun?: boolean
  /** Canonical severity counts — the posture's, in every format. */
  severityCounts: Record<SeverityName, number>
  /** Canonical tier counts (ruled-out includes negative proofs). */
  tierCounts: Record<ReportTier, number>
  /** Non-empty tier groups, in TIER_ORDER. */
  tierGroups: ReportTierGroup[]
  /** Every finding in report order (tier → severity → id). */
  findingsInReportOrder: Finding[]
  /** The consolidated fix prompt text; "" when nothing is actionable. */
  fixPrompt: string
  bundles: ReadonlyMap<string, PocBundle>
  noBundleReasons: ReadonlyMap<string, string>
  findingMeta: ReadonlyMap<string, FindingMeta>
  detail?: ReportDetail
  matter?: ReportMatter
  coverage: CoverageInput
  activity: ActivityInput
  inventory?: HostInventoryArtifact
  /** The sections this record carries, in canonical order. */
  sections: ReportSectionId[]
}

const norm = (s: string): string => s.trim().toLowerCase()

function tierGroupsOf(o: EngagementReportInput): {
  groups: ReportTierGroup[]
  counts: Record<ReportTier, number>
  ordered: Finding[]
} {
  const byTier = new Map<ReportTier, Finding[]>()
  for (const f of o.findings) {
    const tier = tierOf(f, o.bundles.get(f.id))
    const list = byTier.get(tier) ?? []
    list.push(f)
    byTier.set(tier, list)
  }
  const killedTitles = new Set((byTier.get('ruled-out') ?? []).map(f => norm(f.title)))
  const extraNegatives = o.negativeProof.filter(n => !killedTitles.has(norm(n.hypothesis)))

  const groups: ReportTierGroup[] = []
  const counts: Record<ReportTier, number> = { proven: 0, confirmed: 0, deferred: 0, 'ruled-out': 0 }
  const ordered: Finding[] = []
  for (const tier of TIER_ORDER) {
    const list = (byTier.get(tier) ?? [])
      .slice()
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id))
    const negatives = tier === 'ruled-out' ? extraNegatives : []
    counts[tier] = list.length + negatives.length
    ordered.push(...list)
    if (list.length > 0 || negatives.length > 0) {
      groups.push({ tier, findings: list, negativeProof: negatives })
    }
  }
  return { groups, counts, ordered }
}

function sectionsOf(o: EngagementReportInput, doc: {
  fixPrompt: string
  tierGroups: ReportTierGroup[]
}): ReportSectionId[] {
  const d = o.detail
  const present = new Set<ReportSectionId>([
    'cover',
    'coverage',
    'severity-breakdown',
    'findings',
    'footer',
  ])
  // The banner slot renders the halt/block banner when the end was not
  // a completion, else the posture banner when the grading seam
  // produced one.
  if (o.haltedReason || o.blockedReason || o.banner) present.add('banner')
  if (o.team && o.team.length > 0) present.add('team')
  // The activity section renders only over a non-empty audit log (the
  // HTML section's own guard); an engagement always has events in
  // practice, but the manifest states the record, not the habit.
  if (o.activity.eventCount > 0) present.add('activity')
  // The detail derivations render inside the executive-summary segment
  // (breakdown / what-changed / risk areas / impact) whenever they
  // exist, even when the reporter narrative itself is empty.
  if (o.narrativeMd.trim() || d) present.add('executive-summary')
  if (doc.fixPrompt) present.add('fix-prompt')
  if (d) {
    if (d.priority.zeroNote || d.priority.actions.length > 0 || d.priority.verifyNext.length > 0) {
      present.add('priority-actions')
    }
    present.add('pillars')
    if ((d.surfaceNetwork && d.surfaceNetwork.length > 0) || d.surfaceDynamic.length > 0) {
      present.add('surface')
    }
  }
  if (o.matter?.strengths) present.add('strengths')
  if (o.inventory !== undefined) present.add('inventory')
  if (o.matter) {
    present.add('recorded-frame')
    present.add('limitations')
  }
  return REPORT_SECTION_ORDER.filter(s => present.has(s))
}

/** Build the one report document from the phase's structured input. */
export function buildReportDocument(o: EngagementReportInput): ReportDocument {
  const { groups, counts, ordered } = tierGroupsOf(o)
  const fixPrompt = buildFixPrompt(o.meta.target, o.findings, o.bundles)
  const partial = { fixPrompt, tierGroups: groups }
  return {
    meta: o.meta,
    title: o.title,
    narrativeMd: o.narrativeMd,
    posture: o.posture,
    banner: o.banner,
    team: o.team,
    haltedReason: o.haltedReason,
    blockedReason: o.blockedReason,
    dryRun: o.dryRun,
    severityCounts: { ...(o.posture.findingsBySeverity as Record<SeverityName, number>) },
    tierCounts: counts,
    tierGroups: groups,
    findingsInReportOrder: ordered,
    fixPrompt,
    bundles: o.bundles,
    noBundleReasons: o.noBundleReasons,
    findingMeta: o.findingMeta,
    detail: o.detail,
    matter: o.matter,
    coverage: o.coverage,
    activity: o.activity,
    inventory: o.inventory,
    sections: sectionsOf(o, partial),
  }
}
