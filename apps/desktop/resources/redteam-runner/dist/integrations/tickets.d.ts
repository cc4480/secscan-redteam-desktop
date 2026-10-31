/**
 * INTEGRATIONS — ticket orchestration + retest loop (v0.15.0).
 *
 * After the report phase, every confirmed finding is synced to the
 * configured ticketing sinks (Jira and/or ServiceNow). The linkage is
 * persisted in `integrations.json` (findingId → ticket references) so the
 * standalone `reverify` command can update the same tickets later:
 *   - verdict "reproduced"     → ticket comment: still present
 *   - verdict "not-reproduced" → ticket comment + resolve attempt: verified fixed
 *   - verdict "target-changed" → ticket comment: target changed, needs review
 *
 * Every sink call is individually try/caught: one failing integration
 * never blocks the others, and a total integration failure never breaks
 * the report. The engagement report lists what was attempted/skipped.
 */
import type { Finding } from "../types.js";
import type { PocBundle } from "../proof/bundle.js";
import type { ReverifyReport } from "../proof/reverify.js";
import { type HttpFn } from "./http.js";
/** Persisted linkage: which ticket(s) each finding got. */
export interface TicketMapping {
    engagementId: string;
    writtenAt: string;
    tickets: Record<string, {
        jiraKey?: string;
        snowSysId?: string;
    }>;
}
export interface IntegrationAttempt {
    sink: "jira" | "servicenow" | "slack" | "siem";
    status: "ok" | "skipped" | "failed";
    detail: string;
}
export interface TicketSyncInput {
    engagementId: string;
    target: string;
    findings: Finding[];
    /** findingId → bundle for confirmed findings that earned one. */
    bundles: Map<string, PocBundle>;
    env?: NodeJS.ProcessEnv;
    http?: HttpFn;
}
export interface TicketSyncResult {
    mapping: TicketMapping;
    attempts: IntegrationAttempt[];
}
/**
 * Sync confirmed findings to configured ticketing sinks. Writes
 * integrations.json into dir. Never throws — failures are recorded in
 * attempts.
 */
export declare function syncFindingsToTickets(input: TicketSyncInput, dir: string): Promise<TicketSyncResult>;
/** Load a previously written mapping (reverify side). Null when absent. */
export declare function loadTicketMapping(dir: string): TicketMapping | null;
export interface RetestUpdateResult {
    attempts: IntegrationAttempt[];
}
/**
 * Retest loop: after `reverify` produces a verdict, update the linked
 * tickets. reproduced → "still present"; not-reproduced → "verified fixed"
 * (resolve attempted); target-changed → "needs review". Never throws.
 */
export declare function updateTicketsForReverify(mapping: TicketMapping, bundle: PocBundle, report: ReverifyReport, opts?: {
    env?: NodeJS.ProcessEnv;
    http?: HttpFn;
}): Promise<RetestUpdateResult>;
