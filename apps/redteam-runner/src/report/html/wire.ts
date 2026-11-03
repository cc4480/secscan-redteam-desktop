/**
 * Wiring between the report phase and the unified HTML renderer.
 *
 * The phase already computes every object the design needs (posture,
 * bundles, coverage cells, the item ledger, the event projections) — this
 * module shapes them into the renderer's structured input so phase.ts
 * stays a thin call site. Nothing here invents data: a field the records
 * do not carry stays absent and the design degrades around it.
 */
import { type Ctx, type LiveFinding } from '../../context.js'
import { type EngagementEvent, type Finding } from '../../types.js'
import { BATTERY_CATEGORIES } from '../../battery.js'
import { TARGET_PROFILES, activeTargets } from '../../targets.js'
import { type NegativeProof, type PocBundle } from '../../proof/index.js'
import { gradeBanner, gradeFindings } from '../grading.js'
import { buildReportDetail, type DetailInput } from '../detail.js'
import { buildReportMatter, type ReportMatter } from '../detail-matter.js'
import { tierOf } from './cards.js'
import { readHostInventory } from '../host-inventory.js'
import { type ReportMeta } from '../html.js'
import {
  type ActivityInput,
  type CoverageInput,
  type EngagementReportInput,
  type FindingMeta,
} from './render.js'
import { buildActivity } from './activity.js'
import { FLEET_TEAM } from './fleet.js'
export { FLEET_TEAM }

/** Structured proof data the proof section computes alongside its
 * markdown (no-bundle reasons per finding + negative proofs). */
export interface ProofData {
  noBundleReasons: Map<string, string>
  negative: NegativeProof[]
}

export interface WireDeps {
  ctx: Ctx
  meta: ReportMeta
  title: string
  findings: Finding[]
  /** The reporter narrative BEFORE runner-computed sections are appended. */
  narrativeMd: string
  bundles: ReadonlyMap<string, PocBundle>
  proof: ProofData
  /** Full-battery cell states ({target, category, state}); empty when the
   * engagement was not full-battery — cells are then derived from the
   * scoped coverage set. */
  cells: CoverageInput['cells']
  totals: CoverageInput['totals']
  planOnly: string[]
  events: EngagementEvent[]
  haltedReason?: string
  blockedReason?: string
  /** The assembled detail derivations input (report/predecessor.ts),
   * when the phase could build one; absent => pre-detail anatomy. */
  detailInput?: DetailInput
}

/**
 * Remove the reporter's trailing findings JSON block from the narrative.
 * The block is machine data — the findings render as cards — and leaving
 * it in the executive summary would print raw JSON as prose. Only a
 * fenced block that parses to an object with a findings array is cut;
 * anything else is the reporter's prose and stays untouched.
 */
export function stripFindingsJson(md: string): string {
  const m = md.match(/```json\s*([\s\S]*?)```/i) ?? md.match(/```\s*([\s\S]*?)```/)
  if (!m || m.index === undefined) return md
  try {
    const parsed = JSON.parse(m[1] ?? '') as { findings?: unknown } | null
    if (parsed && Array.isArray(parsed.findings)) {
      return (md.slice(0, m.index) + md.slice(m.index + m[0].length)).trimEnd()
    }
  } catch {
    /* not the findings block — leave the prose untouched */
  }
  return md
}

/** Q-RP-3 report-phase join: stamp each final finding's engine-recorded
 * CVSS/CWE from its source live finding. Matching is corroborated, never
 * positional-only: the positional candidate (the halted path's map and
 * the reporter's list both preserve live order) must agree on attackId or
 * title; failing that, a unique attackId+title match across the live set
 * wins. Ambiguous or unmatched ⇒ the fields are REMOVED, so a value the
 * reporter JSON invented cannot survive into the report. */
