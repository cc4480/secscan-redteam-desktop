/**
 * Local posture scoring — the runner's own severity-weighted grade.
 *
 * Until 2026-11-08 the report grade came from the vendored Seclayer
 * scoring engine (src/seclayer/, a byte-frozen as-is copy). That unit
 * was extracted from the tree, and this module is the replacement the
 * grading seam (report/grading.ts) now derives from: a simpler local
 * score over the engagement's CONFIRMED findings only — the grading
 * seam filters killed/deferred findings out before anything reaches
 * here, so every input finding deducts its full severity weight.
 *
 * The math (kept deliberately small):
 *   - severity weights: critical 35 / high 25 / medium 15 / low 5 /
 *     info 0, deducted from 100;
 *   - the grade is anchored to the worst severity present: one
 *     critical caps the score at 20, one high at 45 — count alone
 *     cannot produce an F;
 *   - the score floors at 10;
 *   - letter bands: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F.
 */
const SEVERITY_WEIGHTS = {
    critical: 35,
    high: 25,
    medium: 15,
    low: 5,
    info: 0,
};
const SCORE_FLOOR = 10;
const SEVERITY_CEILING = {
    critical: 20, // deep F — a confirmed critical is the worst posture
    high: 45, // F — a confirmed high-severity exposure fails the grade
};
const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];
function gradeForScore(score) {
    if (score >= 90)
        return "A";
    if (score >= 80)
        return "B";
    if (score >= 70)
        return "C";
    if (score >= 60)
        return "D";
    return "F";
}
function riskLabelForSeverity(sev) {
    switch (sev) {
        case "critical": return "CRITICAL";
        case "high": return "HIGH RISK";
        case "medium": return "MODERATE";
        case "low": return "LOW RISK";
        case "info": return "INFO";
        default: return "SECURE";
    }
}
/** Highest severity across the findings, or null when there are none. */
function highestSeverity(findings) {
    let top = null;
    for (const f of findings) {
        if (top === null || SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(top)) {
            top = f.severity;
        }
    }
    return top;
}
/** Derive every risk figure the report displays from the confirmed set. */
export function deriveSecurityPosture(findings) {
    const findingsBySeverity = {
        critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };
    let deduction = 0;
    let ceiling = 100; // lowered by the worst confirmed severe finding
    for (const f of findings) {
        findingsBySeverity[f.severity] += 1;
        deduction += SEVERITY_WEIGHTS[f.severity];
        const cap = SEVERITY_CEILING[f.severity];
        if (cap !== undefined)
            ceiling = Math.min(ceiling, cap);
    }
    const score = Math.round(Math.max(SCORE_FLOOR, Math.min(100, 100 - deduction, ceiling)));
    const top = highestSeverity(findings);
    return {
        score,
        grade: gradeForScore(score),
        severity: top ?? "info",
        postureRating: riskLabelForSeverity(top),
        findingsBySeverity,
        activeCount: findings.length,
        confirmedCount: findings.length,
        needsVerificationCount: 0,
        intercepted: false,
    };
}
/**
 * Severity-proportionate warning banner. Returns null when there is
 * nothing to warn about; for an INFO/LOW worst case it returns a calm
 * "notice" (never a red "fix immediately" alarm). The message is
 * derived from the actual highest-severity finding.
 */
export function bannerForPosture(findings) {
    const top = highestSeverity(findings);
    if (!top)
        return null;
    const n = findings.length;
    const noun = n === 1 ? "finding" : "findings";
    const worst = findings.find((f) => f.severity === top);
    const worstTitle = worst?.title ? `"${worst.title}"` : "the highest-severity issue";
    switch (top) {
        case "critical":
            return {
                level: "critical",
                title: "Critical Risk — Immediate Action Required",
                message: `${n} ${noun} detected, including a critical issue (${worstTitle}). A critical finding can allow full compromise of the target. Remediate immediately.`,
            };
        case "high":
            return {
                level: "critical",
                title: "High Risk — Prompt Remediation Needed",
                message: `${n} ${noun} detected. The most severe is a high-severity issue (${worstTitle}) that should be fixed promptly before it can be chained into a larger attack.`,
            };
        case "medium":
            return {
                level: "warning",
                title: "Moderate Hardening Gaps",
                message: `${n} ${noun} detected. The most significant is a medium-severity issue (${worstTitle}) — a defense-in-depth gap worth scheduling for remediation, not an emergency.`,
            };
        default:
            return {
                level: "notice",
                title: "Informational Findings",
                message: `${n} low-impact ${noun} noted (worst severity: ${top.toUpperCase()}). These are informational or minor hardening suggestions, not confirmed exploitable vulnerabilities.`,
            };
    }
}
//# sourceMappingURL=posture.js.map