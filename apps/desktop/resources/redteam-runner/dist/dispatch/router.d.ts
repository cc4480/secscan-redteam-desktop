/**
 * Tool dispatcher: router + safety wrapper (v0.19.0 refactor — extracted from dispatch.ts).
 *
 * dispatchToolInner (dispatch/handlers.ts) routes each tool call to its
 * handler module in the original order. dispatchTool wraps it with
 * the v0.13.0 safety wrapper: rate limiting + autonomy-tier
 * enforcement, all mechanical.
 */
import { type ActorRole, type EngagementPhase } from "../types.js";
import { type Ctx } from "../context.js";
import { type ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
export { RATE_LIMITED_TOOLS } from "./target-host.js";
/**
 * v0.24.0: mid-run tier changes. The operator may raise/lower the tier via
 * `redteam-runner escalate` or the UI; both rewrite tier.json in the
 * engagement dir (atomically). The dispatcher re-reads it before every tier
 * check so the new tier takes effect without restarting the engagement.
 * The change lands in the audit log — never silent. A missing or corrupt
 * file means "no change". Exported for tests; dispatchTool calls it.
 */
export declare function refreshTierFromDisk(ctx: Ctx, phase: EngagementPhase): void;
export declare function dispatchTool(ctx: Ctx, role: ActorRole, phase: EngagementPhase, call: ToolCallRequest): Promise<DispatchResult>;