export function applyFindingRefs(findings: Finding[], liveFindings: readonly LiveFinding[]): void {
  const corroborates = (f: Finding, lf: LiveFinding): boolean =>
    f.attackIds.includes(lf.attackId) || f.title === lf.title
  for (const f of findings) {
    const idx = Number.parseInt(f.id.replace(/^F-/, ''), 10)
    const positional = Number.isInteger(idx) && idx >= 1 ? liveFindings[idx - 1] : undefined
    let source = positional && corroborates(f, positional) ? positional : undefined
    if (!source) {
      const strong = liveFindings.filter(lf => f.attackIds.includes(lf.attackId) && f.title === lf.title)
      if (strong.length === 1) source = strong[0]
    }
    if (source?.cvss !== undefined) f.cvss = source.cvss
    else delete f.cvss
    if (source?.cwe !== undefined) f.cwe = source.cwe
    else delete f.cwe
  }
}

/** Per-finding reference data from the PoC bundle's battery item: the
 * item's battery category and OWASP reference are recorded data (the
 * battery definitions carry both), resolved through the same profile the
 * proof section attributed the bundle to. Findings without a bundle have
 * no recorded category — the map simply has no entry for them. Q-RP-3:
 * engine-recorded CVSS/CWE stamped onto the final findings by
 * applyFindingRefs merge into the same map, so the reference chips and
 * findings.csv read one model. */
export function buildFindingMeta(
  bundles: ReadonlyMap<string, PocBundle>,
  findings: readonly Finding[] = [],
): Map<string, FindingMeta> {
  const out = new Map<string, FindingMeta>()
  for (const [findingId, bundle] of bundles) {
    if (!bundle.batteryItemId) continue
    const sep = bundle.batteryItemId.indexOf(':')
    if (sep <= 0) continue
    const tid = bundle.batteryItemId.slice(0, sep)
    const itemId = bundle.batteryItemId.slice(sep + 1)
    if (!Object.prototype.hasOwnProperty.call(TARGET_PROFILES, tid)) continue
    const profile = TARGET_PROFILES[tid as keyof typeof TARGET_PROFILES]
    const item = profile.battery.find(b => b.id === itemId)
    if (item) out.set(findingId, { category: item.category, owasp: item.owasp })
  }
  for (const f of findings) {
    if (f.cvss === undefined && f.cwe === undefined) continue
    const meta = out.get(f.id) ?? {}
    if (f.cvss !== undefined) meta.cvss = f.cvss
    if (f.cwe !== undefined) meta.cwe = f.cwe
    out.set(f.id, meta)
  }
  return out
}

function buildCoverage(deps: WireDeps): CoverageInput {
  const { ctx } = deps
  if (ctx.input.fullBattery) {
    return {
      fullBattery: true,
      cells: deps.cells,
      totals: deps.totals,
      probesUsed: ctx.probesUsed,
      planOnly: deps.planOnly,
      notCovered: deps.cells.filter(c => c.state === 'missing').map(c => `${c.target}:${c.category}`),
    }
  }
  return {
    fullBattery: false,
    cells: BATTERY_CATEGORIES.map(c => ({
      target: 'scoped run',
      category: c,
      state: ctx.coverage.has(c) ? ('done' as const) : ('missing' as const),
    })),
    totals: deps.totals,
    probesUsed: ctx.probesUsed,
    planOnly: [],
    notCovered: BATTERY_CATEGORIES.filter(c => !ctx.coverage.has(c)),
  }
}


/** Q-RP-7 / Q-RP-8: assemble the front/back-matter + strengths
 * derivations from the same records the rest of the input reads — the
 * ROE and verification record off ctx, the coverage/activity inputs
 * just built, the item ledger's executed-clean items grouped by
 * (target, category), and the ruled-out set (killed findings plus
 * negative proofs, de-duplicated by normalised title exactly as the
 * renderer's tier grouping de-duplicates them). */
