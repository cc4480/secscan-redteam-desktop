/**
 * Zero-disruption record (v0.13.0) — the production safety case.
 *
 * Derived mechanically from the engagement's events.jsonl AFTER the run:
 * counts every safety refusal and proves the negative — no destructive
 * action fired. This is the artifact a buyer's security team reviews: not
 * "we were careful", but the counted refusals from the audit log.
 *
 * Counts (all from events the runner itself appended):
 *  - denylistRefusals: destructive-command denylist hits ("DENIED by destructive-command denylist")
 *  - dosRefusals: DoS/destructive module or payload refusals (msf policy)
 *  - scopeRefusals: out-of-scope target refusals
 *  - policyRefusals: other ROE/policy refusals (technique excluded, phase-gated msf run, etc.)
 *  - autoHalts: per-target auto-halt events
 *  - killSwitchAborts: coordinator/operator aborts that terminated in-flight work
 *  - destructiveActionsFired: MUST be 0 — any event whose result claims a
 *    destructive action executed. The record states the count, never assumes.
 */
import type { EngagementEvent } from "../types.js";
export interface ZeroDisruptionRecord {
    denylistRefusals: number;
    dosRefusals: number;
    scopeRefusals: number;
    policyRefusals: number;
    autoHalts: number;
    killSwitchAborts: number;
    /** Counted, never assumed — the record is only clean when this is 0. */
    destructiveActionsFired: number;
    /** Total safety interventions (all of the above except destructiveActionsFired). */
    totalInterventions: number;
}
export declare function buildZeroDisruptionRecord(events: EngagementEvent[]): ZeroDisruptionRecord;
/** One-line verdict for the manifest and the report. */
export declare function disruptionVerdict(rec: ZeroDisruptionRecord): string;
