/**
 * Q-DELIVERABLES-AUTOFIRE — the closing deliverable set, fired by the
 * pipeline at every recorded engagement end (complete, halted, blocked,
 * dry-run), never by an agent's or operator's choice.
 *
 * This module owns the two formats that had no writer (report.json — the
 * report model, machine-readable; report.txt — the plain-language
 * summary), the on-disk verification of the whole set, and the
 * completion-record stamp: `finalizeDeliverables` verifies all seven
 * artifacts exist as files in the engagement directory, records
 * `deliverables_written` / `deliverable_failed`, and stamps the state
 * record (LiveState.deliverables / deliverableFailed) that the result
 * and every surface read. An engagement whose set is incomplete carries
 * deliverableFailed — it must never read as cleanly complete with the
 * HTML (or any sibling) missing.
 *
 * Grade convention, aligned with the HTML cover and the DOCX: a halted
 * or blocked engagement issues NO grade (null here, "N/A" on the page) —
 * a letter computed over a partial or empty record would be a fabricated
 * verdict. A dry run keeps its computed grade but is status-marked
 * "dry-run" in every document this module writes.
 */
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Ctx } from "../context.js";
import { type Finding } from "../types.js";
import { gradeFindings } from "./grading.js";
import { REPORT_PACKAGE_NAME } from "./package.js";

export const REPORT_JSON_NAME = "report.json";
export const REPORT_TXT_NAME = "report.txt";

/** The full deliverable set, in package order (the zip itself last). */
export const DELIVERABLE_FILES = [
  "report.html",
  "report.md",
  REPORT_JSON_NAME,
  REPORT_TXT_NAME,
  "findings.csv",
  "report.docx",
  REPORT_PACKAGE_NAME,
] as const;

export type DeliverableEndStatus = "complete" | "halted" | "blocked" | "dry-run";

export interface ReportModel {
  kind: "secscan-redteam-report";
  version: 1;
  engagementId: string;
  target: string;
  mode: string;
  objective: string;
  /** How the engagement ended; "dry-run" marks a no-live-agents run. */
  status: DeliverableEndStatus;
  /** The halt/block reason, when the end was not a completion. */
  reason?: string;
  dryRun: boolean;
  generatedAt: string;
  /** The anchored grade; null when the end was halted/blocked (N/A). */
  grade: { letter: string; score: number; rating: string } | null;
  severityCounts: { critical: number; high: number; medium: number; low: number; info: number };
  findingCount: number;
  batteryTotals: { total: number; confirmed: number; executedClean: number; killed: number; blocked: number; na: number; pending: number };
  coverageCells: { target: string; category: string; state: string }[];
  findings: Finding[];
}

export interface ReportModelArgs {
  findings: Finding[];
  totals: ReportModel["batteryTotals"];
  cells: readonly { t: string; c: string; s: string }[];
  haltedReason?: string;
  blockedReason?: string;
}

/** Assemble the report model from the phase's final records — the same
 * findings, posture, totals, and cells the HTML renders from, so every
 * format reconciles by construction. */
export function buildReportModel(ctx: Ctx, args: ReportModelArgs): ReportModel {
  const status: DeliverableEndStatus = args.blockedReason
    ? "blocked"
    : args.haltedReason
      ? "halted"
      : ctx.config.dryRunAgents
        ? "dry-run"
        : "complete";
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of args.findings) {
    const sev = String(f.severity ?? "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(severityCounts, sev)) {
      severityCounts[sev as keyof typeof severityCounts]++;
    }
  }
  const posture = status === "halted" || status === "blocked" ? null : gradeFindings(args.findings);
  return {
    kind: "secscan-redteam-report",
    version: 1,
    engagementId: ctx.events.engagementId,
    target: ctx.input.target,
    mode: ctx.input.mode,
    objective: ctx.input.objective,
    status,
    ...(args.blockedReason ?? args.haltedReason
      ? { reason: args.blockedReason ?? args.haltedReason }
      : {}),
    dryRun: ctx.config.dryRunAgents === true,
    generatedAt: new Date().toISOString(),
    grade: posture ? { letter: posture.grade, score: posture.score, rating: posture.postureRating } : null,
    severityCounts,
    findingCount: args.findings.length,
    batteryTotals: args.totals,
    coverageCells: args.cells.map((cell) => ({ target: cell.t, category: cell.c, state: cell.s })),
    findings: args.findings,
  };
}

export function renderReportJson(model: ReportModel): string {
  return JSON.stringify(model, null, 2) + "\n";
}

const STATUS_LINE: Record<DeliverableEndStatus, string> = {
  complete: "Complete",
  halted: "HALTED",
  blocked: "BLOCKED",
  "dry-run": "DRY RUN — no live testing ran; this is not a client report",
};

/** The plain-language summary: grade, counts, and every finding with its
 * severity and fix, in clean text a client can read without a browser. */
