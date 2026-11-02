/**
 * Q-PROVEN cell-verdict carry helpers for the report phase (extracted
 * from phase.ts to keep that file inside the 300-line budget).
 *
 * The dual-exploiter cell stamps LiveFinding.cellState at adjudication;
 * these helpers carry that verdict onto the report's Finding records —
 * mechanically, by the runner, never from model text.
 */
import { type Finding } from "../types.js";
import { type LiveFinding } from "../context.js";
/**
 * Halted path: a report Finding built mechanically from one live finding,
 * carrying its cell verdict (same F-${i+1} positional indexing as the
 * state sync in dispatch/verdicts.ts). No join is needed here — the
 * halted report is built from the same live array it reports on.
 */
export declare function haltedFindingFromLive(lf: LiveFinding, index: number): Finding;
/**
 * Normal-path join: stamp each reporter-parsed finding with the cell
 * verdict of the live finding it came from. A match requires BOTH keys —
 * normalized title equality AND the live finding's attackId among the
 * parsed finding's attackIds (attackIds are shared ATT&CK ids and titles
 * are model prose; either key alone is not an identifier). Across
 * multiple live matches 'proven' wins; a live finding stamps only the
 * first parsed finding that matches it. A miss leaves the finding
 * completely unstamped — it renders on bundle/status alone, exactly as
 * before this build; a miss never fabricates a verdict.
 */
/**
 * Normal-path reconciliation: build the report's Finding set
 * MECHANICALLY from the live findings — the same base records the
 * halted path builds via {@link haltedFindingFromLive} — and join the
 * reporter's narrative prose (evidence / fix / retest) onto them. The
 * reporter is a narrator, not a source: a live finding it omits still
 * appears, with the runner-side evidence and an explicit note where
 * its remediation prose would have gone, and a reporter item that
 * matches no live finding is dropped — reported through `onDropped`,
 * never silently. A match is by positional id first (the reporter's
 * F-N numbering follows the live list it was shown), then by ATT&CK
 * id; each reporter item joins at most one live finding. Identity
 * fields (id, title, severity, status, attackIds, cell verdict) are
 * always the live record's — the reporter's restatement never moves
 * them.
 */
export declare function mergeReporterFindings(liveFindings: LiveFinding[], reporterFindings: Finding[] | null, onDropped?: (f: Finding) => void): Finding[];
export declare function applyCellVerdicts(findings: Finding[], liveFindings: LiveFinding[]): void;
