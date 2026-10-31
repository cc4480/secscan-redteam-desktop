/**
 * Buyer-integrations section (v0.19.0 refactor — extracted from reportPhase).
 *
 * Confirmed findings sync to configured ticketing sinks (Jira/ServiceNow),
 * SIEM-ready JSONL export, and Slack completion + critical-finding
 * notifications. Returns the markdown section to append.
 * Its own try/catch: integrations must never break the report.
 */
import { type Ctx } from "../context.js";
import { type Finding } from "../types.js";
import { PocBundle } from "../proof/index.js";
export declare function buildIntegrationsSection(ctx: Ctx, findings: Finding[], pocBundleMap: Map<string, PocBundle>): Promise<string>;
