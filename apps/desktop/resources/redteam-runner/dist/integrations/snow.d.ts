/**
 * INTEGRATIONS — ServiceNow sink (v0.15.0).
 *
 * Same shape as the Jira sink via the REST table API: one record per
 * confirmed finding, work-notes + state updates on retest. Default table
 * is "incident" (overridable via REDTEAM_SNOW_TABLE for customers that
 * route vulns to sn_vul_vulnerability or a custom table).
 *
 * Ticket content is the finding + proof reference + fix guidance. No SLA
 * language; no remediation promises.
 */
import type { Finding } from "../types.js";
import type { PocBundle } from "../proof/bundle.js";
import type { SnowConfig } from "./config.js";
import { type HttpFn } from "./http.js";
export interface SnowRecordInput {
    finding: Finding;
    bundle: PocBundle | null;
    engagementId: string;
    target: string;
}
/** Create one record per finding. Returns the record sys_id. */
export declare function createSnowRecord(cfg: SnowConfig, input: SnowRecordInput, http?: HttpFn): Promise<string>;
/**
 * Update a record with retest news. When verifiedFixed, attempt to resolve
 * (incident state 6); otherwise leave a work note. Returns what was done.
 */
export declare function updateSnowRecord(cfg: SnowConfig, sysId: string, note: string, verifiedFixed: boolean, http?: HttpFn): Promise<"resolved" | "noted">;