function buildMatter(deps: WireDeps, coverage: CoverageInput, activity: ActivityInput): ReportMatter {
  const { ctx, meta } = deps
  const roe = ctx.input.roe
  const cleanByArea = new Map<string, { target: string; category: string; items: number }>()
  for (const v of ctx.itemLedger.values()) {
    if (v.disposition !== 'executed-clean') continue
    const key = `${v.target}|${v.category}`
    const entry = cleanByArea.get(key) ?? { target: v.target, category: v.category, items: 0 }
    entry.items++
    cleanByArea.set(key, entry)
  }
  const killedTitles = deps.findings
    .filter(f => tierOf(f, deps.bundles.get(f.id)) === 'ruled-out')
    .map(f => f.title)
  const killedNorm = new Set(killedTitles.map(t => t.trim().toLowerCase()))
  const ruledOut = [
    ...killedTitles,
    ...deps.proof.negative
      .filter(n => !killedNorm.has(n.hypothesis.trim().toLowerCase()))
      .map(n => n.hypothesis),
  ]
  const planPhases: string[] = []
  for (const s of ctx.plan?.steps ?? []) {
    if (!planPhases.includes(s.phase)) planPhases.push(s.phase)
  }
  return buildReportMatter({
    target: meta.target,
    objective: meta.objective,
    mode: meta.mode,
    tier: meta.tier,
    environment: meta.environment,
    localHost: ctx.input.localHost === true,
    dryRun: ctx.config.dryRunAgents === true,
    scope: roe.scope,
    outOfScope: roe.outOfScope ?? [],
    excludedTechniques: roe.excludedTechniques ?? [],
    stopConditions: roe.stopConditions ?? [],
    testWindow: roe.testWindow,
    deconflictionContact: roe.deconflictionContact,
    verified: meta.verified,
    verifiedAt: ctx.verifiedAt,
    verificationProof: ctx.verificationProof,
    operator: meta.operator,
    client: meta.client,
    startedAt: meta.startedAt,
    generatedAt: meta.generatedAt,
    fullBattery: coverage.fullBattery,
    batteryTargets: ctx.input.fullBattery
      ? activeTargets(ctx.input).map(t => ({ id: t, items: TARGET_PROFILES[t].battery.length }))
      : [],
    categoriesProbed: BATTERY_CATEGORIES.filter(c =>
      coverage.cells.some(cell => cell.category === c && cell.state === 'done'),
    ),
    planPhases,
    probesUsed: coverage.probesUsed,
    toolActions: activity.totalActions,
    eventCount: activity.eventCount,
    totals: coverage.totals,
    notCovered: coverage.notCovered,
    planOnly: coverage.planOnly,
    blockedCells: coverage.cells
      .filter(c => c.state === 'blocked')
      .map(c => `${c.target}:${c.category}`),
    haltedReason: deps.haltedReason,
    executedClean: coverage.totals.executedClean,
    cleanAreas: [...cleanByArea.values()].sort(
      (a, b) => a.target.localeCompare(b.target) || a.category.localeCompare(b.category),
    ),
    ruledOut,
  })
}

/** The optional derivations (detail, matter) enrich the report — they
 * must never kill it: a throw degrades that section to absent (the
 * renderer's designed anatomy) and records `report_detail_failed`. */
function deriveSection<T>(deps: WireDeps, section: string, build: () => T): T | undefined {
  try { return build() } catch (err) {
    deps.ctx.events.append({
      phase: 'report', actor: 'runner', action: 'report_detail_failed',
      result: `Report ${section} derivation failed (report renders without it): ${(err as Error).message}`,
    })
    return undefined
  }
}


/** Assemble the renderer's structured input from the phase's records. */
export function buildEngagementReportInput(deps: WireDeps): EngagementReportInput {
  const coverage = buildCoverage(deps)
  const activity = buildActivity(deps.events)
  const detailInput = deps.detailInput
  return {
    meta: deps.meta,
    title: deps.title,
    narrativeMd: stripFindingsJson(deps.narrativeMd),
    posture: gradeFindings(deps.findings),
    banner: gradeBanner(deps.findings),
    team: FLEET_TEAM,
    findings: deps.findings,
    bundles: deps.bundles,
    noBundleReasons: deps.proof.noBundleReasons,
    negativeProof: deps.proof.negative,
    findingMeta: buildFindingMeta(deps.bundles, deps.findings),
    detail: detailInput ? deriveSection(deps, 'detail', () => buildReportDetail(detailInput)) : undefined,
    inventory: readHostInventory(deps.ctx.events.dir),
    coverage,
    activity,
    matter: deriveSection(deps, 'matter', () => buildMatter(deps, coverage, activity)),
    haltedReason: deps.haltedReason,
    blockedReason: deps.blockedReason,
    dryRun: deps.ctx.config.dryRunAgents,
  }
}
