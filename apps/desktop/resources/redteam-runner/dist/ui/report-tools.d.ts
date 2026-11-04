import { type ToolDef } from "./mcp-tools.js";
/** engagement_report — the finished report, for delivery in the thread. */
export declare const reportTool: ToolDef;
/** Recorded ends regeneration may run on are TERMINAL_STATUSES (shared
 * from events.ts) — a live run owns its own report phase and must never
 * be re-fired underneath it. */
/** engagement_regenerate_report — re-fire report generation for a
 * recorded engagement end whose deliverable set is incomplete. */
export declare const regenerateTool: ToolDef;
