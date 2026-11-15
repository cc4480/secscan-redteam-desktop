import { type ReportModel } from './deliverables.js';
import { type PocBundle } from '../proof/index.js';
/**
 * The recorded report model, when report.json survived the close. A file
 * that is missing, unparseable, or not a report model is no model at all —
 * the caller falls back to the state record or fails typed.
 */
export declare function loadRecordedModel(dir: string): ReportModel | null;
/** Battery totals from the recorded item ledger (item-verdicts.json),
 * when the phase wrote one; an absent ledger is an empty record. */
export declare function ledgerTotals(dir: string): ReportModel['batteryTotals'];
/** The PoC bundles the run wrote to poc/*.json, keyed by finding id —
 * the same files the package zip ships, read back verbatim. */
export declare function loadBundles(dir: string): Map<string, PocBundle>;
/** The narrative as the phase handed it to the renderer: report.md up
 * to the first runner-computed section. */
export declare function recordedNarrative(dir: string): string;
/** The probe total the phase printed into report.md's battery line —
 * recorded data, read back; 0 when the line is absent. */
export declare function recordedProbes(dir: string): number;
