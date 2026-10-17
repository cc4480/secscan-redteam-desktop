/**
 * Report presentation helpers.
 *
 * A scoped engagement can legitimately mark hundreds of battery items
 * not-applicable — every item in each battery family the engagement cannot
 * reach — and they all carry the same family-level reason. Listed one per line
 * that produced a 392-line report of which 338 lines were a single sentence
 * repeated with a different id: the reader scrolled past a wall of "not in
 * scope" to reach the findings, which were somewhere in the middle.
 *
 * The ids still matter, but they belong in item-verdicts.json, which is the
 * machine-readable record. The report is for a human, and a human needs the
 * shape of the result, not the enumeration.
 */
export interface VerdictRow {
    key: string;
    disposition: string;
    name: string;
    reason?: string;
}
export interface VerdictGroup {
    target: string;
    reason: string;
    ids: string[];
}
/** Group not-applicable verdicts by target and reason, largest group first. */
export declare function groupNotApplicable(items: VerdictRow[]): VerdictGroup[];
export declare function renderNotApplicable(groups: VerdictGroup[]): string;
