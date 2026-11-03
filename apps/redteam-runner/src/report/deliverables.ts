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
 *
 * report.json schema (kind "secscan-redteam-report", version 1) — the
 * stable machine-readable twin of the report document
 * (report/document.ts). Fields: engagementId, target, mode, objective,
 * status ("complete" | "halted" | "blocked" | "dry-run"), reason (only
 * for halted/blocked ends), dryRun, generatedAt, grade ({letter,
 * score, rating} — null for halted/blocked), severityCounts (the
 * grading seam's posture counts over confirmed findings — the same
 * counts every format prints), findingCount (all recorded findings),
 * batteryTotals, coverageCells, findings (the recorded Finding
 * objects). When the report document was built, three more fields
 * ride along: tierCounts (truth-tier counts, ruled-out including
 * de-duplicated negative proofs), sections (the canonical section ids
 * the record carries, report/document.ts REPORT_SECTION_ORDER), and
 * fixPrompt (the consolidated fix prompt text, "" when nothing is
 * actionable). Two further fields are stamped into report.json after
 * emission by the Scribe gate (report/scribe.ts): artifactSignoff (the
 * publisher seat's signature) or artifactUnsigned (why the set shipped
 * unsigned) — exactly one of them on a completed close.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Ctx } from "../context.js";
import { type ArtifactSignoff, type ArtifactUnsigned } from "../events.js";
import { type Finding } from "../types.js";
import { gradeFindings } from "./grading.js";
import { emitReportPackage, REPORT_PACKAGE_NAME } from "./package.js";
import { type ReportDocument } from "./document.js";
import { renderReportTxt } from "./text.js";

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
  /** Truth-tier counts from the report document, when it was built. */
  tierCounts?: { proven: number; confirmed: number; deferred: number; "ruled-out": number };
  /** Canonical section ids the record carries, when the document was built. */
  sections?: string[];
  /** The consolidated fix prompt, when the document was built. */
  fixPrompt?: string;
  /** SCRIBE GATE: the publisher seat's sign-off on this set, stamped
   * into report.json by report/scribe.ts after the model is emitted. */
  artifactSignoff?: ArtifactSignoff | null;
  /** SCRIBE GATE: why this set shipped unsigned, when it did. */
  artifactUnsigned?: ArtifactUnsigned | null;
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
 * format reconciles by construction. When the shared report document
 * was built, its canonical counts win: severityCounts are the
 * posture's counts over confirmed findings (the counts report.html,
 * report.md, and report.docx print), not a second all-findings count
 * that disagreed with the flagship whenever killed/deferred findings
 * existed. */
export function buildReportModel(ctx: Ctx, args: ReportModelArgs, doc?: ReportDocument): ReportModel {
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
    severityCounts: doc ? { ...doc.severityCounts } : severityCounts,
    ...(doc
      ? { tierCounts: { ...doc.tierCounts }, sections: [...doc.sections], fixPrompt: doc.fixPrompt }
      : {}),
    findingCount: args.findings.length,
    batteryTotals: args.totals,
    coverageCells: args.cells.map((cell) => ({ target: cell.t, category: cell.c, state: cell.s })),
    findings: args.findings,
  };
}

export function renderReportJson(model: ReportModel): string {
  return JSON.stringify(model, null, 2) + "\n";
}

/** The plain-text renderer lives in ./text.ts (it renders the model +
 * the shared report document); re-exported here for the module's
 * existing consumers. */
export { renderReportTxt } from "./text.js";

/** Write report.json + report.txt from the model. Each is its own
 * failure domain in the established emitter style: a failure is an
 * event, never a lost report — finalizeDeliverables is the backstop
 * that refuses a clean completion when a file is missing. */
export function emitReportModel(ctx: Ctx, model: ReportModel, doc?: ReportDocument): void {
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
    writeFileSync(join(dir, REPORT_TXT_NAME), renderReportTxt(model, doc));
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

/** S6-H2c: re-merge the Scribe stamp recorded in state into a regenerated report.json — the same merge scribe.ts's stampReportJson performs at close — and re-fire the package zip so the shipped copy carries it too. Regeneration rebuilds the model from scratch (buildReportModel carries no signoff fields), so without this a signed set regenerates unsigned in report.json while state.json still claims the stamp. No stamp recorded → nothing is added; an unreadable report.json is left alone (finalizeDeliverables has already named the gap). */
export function restampRecordedSignoff(ctx: Ctx, recorded: { artifactSignoff?: ArtifactSignoff | null; artifactUnsigned?: ArtifactUnsigned | null }): void {
  if (!recorded.artifactSignoff && !recorded.artifactUnsigned) return;
  try {
    const path = join(ctx.events.dir, REPORT_JSON_NAME);
    const model = JSON.parse(readFileSync(path, "utf8")) as ReportModel;
    model.artifactSignoff = recorded.artifactSignoff ?? null;
    model.artifactUnsigned = recorded.artifactUnsigned ?? null;
    writeFileSync(path, renderReportJson(model));
    emitReportPackage(ctx);
  } catch { /* the state record carries the stamp regardless */ }
}
