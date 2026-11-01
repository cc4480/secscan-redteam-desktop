/**
 * findings.csv — the machine-readable findings sheet of the deliverable
 * package (Q-RP-1). Generated from the same report model the HTML renders
 * from (final findings + FindingMeta + PoC bundles), so the CSV reconciles
 * with report.html exactly: one row per finding, in report order, with
 * the same severity, CVSS, and CWE the finding cards show. A finding whose
 * record carries no CVSS/CWE gets an honestly empty cell — nothing is
 * derived from severity or estimated.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Ctx } from "../context.js";
import { type Finding } from "../types.js";
import { type PocBundle } from "../proof/index.js";
import { tierOf, type FindingMeta } from "./html/cards.js";
import { buildFindingMeta } from "./html/wire.js";

export const FINDINGS_CSV_COLUMNS = [
  "id",
  "title",
  "severity",
  "cvss",
  "cwe",
  "target",
  "status",
  "proof_state",
  "remediation_summary",
] as const;

export interface FindingsCsvInput {
  findings: readonly Finding[];
  findingMeta: ReadonlyMap<string, FindingMeta>;
  bundles: ReadonlyMap<string, PocBundle>;
  /** The engagement target (host or URL) every row belongs to. */
  target: string;
}

/** RFC 4180 field escaping: quote when the value carries a comma, a
 * quote, or a line break; embedded quotes double. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The remediation text as a one-line summary cell: whitespace runs
 * collapse; the words themselves stay the recorded fix verbatim. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The full sheet: header + one row per finding, CRLF line endings. */
export function buildFindingsCsv(input: FindingsCsvInput): string {
  const rows: string[] = [FINDINGS_CSV_COLUMNS.join(",")];
  for (const f of input.findings) {
    const meta = input.findingMeta.get(f.id);
    rows.push(
      [
        f.id,
        f.title,
        f.severity,
        typeof meta?.cvss === "number" ? meta.cvss.toFixed(1) : "",
        meta?.cwe ?? "",
        input.target,
        f.status,
        tierOf(f, input.bundles.get(f.id)),
        oneLine(f.fix),
      ]
        .map(csvField)
        .join(","),
    );
  }
  return rows.join("\r\n") + "\r\n";
}

/** Write findings.csv beside report.md/report.html. Its own failure
 * domain, mirroring the HTML twin: a CSV problem is recorded as an event,
 * never a lost report. */
export function emitFindingsCsv(ctx: Ctx, findings: Finding[], bundles: ReadonlyMap<string, PocBundle>): void {
  try {
    const csv = buildFindingsCsv({
      findings,
      findingMeta: buildFindingMeta(bundles, findings),
      bundles,
      target: ctx.input.target,
    });
    writeFileSync(join(ctx.events.dir, "findings.csv"), csv);
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_csv_written",
      result: `findings.csv written (${findings.length} finding rows).`,
    });
  } catch (err) {
    ctx.events.append({
      phase: "report",
      actor: "runner",
      action: "report_csv_failed",
      result: `findings.csv generation failed (report unaffected): ${(err as Error).message}`,
    });
  }
}
