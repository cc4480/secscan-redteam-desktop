/**
 * report.txt — the plain-text rendering of the report model + the ONE
 * shared report document (report/document.ts). A clean plain rendering
 * a client can read without a browser: brand header, engagement meta,
 * the grade (or the honest N/A), severity + tier counts, the battery
 * line, every finding grouped by truth tier in report order with its
 * evidence and fix, the consolidated fix prompt, and the audit footer
 * line. When no document was built (the HTML input assembly failed),
 * the findings print in the recorded array order, as they always have.
 */
import { type Finding } from "../types.js";
import { type ReportDocument } from "./document.js";
import { type DeliverableEndStatus, type ReportModel } from "./deliverables.js";
import { TIER_LABEL } from "./html/tokens.js";

const STATUS_LINE: Record<DeliverableEndStatus, string> = {
  complete: "Complete",
  halted: "HALTED",
  blocked: "BLOCKED",
  "dry-run": "DRY RUN — no live testing ran; this is not a client report",
};

export function renderReportTxt(model: ReportModel, doc?: ReportDocument): string {
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
  ];
  if (doc) {
    const tc = doc.tierCounts;
    lines.push(
      `Tiers: ${tc.proven} proven · ${tc.confirmed} confirmed · ${tc.deferred} deferred · ${tc["ruled-out"]} ruled out`,
    );
  }
  lines.push(
    `Battery: ${model.batteryTotals.total} items — ${model.batteryTotals.confirmed} confirmed · ${model.batteryTotals.executedClean} executed-clean · ${model.batteryTotals.killed} killed · ${model.batteryTotals.blocked} blocked · ${model.batteryTotals.na} not-applicable · ${model.batteryTotals.pending} pending`,
    "",
    "Findings",
    "--------",
  );
  const renderFinding = (f: Finding): void => {
    lines.push(`[${f.severity.toUpperCase()}] ${f.id} — ${f.title} (status: ${f.status})`);
    if (f.evidence) lines.push(`  Evidence: ${f.evidence.replace(/\s+/g, " ").trim()}`);
    if (f.fix) lines.push(`  Fix: ${f.fix.replace(/\s+/g, " ").trim()}`);
  };
  if (model.findings.length === 0) lines.push("(no findings recorded)");
  if (doc) {
    for (const g of doc.tierGroups) {
      lines.push("", `${TIER_LABEL[g.tier]} — ${g.findings.length + g.negativeProof.length}`, "");
      for (const f of g.findings) renderFinding(f);
      for (const n of g.negativeProof) {
        lines.push(`${n.hypothesis} (ruled out)`);
        lines.push(`  Decisive observation: ${n.killingObservation.replace(/\s+/g, " ").trim()}`);
      }
    }
  } else {
    for (const f of model.findings) renderFinding(f);
  }
  if (doc && doc.fixPrompt) {
    lines.push("", "Complete Fix Prompt", "-------------------", "", doc.fixPrompt);
  }
  if (doc) {
    lines.push(
      "",
      `Generated ${model.generatedAt} by SecScan RedTeam from the engagement audit log. ` +
        "The machine-readable records (report.json, report.md, events.jsonl) are the authoritative source for every figure above.",
    );
  }
  lines.push("");
  return lines.join("\n");
}
