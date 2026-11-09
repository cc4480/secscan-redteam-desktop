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
import { type PostureBanner, type PostureFinding, type SecurityPosture } from "./posture.js";
import type { Finding } from "../types.js";
/** Map one runner Finding onto the posture-score input: its severity
 * (an unrecognized severity grades as info) and its title, which the
 * posture banner reads into its label. */
export declare function runnerFindingToPostureFinding(f: Finding): PostureFinding;
/** Grade the engagement's CONFIRMED findings (killed/deferred are not
 * graded — they are not findings). */
export declare function gradeFindings(findings: Finding[]): SecurityPosture;
/** The posture banner over the confirmed findings — the same banner
 * buildGradeSection renders into report.md, exposed for the HTML cover. */
export declare function gradeBanner(findings: Finding[]): PostureBanner | null;
/** The report.md section: deterministic, computed by the runner (never
 * the reporter agent), graded under the SecScan name. */
export declare function buildGradeSection(findings: Finding[]): string;
