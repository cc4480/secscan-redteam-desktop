import { type Ctx } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
export declare function handleNmapTools(ctx: Ctx, _role: ActorRole, _phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>, _seam?: unknown, dispatchSignal?: AbortSignal): Promise<DispatchResult | null>;
