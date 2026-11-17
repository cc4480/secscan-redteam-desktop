/**
 * Tool dispatcher: router + safety wrapper (v0.19.0 refactor — extracted from dispatch.ts).
 *
 * dispatchToolInner (dispatch/handlers.ts) routes each tool call to its
 * handler module in the original order. dispatchTool wraps it with
 * the v0.13.0 safety wrapper: rate limiting + autonomy-tier
 * enforcement, all mechanical.
 */
import { type ActorRole, type EngagementPhase } from '../types.js';
import { type Ctx } from '../context.js';
import { type ToolCallRequest } from '@secscan/redteam-llm-router';
import { type DispatchResult } from './types.js';
export { RATE_LIMITED_TOOLS } from './target-host.js';
export { refreshTierFromDisk } from './router-tier.js';
export declare function dispatchTool(ctx: Ctx, role: ActorRole, phase: EngagementPhase, call: ToolCallRequest): Promise<DispatchResult>;
