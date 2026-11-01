/**
 * Shared-state tool handlers: registry, target map, findings, verdicts (v0.19.0 refactor — extracted from dispatch.ts).
 */
import { type Ctx } from '../context.js';
import { type ActorRole, type EngagementPhase } from '../types.js';
import type { ToolCallRequest } from '@secscan/redteam-llm-router';
import { type DispatchResult } from './types.js';
export declare function handleBookkeepingTools(ctx: Ctx, role: ActorRole, phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>): Promise<DispatchResult | null>;
