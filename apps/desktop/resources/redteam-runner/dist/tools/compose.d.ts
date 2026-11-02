/**
 * Composed tool sets per phase (withBatteryItem tagging).
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
/**
 * Universal access — operator's order 2026-11-01: every fleet seat holds
 * the FULL tool catalog ("I want all of the agents to have full control of
 * those tools"). RECON_TOOLS, EXPLOIT_TOOLS and COMMAND_TOOLS all export
 * the deduplicated union of the former recon and exploit sets, so the
 * coordinator, recon, exploiter, coder and reporter seats are offered the
 * identical catalog. This supersedes the Q-RP-6 per-role restriction
 * (recon/exploit subsets; the coordinator command-only — its set carried
 * only the abort_engagement kill switch until that was removed on the
 * operator's order earlier on 2026-11-01). Phase names survive as the
 * composition points; access no longer varies by phase. Seat prompts are
 * unchanged: role guidance still describes each seat's job, but the
 * mechanical bar on tool access is gone. Scope, ROE and the dispatch
 * guards still bind every call — universal access is not universal reach.
 */
export declare const FULL_TOOLS: JsonSchemaTool[];
export declare const RECON_TOOLS: JsonSchemaTool[];
export declare const EXPLOIT_TOOLS: JsonSchemaTool[];
export declare const COMMAND_TOOLS: JsonSchemaTool[];
