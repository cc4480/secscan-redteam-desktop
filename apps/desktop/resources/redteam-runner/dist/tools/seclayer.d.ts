/**
 * Native Seclayer module tool definitions.
 *
 * The Seclayer non-repeat modules are embedded in the runner
 * (src/seclayer/, a byte-frozen vendored copy) and run in-process
 * through these tools — no MCP server, no service call. Every tool
 * here fires ACTIVE web app tests (real exploit attempts, fuzzing, or
 * authenticated two-identity probes), so every one of them is
 * VERIFICATION-GATED: the runner refuses the call unless owner
 * verification is on the engagement record (the authorize phase
 * records it after the owner proves the target is theirs). The tool
 * descriptions state that requirement because the fleet's logic is
 * where the requirement lives — an agent planning to use these tools
 * must secure verification from the owner first, then proceed.
 *
 * Grouping follows the modules' own structure: the RED_TEAM barrel
 * (redTeamProbes.ts) is one tool; BOLA and the API_SEC flow are one
 * tool each (the flow embeds BOLA when identities are supplied); the
 * webhook signature probe, the DAST-unique probe family (selected by
 * `probe`), and the aggressive set (selected by `probe`) round it out.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
export declare const SECLAYER_REDTEAM_TOOL: JsonSchemaTool;
export declare const SECLAYER_BOLA_TOOL: JsonSchemaTool;
export declare const SECLAYER_API_TOOL: JsonSchemaTool;
export declare const SECLAYER_WEBHOOK_TOOL: JsonSchemaTool;
export declare const SECLAYER_DAST_TOOL: JsonSchemaTool;
export declare const SECLAYER_AGGRESSIVE_TOOL: JsonSchemaTool;
export declare const SECLAYER_TOOLS: JsonSchemaTool[];
