/**
 * Section renderers for report.md (report/markdown.ts): the detail
 * derivations (breakdown / what-changed / risk areas / impact), the
 * tool-activity table, and the host-inventory summary. Each renders
 * the shared document's data with the same words the HTML flagship
 * uses — no format invents its own phrasing for a recorded fact.
 */
import { type DiffEntry, type ReportDetail } from "./detail.js";
import { type ReportDocument } from "./document.js";

function diffEntriesMd(entries: DiffEntry[], mark: string): string {
  return entries
    .map((e) => `- ${mark} [${e.severity}] ${e.title}${e.note ? ` — ${e.note}` : ""}`)
    .join("\n");
}

function whatChangedMd(d: ReportDetail, target: string): string {
  const head = "### What Changed";
  if (!d.diff || !d.baselineLabel) {
    return (
      `${head}\n\nFirst recorded scan of this target by this engine — ` +
      `there is no earlier scan to diff against. This report is the baseline: ` +
      `the next scan of ${target} will be diffed against it.`
    );
  }
  const diff = d.diff;
  const parts = [
    head,
    "",
    `Since ${d.baselineLabel}`,
    "",
    `${diff.newFindings.length} new · ${diff.resolved.length} resolved · ${diff.worsened.length} worsened` +
      (diff.improved.length > 0 ? ` · ${diff.improved.length} improved` : ""),
    `Δ findings ${diff.findingsDelta > 0 ? `+${diff.findingsDelta}` : diff.findingsDelta}` +
      (d.countsOnly
        ? " (the baseline engagement predates recorded scores — score delta omitted)"
        : ` · Δ score ${diff.scoreDelta !== undefined ? (diff.scoreDelta > 0 ? `+${diff.scoreDelta}` : diff.scoreDelta) : "—"}`),
  ];
  if (diff.newFindings.length) parts.push("", "#### New", "", diffEntriesMd(diff.newFindings, "+"));
  if (diff.resolved.length) parts.push("", "#### Resolved", "", diffEntriesMd(diff.resolved, "−"));
  if (diff.worsened.length) parts.push("", "#### Worsened", "", diffEntriesMd(diff.worsened, "▲"));
  if (diff.improved.length) parts.push("", "#### Improved", "", diffEntriesMd(diff.improved, "▼"));
  return parts.join("\n");
}

/** The detail block that rides inside the executive-summary segment. */
export function detailMd(doc: ReportDocument): string {
  const d = doc.detail;
  if (!d) return "";
  const parts: string[] = [];
  if (d.breakdown.length > 0) {
    parts.push(`### Detailed Executive Breakdown\n\n${d.breakdown.join("\n\n")}`);
  }
  parts.push(whatChangedMd(d, doc.meta.target));
  if (d.actionableCount > 0 && d.riskAreas.length > 0) {
    const areas = d.riskAreas
      .map(
        (a) =>
          `#### ${a.name}\n\n${a.findings.length} finding${a.findings.length === 1 ? "" : "s"} · worst ${a.worst}\n\n` +
          a.findings.map((f) => `- [${f.severity}] ${f.title} (${f.id})`).join("\n"),
      )
      .join("\n\n");
    const deferred =
      d.deferredCount > 0
        ? `\n\n${d.deferredCount} deferred item${d.deferredCount === 1 ? "" : "s"} await verification — listed under Findings.`
        : "";
    parts.push(`### Key Risk Areas\n\n${areas}${deferred}`);
  }
  parts.push(`### Business Impact\n\n${d.impact.text}`);
  return parts.join("\n\n");
}

/** The tool-activity section, in the exact strings the runner-computed
 * MD section (report/activity.ts) has always used — now projected from
 * the document's activity input instead of a second event pass. */
export function activityMd(doc: ReportDocument): string {
  const a = doc.activity;
  if (a.eventCount === 0) return "";
  const lines = [
    "## Tool activity (runner-computed, derived from events.jsonl)",
    "",
    `**${a.eventCount} events** across **${a.totalActions} distinct actions**.`,
    "",
    "| Action | Count | ATT&CK | First seq | Last seq |",
    "|---|---|---|---|---|",
    ...a.rows.map((r) => `| ${r.action} | ${r.count} | ${r.attackIds.join(", ") || "—"} | ${r.firstSeq} | ${r.lastSeq} |`),
  ];
  if (a.totalActions > a.rows.length) {
    lines.push(`| … ${a.totalActions - a.rows.length} more actions (see events.jsonl) | | | | |`);
  }
  lines.push(
    "",
    `**Operator decisions recorded:** ${a.decisions.length}` +
      (a.decisions.length > 0 ? ` — ${a.decisions.map((d) => `${d.action} (seq ${d.seq})`).join(", ")}` : " (none)"),
    "",
    a.danglingCauses.length === 0
      ? "**Causality integrity:** every `causedBy` link resolves."
      : `**Causality integrity:** ${a.danglingCauses.length} dangling cause reference(s): seq ${a.danglingCauses.join(", ")}.`,
  );
  return lines.join("\n");
}

/** The host-inventory summary: the recorded collection facts and
 * section counts; the full inventory renders in report.html. A failed
 * collection states its absence exactly as the flagship does. */
export function inventoryMd(doc: ReportDocument): string {
  const inv = doc.inventory;
  if (!inv) return "";
  if (inv.status === "failed") {
    const where = inv.hostname ? ` for ${inv.hostname}` : "";
    return (
      `## Host & Security Posture Inventory\n\nLocal inventory collection${where} did not complete: ${inv.error} ` +
      `No inventory is shown for this engagement — the absence is the record, not a clean result.`
    );
  }
  const h = inv.inventory;
  const counts: string[] = [];
  const add = (label: string, rows?: readonly unknown[]) => {
    if (rows && rows.length > 0) counts.push(`${label}: ${rows.length}`);
  };
  add("system rows", h.system);
  add("volumes", h.volumes);
  add("accounts", h.accounts);
  add("patches", h.patches);
  add("processes", h.processes);
  add("software", h.software);
  return (
    `## Host & Security Posture Inventory\n\nCollected from ${h.hostname} at ${h.collectedAt} by ${h.collector}` +
    `${h.patchLevel ? ` · patch level ${h.patchLevel}` : ""}.\n\n${counts.join(" · ")}\n\n_The full inventory renders in report.html._`
  );
}
