/**
 * Wiring between the report phase and the unified HTML renderer.
 *
 * The phase already computes every object the design needs (posture,
 * bundles, coverage cells, the item ledger, the event projections) — this
 * module shapes them into the renderer's structured input so phase.ts
 * stays a thin call site. Nothing here invents data: a field the records
 * do not carry stays absent and the design degrades around it.
 */
import { type Ctx } from "../../context.js";
import { type EngagementEvent, type Finding } from "../../types.js";
import { BATTERY_CATEGORIES } from "../../battery.js";
import { TARGET_PROFILES } from "../../targets.js";
import { projectApprovals, projectDanglingCauses, projectToolStats } from "../../events/projections.js";
import { type NegativeProof, type PocBundle } from "../../proof/index.js";
import { gradeBanner, gradeFindings } from "../grading.js";
import { type ReportMeta } from "../html.js";
import {
  type ActivityInput,
  type CoverageInput,
  type EngagementReportInput,
  type FindingMeta,
} from "./render.js";

/** Structured proof data the proof section computes alongside its
 * markdown (no-bundle reasons per finding + negative proofs). */
export interface ProofData {
  noBundleReasons: Map<string, string>;
  negative: NegativeProof[];
}

export interface WireDeps {
  ctx: Ctx;
  meta: ReportMeta;
  title: string;
  findings: Finding[];
  /** The reporter narrative BEFORE runner-computed sections are appended. */
  narrativeMd: string;
  bundles: ReadonlyMap<string, PocBundle>;
  proof: ProofData;
  /** Full-battery cell states ({target, category, state}); empty when the
   * engagement was not full-battery — cells are then derived from the
   * scoped coverage set. */
  cells: CoverageInput["cells"];
  totals: CoverageInput["totals"];
  planOnly: string[];
  events: EngagementEvent[];
  haltedReason?: string;
}

/**
 * Remove the reporter's trailing findings JSON block from the narrative.
 * The block is machine data — the findings render as cards — and leaving
 * it in the executive summary would print raw JSON as prose. Only a
 * fenced block that parses to an object with a findings array is cut;
 * anything else is the reporter's prose and stays untouched.
 */
export function stripFindingsJson(md: string): string {
  const m = md.match(/```json\s*([\s\S]*?)```/i) ?? md.match(/```\s*([\s\S]*?)```/);
  if (!m || m.index === undefined) return md;
  try {
    const parsed = JSON.parse(m[1] ?? "") as { findings?: unknown } | null;
    if (parsed && Array.isArray(parsed.findings)) {
      return (md.slice(0, m.index) + md.slice(m.index + m[0].length)).trimEnd();
    }
  } catch {
    /* not the findings block — leave the prose untouched */
  }
  return md;
}

/** Per-finding reference data from the PoC bundle's battery item: the
 * item's battery category and OWASP reference are recorded data (the
 * battery definitions carry both), resolved through the same profile the
 * proof section attributed the bundle to. Findings without a bundle have
 * no recorded category — the map simply has no entry for them. */
export function buildFindingMeta(bundles: ReadonlyMap<string, PocBundle>): Map<string, FindingMeta> {
  const out = new Map<string, FindingMeta>();
  for (const [findingId, bundle] of bundles) {
    if (!bundle.batteryItemId) continue;
    const sep = bundle.batteryItemId.indexOf(":");
    if (sep <= 0) continue;
    const tid = bundle.batteryItemId.slice(0, sep);
    const itemId = bundle.batteryItemId.slice(sep + 1);
    if (!Object.prototype.hasOwnProperty.call(TARGET_PROFILES, tid)) continue;
    const profile = TARGET_PROFILES[tid as keyof typeof TARGET_PROFILES];
    const item = profile.battery.find((b) => b.id === itemId);
    if (item) out.set(findingId, { category: item.category, owasp: item.owasp });
  }
  return out;
}

function buildCoverage(deps: WireDeps): CoverageInput {
  const { ctx } = deps;
  if (ctx.input.fullBattery) {
    return {
      fullBattery: true,
      cells: deps.cells,
      totals: deps.totals,
      probesUsed: ctx.probesUsed,
      planOnly: deps.planOnly,
      notCovered: deps.cells.filter((c) => c.state === "missing").map((c) => `${c.target}:${c.category}`),
    };
  }
  return {
    fullBattery: false,
    cells: BATTERY_CATEGORIES.map((c) => ({
      target: "scoped run",
      category: c,
      state: ctx.coverage.has(c) ? ("done" as const) : ("missing" as const),
    })),
    totals: deps.totals,
    probesUsed: ctx.probesUsed,
    planOnly: [],
    notCovered: BATTERY_CATEGORIES.filter((c) => !ctx.coverage.has(c)),
  };
}

function buildActivity(events: EngagementEvent[]): ActivityInput {
  const stats = projectToolStats(events);
  return {
    eventCount: events.length,
    rows: stats.slice(0, 40).map((s) => ({
      action: s.action,
      count: s.count,
      attackIds: s.attackIds,
      firstSeq: s.firstSeq,
      lastSeq: s.lastSeq,
    })),
    totalActions: stats.length,
    decisions: projectApprovals(events).map((e) => ({ action: e.action, seq: e.seq })),
    danglingCauses: projectDanglingCauses(events),
  };
}

/** Assemble the renderer's structured input from the phase's records. */
export function buildEngagementReportInput(deps: WireDeps): EngagementReportInput {
  return {
    meta: deps.meta,
    title: deps.title,
    narrativeMd: stripFindingsJson(deps.narrativeMd),
    posture: gradeFindings(deps.findings),
    banner: gradeBanner(deps.findings),
    findings: deps.findings,
    bundles: deps.bundles,
    noBundleReasons: deps.proof.noBundleReasons,
    negativeProof: deps.proof.negative,
    findingMeta: buildFindingMeta(deps.bundles),
    coverage: buildCoverage(deps),
    activity: buildActivity(deps.events),
    haltedReason: deps.haltedReason,
    dryRun: deps.ctx.config.dryRunAgents,
  };
}
