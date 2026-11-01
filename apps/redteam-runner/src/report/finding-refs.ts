/**
 * Report-phase hooks extracted from report/phase.ts so the orchestrator
 * stays inside the 300-line file budget. Each hook is one call into the
 * module that owns the behavior (html/wire.ts for the refs stamp,
 * csv.ts for the findings sheet, docx.ts + package.ts for the closing
 * deliverables); this file only gives phase.ts its call sites.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Ctx, type LiveFinding } from "../context.js";
import { type Finding } from "../types.js";
import { type PocBundle } from "../proof/index.js";
import { type EngagementReportInput } from "./html/render.js";
import { applyFindingRefs } from "./html/wire.js";
import { emitFindingsCsv } from "./csv.js";
import { writeDocxArtifact } from "./docx.js";
import { emitReportPackage } from "./package.js";
import { buildReportModel, emitReportModel, type ReportModelArgs } from "./deliverables.js";

/** Q-RP-3: engine-recorded CVSS/CWE join the final findings mechanically
 * (corroborated live-finding match; unproven values are removed). */
export function stampFindingRefs(findings: Finding[], liveFindings: readonly LiveFinding[]): void {
  applyFindingRefs(findings, liveFindings);
}

/** Q-RP-1: the findings sheet of the deliverable package, from the same
 * model the HTML renders (own try/catch inside — never breaks the report). */
export function emitFindingsSheet(
  ctx: Ctx,
  findings: Finding[],
  bundles: ReadonlyMap<string, PocBundle>,
): void {
  emitFindingsCsv(ctx, findings, bundles);
}

/** Q-DELIVERABLES-AUTOFIRE (G7): report.md's write, guarded into the
 * deliverable failure domain. It used to be the one unguarded write in
 * the phase: a failure escaped reportPhase and was misrecorded as a
 * halt. Now it is an event (`report_md_failed`), the remaining
 * deliverables still emit from the in-memory model, and the close-out
 * verification records the gap as deliverable_failed. */
export function writeReportMd(ctx: Ctx, reportMd: string): void {
  try {
    writeFileSync(join(ctx.events.dir, "report.md"), reportMd);
  } catch (err) {
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_md_failed",
      result: `report.md write failed (remaining deliverables unaffected): ${(err as Error).message}`,
    });
  }
}

/** Q-RP-2 + Q-RP-5 + Q-DELIVERABLES-AUTOFIRE: the closing deliverables,
 * in order — the DOCX copy from the same assembled input as the HTML
 * (own try/catch inside), the report model twins (report.json +
 * report.txt, built from the phase's final records so they emit even
 * when the HTML input assembly failed), then the package zip over the
 * artifacts on disk. The package reads the emitted files back, so it
 * runs even when a writer failed; it then fails loudly on the missing
 * deliverable (report_package_failed) instead of shipping a partial
 * set. */
export function emitDeliverables(
  ctx: Ctx,
  reportInput: EngagementReportInput | undefined,
  modelArgs: ReportModelArgs,
): void {
  if (reportInput) writeDocxArtifact(ctx, reportInput);
  emitReportModel(ctx, buildReportModel(ctx, modelArgs));
  emitReportPackage(ctx);
}
