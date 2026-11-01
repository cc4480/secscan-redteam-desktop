import { type DeliverablesOutcome } from "./deliverables.js";
/**
 * Re-fire report generation for a recorded engagement end: reassemble
 * the HTML from the recorded state, re-emit the findings sheet and the
 * closing deliverables, then verify + stamp via `finalizeDeliverables`.
 * The returned outcome is the verification — `ok` only when the whole
 * seven-file set is on disk afterwards.
 *
 * @param dir - The engagement directory (must carry state.json).
 * @returns The deliverable verification outcome.
 */
export declare function regenerateReport(dir: string): DeliverablesOutcome;
