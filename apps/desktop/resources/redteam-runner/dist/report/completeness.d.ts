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
export interface CoverageTotals {
    total: number;
    confirmed: number;
    executedClean: number;
    killed: number;
    blocked: number;
    na: number;
    pending: number;
}
/** Items still awaiting a verdict. */
export declare function pendingVerdicts(t: CoverageTotals): number;
/**
 * True when every planned item carries a verdict.
 *
 * A zero-item battery is NOT complete: nothing was planned, so nothing was
 * concluded, and a report must not treat "no items" as "no problems".
 */
export declare function isCoverageComplete(t: CoverageTotals): boolean;
/**
 * The posture clause that replaces "overall posture <label>" when the
 * assessment did not finish. Complete coverage keeps the anchored label.
 */
export declare function postureClause(rating: string, t: CoverageTotals): string;
/**
 * The zero-finding clause. Complete coverage may say nothing material was
 * found; incomplete coverage may only say nothing was found *in what ran*.
 */
export declare function noFindingClause(t: CoverageTotals): string;
/** The grade-anchor clause for the breakdown, honest about a run that stopped. */
export declare function gradeAnchorClause(t: CoverageTotals): string;
