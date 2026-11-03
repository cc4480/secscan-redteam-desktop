/**
 * Coverage completeness — the single predicate every report surface reads.
 *
 * An engagement that did not finish is not a secure engagement. When battery
 * items still carry no verdict, the absence of a finding is the absence of
 * evidence, and no surface may assert a posture.
 *
 * Why this module exists: `scoring.ts` derives a RiskLabel from the findings
 * set, and `riskLabelForSeverity(null)` correctly returns "SECURE" for a run
 * that produced no findings. That default describes the findings set — it does
 * NOT describe whether the assessment ran. Printing it on a halted run is how
 * a report comes to say "overall posture SECURE" beside "104 items pending".
 *
 * Every prose surface therefore gates on this module instead of reading the
 * label directly. One predicate, one wording, no drift between MD/TXT/HTML/DOCX.
 */
/** Items still awaiting a verdict. */
export function pendingVerdicts(t) {
    return Math.max(0, t.pending);
}
/**
 * True when every planned item carries a verdict.
 *
 * A zero-item battery is NOT complete: nothing was planned, so nothing was
 * concluded, and a report must not treat "no items" as "no problems".
 */
export function isCoverageComplete(t) {
    if (t.total <= 0)
        return false;
    return pendingVerdicts(t) === 0;
}
/**
 * The posture clause that replaces "overall posture <label>" when the
 * assessment did not finish. Complete coverage keeps the anchored label.
 */
export function postureClause(rating, t) {
    if (isCoverageComplete(t))
        return `overall posture ${rating}`;
    return ('assessment incomplete — overall posture not determined ' +
        `(${pendingVerdicts(t)} of ${t.total} battery items carry no verdict)`);
}
/**
 * The zero-finding clause. Complete coverage may say nothing material was
 * found; incomplete coverage may only say nothing was found *in what ran*.
 */
export function noFindingClause(t) {
    if (isCoverageComplete(t)) {
        return 'No material business risk identified from this pass; continued monitoring is still recommended as the application evolves.';
    }
    return ('No confirmed findings in the part of this assessment that ran — and that is not a clean result. ' +
        `${pendingVerdicts(t)} of ${t.total} battery items carry no verdict, so absence of a finding here ` +
        'is absence of evidence, not evidence of absence.');
}
/** The grade-anchor clause for the breakdown, honest about a run that stopped. */
export function gradeAnchorClause(t) {
    if (isCoverageComplete(t))
        return 'No single finding anchors the grade; it follows the confirmed set.';
    return 'No grade is anchored — the assessment did not complete, so there is no confirmed set to rank.';
}
//# sourceMappingURL=completeness.js.map