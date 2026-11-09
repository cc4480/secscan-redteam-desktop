/**
 * Engagement grading seam — the report's one deterministic grade,
 * computed by the runner's local posture scoring (report/posture.ts).
 *
 * Before this seam the report path computed NO deterministic grade at
 * all: report/phase.ts assembled the reporter agent's narrative, the
 * findings JSON, and runner-computed coverage/proof/reconciliation
 * sections, but the only scores anywhere in the runner were the
 * embedded engines' own. This module grades the engagement's final
 * confirmed findings with the local severity-weighted score:
 *
 *   - a CONFIRMED finding deducts its full severity weight
 *     (critical 35 / high 25 / medium 15 / low 5 / info 0);
 *   - the grade is anchored to the worst CONFIRMED severity: one
 *     confirmed critical caps the score at 20 (grade F), one
 *     confirmed high at 45 — count alone cannot produce an F;
 *   - the score floors at 10.
 *
 * (Until 2026-11-08 the derivation ran in the vendored Seclayer
 * scoring engine; that unit was extracted from the tree and
 * report/posture.ts carries the same anchored math locally.)
 *
 * Mapping honesty: a runner Finding reaches this seam only through
 * the platform's own confirmation discipline (live findings are
 * recorded after the two-observation / challenger path; killed and
 * deferred findings are excluded here), so the mapped finding needs
 * no confidence field — everything the posture score reads is a
 * confirmed finding by construction.
 */
import { deriveSecurityPosture, bannerForPosture } from "./posture.js";
const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
/** Map one runner Finding onto the posture-score input: its severity
 * (an unrecognized severity grades as info) and its title, which the
 * posture banner reads into its label. */
export function runnerFindingToPostureFinding(f) {
    const severity = (SEVERITIES.has(f.severity) ? f.severity : "info");
    return { severity, title: f.title };
}
/** Grade the engagement's CONFIRMED findings (killed/deferred are not
 * graded — they are not findings). */
export function gradeFindings(findings) {
    const confirmed = findings.filter((f) => f.status === "confirmed");
    return deriveSecurityPosture(confirmed.map(runnerFindingToPostureFinding));
}
/** The posture banner over the confirmed findings — the same banner
 * buildGradeSection renders into report.md, exposed for the HTML cover. */
export function gradeBanner(findings) {
    const confirmed = findings.filter((f) => f.status === "confirmed");
    return bannerForPosture(confirmed.map(runnerFindingToPostureFinding));
}
/** The report.md section: deterministic, computed by the runner (never
 * the reporter agent), graded under the SecScan name. */
export function buildGradeSection(findings) {
    const confirmed = findings.filter((f) => f.status === "confirmed");
    const mapped = confirmed.map(runnerFindingToPostureFinding);
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
//# sourceMappingURL=grading.js.map