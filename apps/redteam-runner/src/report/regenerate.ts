/**
 * Report regeneration from an engagement's recorded state
 * (diag-html-report 2026-11-01, Cause 2 follow-up).
 *
 * At a recorded end the pipeline fires the deliverable set exactly once.
 * If the HTML twin died in its failure domain, the set stayed incomplete
 * forever: `engagement_report` is read-only and nothing could re-fire
 * generation, so the operator's only remedy was a new engagement. This
 * module is that repair path: it re-assembles the report from what the
 * run recorded on disk — report.json (the report model), report.md (the
 * narrative), state.json, events.jsonl, poc/*.json — then re-runs the
 * phase's own emitters and `finalizeDeliverables`, so the outcome is
 * verified and stamped exactly as at close. A dead end (a non-terminal
 * record with no live run behind it) regenerates as a halted end.
 *
 * What the record does NOT carry, stated plainly: the detail/matter
 * derivations need the live context (ROE, plan, item ledger), so a
 * regenerated HTML renders the renderer's pre-detail / no-matter
 * anatomy; the engagement's tier and environment were never persisted,
 * so the cover meta carries the codebase defaults (tier 1, staging —
 * the same defaults buildEngagementMeta and the launch surface use);
 * per-finding no-bundle reasons and negative proofs are recomputed by
 * the live proof section only, so regenerated cards omit them rather
 * than inventing them. Findings, grade, totals, cells, coverage and the
 * narrative all read back from the run's own record — nothing is
 * derived from severity or estimated.
 */
import { rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventLog, readEvents, readState, type LiveState } from "../events.js";
import { type Ctx } from "../context.js";
import { type EngagementEvent, type Finding } from "../types.js";
import { BATTERY_CATEGORIES, type BatteryCategory } from "../battery.js";
import { resolveOperatorName } from "../accountability/index.js";
import { projectApprovals, projectDanglingCauses, projectToolStats } from "../events/projections.js";
import { type PocBundle } from "../proof/index.js";
import { ledgerSummary, type ItemVerdict } from "../coverage/items.js";
import { gradeBanner, gradeFindings } from "./grading.js";
import { type ReportMeta } from "./html.js";
import { readHostInventory } from "./host-inventory.js";
import { renderEngagementReportHtml, type ActivityInput, type CoverageInput, type EngagementReportInput } from "./html/render.js";
import { buildFindingMeta, stripFindingsJson } from "./html/wire.js";
import { emitDeliverables, emitFindingsSheet } from "./finding-refs.js";
import { buildReportModel, finalizeDeliverables, restampRecordedSignoff, type DeliverablesOutcome, type ReportModel } from "./deliverables.js";

/** The report-phase marker where runner-computed sections begin in report.md; everything before it is the narrative the phase handed the HTML renderer. */
const NARRATIVE_CUT = "\n\n---\n\n## Battery coverage (runner-computed)";

