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
import { type ToolDef } from "./mcp-tools.js";
import type { UiLaunchRequest } from "./types.js";
/**
 * Clean a target as typed in conversation: trim, drop surrounding quotes,
 * and strip trailing sentence punctuation. A target typed at the end of a
 * sentence carries its punctuation with it — the keeper's first console
 * launch (eng-2026-10-28-df5a1c0d) took "https://secscan.us," verbatim and
 * the comma became part of the host the scope check saw. Inner characters
 * are never touched: a port or path keeps its punctuation.
 *
 * @param raw - The target exactly as given.
 * @returns The cleaned target.
 */
export declare function cleanTarget(raw: string): string;
/**
 * The host a cleaned target names — the default single-host scope.
 *
 * @param cleaned - A target after {@link cleanTarget}.
 * @returns The hostname, or null when no host can be read from the target.
 */
export declare function targetHost(cleaned: string): string | null;
/**
 * Build the launch request an engagement_launch call hands to the launch
 * handler: cleaned target, red mode unless black was asked for, scope
 * defaulted to the target's host, and a named operator on the record.
 *
 * The operator name matters beyond bookkeeping: authorizePhase attests
 * ownership from the engagement record (operatorName ?? client), so a chat
 * launch always names the person asking — falling back to a plain
 * "the desktop user" when the caller supplied neither — and the record
 * never carries a nameless attestation.
 *
 * @param a - The tool arguments as the agent supplied them.
 * @returns The launch request, or the error the caller should be told.
 */
export declare function buildLaunchBody(a: Record<string, unknown>): {
    body: UiLaunchRequest;
} | {
    error: string;
};
/** The chat-shaped engagement tools, appended to the cockpit list.
 * Launch + status live here; report delivery + regeneration live in
 * report-tools.ts. */
export declare const ENGAGEMENT_TOOLS: ToolDef[];
