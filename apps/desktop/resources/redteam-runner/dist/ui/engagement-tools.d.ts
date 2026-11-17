/**
 * Chat-shaped engagement tools for the RedTeam console (v0.31.0).
 *
 * start_engagement (mcp-tools.ts) is the CLI-shaped launch: the caller must
 * construct target, mode, objective and scope exactly, the way a CLI user
 * would. That shape is why a chat agent, handed "run a full deep scan",
 * improvised with other tools instead — the launch it needed was one it had
 * to assemble perfectly before it could start anything.
 *
 * These tools are the conversation-shaped surface over the SAME route
 * handlers, so the safety core, launch validation and tier rules apply
 * unchanged:
 *
 *   engagement_launch  — target as the user gave it (sentence punctuation
 *                        cleaned, scope derived from its host, mode red by
 *                        default), objective in the user's words, and a
 *                        named operator on the record — the attestation the
 *                        authorize phase consumes.
 *   engagement_status  — one snapshot reshaped for narration in a thread:
 *                        status, phase, event and finding counts, the
 *                        halt/block reason when there is one, and the
 *                        missing files when the deliverable set failed.
 *   engagement_report  — the finished report's content for delivery in the
 *                        thread, plus the in-app artifact paths. Returns
 *                        ready:false while the run is still going.
 *   engagement_regenerate_report — (report-tools.ts) re-fires report
 *                        generation from the recorded state when a
 *                        finished engagement's deliverable set is short.
 *
 * The console chat and the desktop host's chat consume one MCP tool list
 * (mcp-endpoint.ts), so these tools appear on both surfaces at once.
 */
import { type ToolDef } from './mcp-tools.js';
import type { UiLaunchRequest } from './types.js';
export { cleanTarget, resolveLaunchOperator, targetHost } from './launch-targets.js';
export declare function buildLaunchBody(a: Record<string, unknown>): {
    body: UiLaunchRequest;
} | {
    error: string;
};
/** The chat-shaped engagement tools, appended to the cockpit list.
 * Launch + status live here; report delivery + regeneration live in
 * report-tools.ts. */
export declare const ENGAGEMENT_TOOLS: ToolDef[];