/** The recorded report model, when report.json survived the close. A file that is missing, unparseable, or not a report model is no model at all — the caller falls back to the state record or fails typed. */
function loadRecordedModel(dir: string): ReportModel | null {
  const path = join(dir, "report.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ReportModel;
    if (parsed?.kind !== "secscan-redteam-report" || !Array.isArray(parsed.findings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Battery totals from the recorded item ledger (item-verdicts.json),
 * when the phase wrote one; an absent ledger is an empty record. */
function ledgerTotals(dir: string): ReportModel["batteryTotals"] {
  const empty = { total: 0, confirmed: 0, executedClean: 0, killed: 0, blocked: 0, na: 0, pending: 0 };
  const path = join(dir, "item-verdicts.json");
  if (!existsSync(path)) return empty;
  try {
    const entries = JSON.parse(readFileSync(path, "utf8")) as ItemVerdict[];
    if (!Array.isArray(entries)) return empty;
    const s = ledgerSummary(new Map(entries.map((v) => [v.key, v])));
    return {
      total: s.total, confirmed: s.confirmed, executedClean: s.executedClean,
      killed: s.killed, blocked: s.blocked, na: s.na, pending: s.pending,
    };
  } catch {
    return empty;
  }
}

/** Rebuild the report model from the state record when report.json is gone. Only the ends whose record is fully reconstructable qualify — a completed run, a blocked run carrying its reason, or a dead end (deadReason given): a non-terminal record the caller proved has no live run behind it, rebuilt as a halted model so buildReportModel issues it no grade, exactly like a recorded halt. Anything else is a typed failure, never a fabricated model. */
function fallbackModel(ctx: Ctx, state: LiveState, dir: string, deadReason?: string): ReportModel {
  if (state.status !== "complete" && state.status !== "blocked") {
    if (deadReason) return buildReportModel(ctx, { findings: state.findings, totals: ledgerTotals(dir), cells: [], haltedReason: deadReason });
    throw new Error(
      `cannot regenerate: no recorded report model and the ${state.status} end state cannot be reconstructed faithfully`,
    );
  }
  if (state.status === "blocked" && !state.blockedReason) {
    throw new Error("cannot regenerate: blocked engagement record carries no block reason");
  }
  return buildReportModel(ctx, {
    findings: state.findings,
    totals: ledgerTotals(dir),
    cells: [],
    ...(state.blockedReason ? { blockedReason: state.blockedReason } : {}),
  });
}

/** The PoC bundles the run wrote to poc/*.json, keyed by finding id —
 * the same files the package zip ships, read back verbatim. */
function loadBundles(dir: string): Map<string, PocBundle> {
  const out = new Map<string, PocBundle>();
  const pocDir = join(dir, "poc");
  if (!existsSync(pocDir)) return out;
  for (const name of readdirSync(pocDir).filter((n) => n.endsWith(".json")).sort()) {
    try {
      const bundle = JSON.parse(readFileSync(join(pocDir, name), "utf8")) as PocBundle;
      if (typeof bundle?.findingId === "string") out.set(bundle.findingId, bundle);
    } catch {
      // A corrupt bundle file is skipped, never fabricated around.
    }
  }
  return out;
}

/** The narrative as the phase handed it to the renderer: report.md up
 * to the first runner-computed section. */
function recordedNarrative(dir: string): string {
  const path = join(dir, "report.md");
  if (!existsSync(path)) return "";
  const md = readFileSync(path, "utf8");
  const cut = md.indexOf(NARRATIVE_CUT);
  return cut >= 0 ? md.slice(0, cut) : md;
}

/** The probe total the phase printed into report.md's battery line —
 * recorded data, read back; 0 when the line is absent. */
function recordedProbes(dir: string): number {
  const path = join(dir, "report.md");
  if (!existsSync(path)) return 0;
  const m = readFileSync(path, "utf8").match(/(\d+) probes total/);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

/** The activity projection, from the same audit-log projections the
 * phase's wire assembly uses. */
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

function assembleInput(
  state: LiveState,
  model: ReportModel,
  dir: string,
  bundles: Map<string, PocBundle>,
): EngagementReportInput {
  const findings: Finding[] = model.findings;
  const counts: NonNullable<ReportMeta["findings"]> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const sev = String(f.severity ?? "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, sev)) counts[sev as keyof typeof counts]++;
  }
  const fullBattery = model.coverageCells.length > 0;
  const cells: CoverageInput["cells"] = fullBattery
    ? model.coverageCells.flatMap((c) => {
        const category = BATTERY_CATEGORIES.find((b) => b === c.category);
        if (!category) return [];
        const cellState = c.state === "done" || c.state === "blocked" ? c.state : "missing";
        return [{ target: c.target, category: category as BatteryCategory, state: cellState as "done" | "blocked" | "missing" }];
      })
    : BATTERY_CATEGORIES.map((c) => ({
        target: "scoped run",
        category: c,
        state: state.batteryCoverage?.[c] ? ("done" as const) : ("missing" as const),
      }));
  const coverage: CoverageInput = {
    fullBattery,
    cells,
    totals: model.batteryTotals,
    probesUsed: recordedProbes(dir),
    planOnly: [],
    notCovered: fullBattery
      ? cells.filter((c) => c.state === "missing").map((c) => `${c.target}:${c.category}`)
      : BATTERY_CATEGORIES.filter((c) => !state.batteryCoverage?.[c]),
  };
  const meta: ReportMeta = {
    engagementId: state.engagementId,
    target: state.target,
    mode: state.mode,
    environment: "staging",
    tier: 1,
    operator: resolveOperatorName(undefined),
    status: state.status,
    phase: state.phase,
    verified: state.verified,
    objective: state.objective,
    startedAt: state.startedAt,
    generatedAt: new Date().toISOString(),
    findings: counts,
    battery: model.batteryTotals,
  };
  return {
    meta,
    title: "Penetration Test Report",
    narrativeMd: stripFindingsJson(recordedNarrative(dir)),
    posture: gradeFindings(findings),
    banner: gradeBanner(findings),
    findings,
    bundles,
    noBundleReasons: new Map(),
    negativeProof: [],
    findingMeta: buildFindingMeta(bundles, findings),
    inventory: readHostInventory(dir),
    coverage,
    activity: buildActivity(readEvents(dir, 0, 100000)),
    ...(model.status === "halted" ? { haltedReason: model.reason } : {}),
    ...(model.status === "blocked" ? { blockedReason: model.reason } : {}),
    dryRun: model.dryRun,
  };
}

/**
 * Re-fire report generation for a recorded engagement end: reassemble
 * the HTML from the recorded state, re-emit the findings sheet and the
 * closing deliverables, then verify + stamp via `finalizeDeliverables`.
 * The returned outcome is the verification — `ok` only when the whole
 * seven-file set is on disk afterwards.
 *
 * @param dir - The engagement directory (must carry state.json).
 * @param opts - deadEnd: the caller proved a non-terminal record has no
 *   live run behind it; it regenerates as a halted end (no grade).
 * @returns The deliverable verification outcome.
 */
export function regenerateReport(dir: string, opts: { deadEnd?: boolean } = {}): DeliverablesOutcome {
  const state = readState(dir);
  if (!state) throw new Error(`cannot regenerate: no recorded state in ${dir}`);
  const events = EventLog.open(dir);
  const recorded = loadRecordedModel(dir);
  // Dead-end honesty: a surviving recorded model that claims a completed
  // (or dry-run) end is re-stamped halted with no grade — the run did not
  // complete, and its deliverables must not present as if it had. The
  // haltedReason then flows into every format exactly as a recorded halt.
  const deadReason =
    opts.deadEnd && state.status !== "complete" && state.status !== "halted" && state.status !== "blocked"
      ? `the run ended without a recorded close (recorded status: ${state.status}); no live run remains`
      : undefined;
  // The report emitters read exactly three slices of the context — `events`, `input.{target,mode,objective}` (model header, CSV rows) and `config.dryRunAgents` (model status) — so the recorded context supplies exactly those, plus the persisted attested scope (`verifiedScope`, S3-H6) so this reconstructed Ctx carries the record's scope stamp exactly as the live Ctx did.
  const ctx = {
    events,
    verifiedScope: state.verifiedScope,
    input: { target: state.target, mode: state.mode, objective: state.objective },
    config: { dryRunAgents: recorded?.dryRun ?? false },
  } as unknown as Ctx;
  const model = recorded && deadReason && recorded.status !== "halted" && recorded.status !== "blocked"
    ? { ...recorded, status: "halted" as const, reason: deadReason, grade: null }
    : (recorded ?? fallbackModel(ctx, state, dir, deadReason));
  const findings = model.findings;
  const bundles = loadBundles(dir);
  let reportInput: EngagementReportInput | undefined;
  try {
    reportInput = assembleInput(state, model, dir, bundles);
    // Render before touching the file. A render failure used to leave the previous
    // HTML in place, where verifyDeliverables certified it as the current set —
    // a stale document shipping under a "complete" close.
    const html = renderEngagementReportHtml(reportInput);
    writeFileSync(join(dir, "report.html"), html);
    events.append({
      phase: "report",
      actor: "runner",
      action: "report_html_written",
      result: "HTML report regenerated from the recorded engagement state.",
    });
  } catch (err) {
    // A failed regeneration must not leave the previous HTML behind: delete it so
    // the closing set cannot certify an artifact that disagrees with report.md.
    rmSync(join(dir, "report.html"), { force: true });
    events.append({
      phase: "report",
      actor: "runner",
      action: "report_html_failed",
      result: `HTML report regeneration failed: ${(err as Error).message}`,
    });
  }
  emitFindingsSheet(ctx, findings, bundles);
  // A dead run died before the report phase, so report.md — normally the narrative source regeneration reads back — does not exist. Only for that case, render it from the assembled document (the same document every other format renders from), with annexes limited to what the record carries; a surviving report.md is never rewritten.
  const mdSource = deadReason && reportInput && !existsSync(join(dir, "report.md"))
    ? { legacyMd: "", findings, bundles, annexes: { batteryLine: `Battery coverage (runner-computed): the run ended before the report phase (${deadReason}); the coverage above is the recorded ledger only.`, proofMd: "", integrationsMd: "" } }
    : undefined;
  emitDeliverables(ctx, reportInput, {
    findings,
    totals: model.batteryTotals,
    cells: model.coverageCells.map((c) => ({ t: c.target, c: c.category, s: c.state })),
    ...(model.status === "halted" ? { haltedReason: model.reason ?? "engagement halted" } : {}),
    ...(model.status === "blocked" ? { blockedReason: model.reason } : {}),
  }, mdSource);
  const outcome = finalizeDeliverables(ctx);
  // S6-H2c: the fresh model emitDeliverables just wrote carries no Scribe stamp — carry the stamp recorded in state forward into report.json + the package zip, so the regenerated set agrees with state.json.
  restampRecordedSignoff(ctx, state);
  return outcome;
}
