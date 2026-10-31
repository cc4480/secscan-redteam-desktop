/**
 * Nmap bridge tool definition.
 *
 * The agent picks a PROFILE and a HOST. It does not supply flags: the argv is
 * runner-built from the profile table, so there is no path from agent input to
 * nmap's command line. Intrusive NSE categories, timing above -T4 and the
 * attribution-defeating flags are refused with a reason (see policy.ts).
 *
 * `profiles` touches no target and is safe in any phase; `scan` sends packets
 * and is subject to the same scope check, rate limit and tier rules as every
 * other tool that touches a host.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const NMAP_EXEC_TOOL: JsonSchemaTool;