export function renderReportTxt(model: ReportModel): string {
  const sc = model.severityCounts;
  const lines: string[] = [
    "SecScan RedTeam — Penetration Test Report (plain-text summary)",
    "================================================================",
    `Target: ${model.target}`,
    `Engagement: ${model.engagementId}`,
    `Mode: ${model.mode}`,
    `Objective: ${model.objective}`,
    `Status: ${STATUS_LINE[model.status]}${model.reason ? ` — ${model.reason}` : ""}`,
    `Generated: ${model.generatedAt}`,
    "",
    model.grade
      ? `Grade: ${model.grade.letter} (${model.grade.score}/100 — ${model.grade.rating})`
      : `Grade: N/A — engagement ${model.status}; no grade is issued for an incomplete engagement`,
    "",
    `Findings: ${model.findingCount} — ${sc.critical} critical · ${sc.high} high · ${sc.medium} medium · ${sc.low} low · ${sc.info} info`,
    `Battery: ${model.batteryTotals.total} items — ${model.batteryTotals.confirmed} confirmed · ${model.batteryTotals.executedClean} executed-clean · ${model.batteryTotals.killed} killed · ${model.batteryTotals.blocked} blocked · ${model.batteryTotals.na} not-applicable · ${model.batteryTotals.pending} pending`,
    "",
    "Findings",
    "--------",
  ];
  if (model.findings.length === 0) lines.push("(no findings recorded)");
  for (const f of model.findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.id} — ${f.title} (status: ${f.status})`);
    if (f.evidence) lines.push(`  Evidence: ${f.evidence.replace(/\s+/g, " ").trim()}`);
    if (f.fix) lines.push(`  Fix: ${f.fix.replace(/\s+/g, " ").trim()}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Write report.json + report.txt from the model. Each is its own
 * failure domain in the established emitter style: a failure is an
 * event, never a lost report — finalizeDeliverables is the backstop
 * that refuses a clean completion when a file is missing. */
export function emitReportModel(ctx: Ctx, model: ReportModel): void {
  const dir = ctx.events.dir;
  try {
    writeFileSync(join(dir, REPORT_JSON_NAME), renderReportJson(model));
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_json_written",
      result: `${REPORT_JSON_NAME} written (${model.findingCount} findings, status ${model.status}).`,
    });
  } catch (err) {
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_json_failed",
      result: `report.json generation failed (report unaffected): ${(err as Error).message}`,
    });
  }
  try {
    writeFileSync(join(dir, REPORT_TXT_NAME), renderReportTxt(model));
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_txt_written",
      result: `${REPORT_TXT_NAME} written (plain-language summary).`,
    });
  } catch (err) {
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_txt_failed",
      result: `report.txt generation failed (report unaffected): ${(err as Error).message}`,
    });
  }
}

/** The chat surface's field names for the deliverable paths
 * (ui/engagement-tools.ts `engagement_report`): every present file under
 * its tool field name, plus a `deliverableGap` entry when the HTML is
 * missing — the gap is surfaced, never silently omitted (probe 7). */
export function deliverableToolFields(dir: string): Record<string, string> {
  const { paths, missing } = verifyDeliverables(dir);
  const fields: Record<string, string> = {};
  const named: [string, string][] = [
    ["report.html", "reportHtmlPath"],
    [REPORT_JSON_NAME, "reportJsonPath"],
    [REPORT_TXT_NAME, "reportTxtPath"],
    ["findings.csv", "findingsCsvPath"],
    ["report.docx", "reportDocxPath"],
    [REPORT_PACKAGE_NAME, "reportPackagePath"],
  ];
  for (const [file, field] of named) {
    if (paths[file]) fields[field] = paths[file];
  }
  if (!paths["report.html"]) {
    fields["deliverableGap"] =
      `report.html is missing from the engagement directory — the deliverable set is incomplete ` +
      `(missing: ${missing.join(", ")}); see the run's deliverable_failed record.`;
  }
  return fields;
}

export interface DeliverablesOutcome {
  ok: boolean;
  /** Absolute path per deliverable file present on disk. */
  paths: Record<string, string>;
  /** Deliverable file names missing (or not regular files) on disk. */
  missing: string[];
}

/** Verify the set on disk: every deliverable present as a regular file. */
export function verifyDeliverables(dir: string): DeliverablesOutcome {
  const paths: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of DELIVERABLE_FILES) {
    const path = join(dir, name);
    let isFile = false;
    try {
      isFile = statSync(path).isFile();
    } catch {
      isFile = false;
    }
    if (isFile) paths[name] = path;
    else missing.push(name);
  }
  return { ok: missing.length === 0, paths, missing };
}

/** The close-out stamp every recorded engagement end runs: verify the
 * deliverable set, record the outcome as an event, and stamp the state
 * record the result and surfaces read. */
export function finalizeDeliverables(ctx: Ctx): DeliverablesOutcome {
  const outcome = verifyDeliverables(ctx.events.dir);
  if (outcome.ok) {
    ctx.events.updateState({ deliverables: outcome.paths, deliverableFailed: false });
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "deliverables_written",
      result: `Deliverable set complete: ${DELIVERABLE_FILES.join(", ")}.`,
    });
  } else {
    ctx.events.updateState({ deliverables: outcome.paths, deliverableFailed: true });
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "deliverable_failed",
      result:
        `Deliverable set INCOMPLETE — missing: ${outcome.missing.join(", ")}. ` +
        `Present: ${Object.keys(outcome.paths).join(", ") || "none"}. ` +
        `The engagement must not be read as cleanly complete.`,
    });
  }
  return outcome;
}
