/**
 * Engagement grading seam — the embedded Seclayer scoring engine is
 * the runner's one grading voice (spec rule 4, reaffirmed 2026-10-28).
 *
 * Before this seam the report path computed NO deterministic grade at
 * all: report/phase.ts assembled the reporter agent's narrative, the
 * findings JSON, and runner-computed coverage/proof/reconciliation
 * sections, but the only scores anywhere in the runner were the
 * embedded engines' own (SecScan's additive computeGrade, which stays
 * unsurfaced per the step-1 decision, and the TLS letter SecScan
 * reports for a scanned site). This module supplements that path —
 * it replaces nothing — by grading the engagement's final confirmed
 * findings with Seclayer's anchored posture math:
 *
 *   - a CONFIRMED finding deducts its full severity weight
 *     (critical 35 / high 25 / medium 15 / low 5 / info 0);
 *   - heuristic findings (confidence medium/low) are damped
 *     (×0.5 / ×0.25), their aggregate capped at 40, and can never pull
 *     the score below 60 on their own;
 *   - the grade is anchored to the worst CONFIRMED severity: one
 *     confirmed critical caps the score at 20 (grade F), one
 *     confirmed high at 45 — count alone cannot produce an F;
 *   - the score floors at 10.
 *
 * Mapping honesty: a runner Finding reaches this seam only through
 * the platform's own confirmation discipline (live findings are
 * recorded after the two-observation / challenger path; killed and
 * deferred findings are excluded here), so `confidence` is left
 * UNSET on the mapped finding — the engine's standing rule treats a
 * finding with no confidence field as confirmed, which is exactly the
 * runner's semantics. The runner's receipts, however, are proof
 * bundles, not Seclayer ExploitEvidence objects, so `evidence` is
 * left unset too: no finding is promoted to the engine's PROVEN tier
 * (which would require its anchored evidence bundle verbatim).
 */
import { deriveSecurityPosture, bannerForPosture, type SecurityPosture } from "#seclayer/server/scoring.js";
import type { Finding as SeclayerFinding, Severity } from "#seclayer/src/types.js";
import type { Finding } from "../types.js";

const SEVERITIES: ReadonlySet<string> = new Set(["critical", "high", "medium", "low", "info"]);

/** Map one runner Finding onto the Seclayer scoring input, verbatim on
 * severity/title/fix; the finding's evidence text is the description
 * (the engine reads a one-line summary of it into its posture label). */
export function runnerFindingToSeclayerFinding(f: Finding): SeclayerFinding {
  const severity = (SEVERITIES.has(f.severity) ? f.severity : "info") as Severity;
  return {
    id: f.id,
    title: f.title,
    description: f.evidence,
    severity,
    fix: f.fix,
    category: "Engagement finding",
    // confidence and evidence deliberately unset — see the header.
  };
}

/** Grade the engagement's CONFIRMED findings (killed/deferred are not
 * graded — they are not findings). */
export function gradeFindings(findings: Finding[]): SecurityPosture {
  const confirmed = findings.filter((f) => f.status === "confirmed");
  return deriveSecurityPosture(confirmed.map(runnerFindingToSeclayerFinding));
}

/** The report.md section: deterministic, computed by the runner (never
 * the reporter agent), graded under the SecScan name by the Seclayer
 * engine. */
export function buildGradeSection(findings: Finding[]): string {
  const confirmed = findings.filter((f) => f.status === "confirmed");
  const mapped = confirmed.map(runnerFindingToSeclayerFinding);
  const posture = deriveSecurityPosture(mapped);
  const banner = bannerForPosture(mapped);
  const bannerText = banner ? ` ${banner.title} — ${banner.message}` : "";
  const bySev = posture.findingsBySeverity;
  const lines = [
    "## Security grade — SecScan (anchored scoring)",
    "",
    `**Grade ${posture.grade} — ${posture.score}/100** (${posture.postureRating}).${bannerText}`,
    "",
    `Graded on ${posture.activeCount} confirmed finding(s): ${bySev.critical} critical, ${bySev.high} high, ${bySev.medium} medium, ${bySev.low} low, ${bySev.info} info. ` +
      `Confirmed findings deduct their full severity weight; the grade is anchored to the worst confirmed severity, so one confirmed critical caps the score at 20. ` +
      `Killed and deferred hypotheses are not graded.`,
    "",
  ];
  return lines.join("\n");
}
