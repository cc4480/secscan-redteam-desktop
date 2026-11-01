import { type Ctx } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
/** Host-exec tools landed after the ssh/smb/winrm trio. Exported so
 *  test/tool-family-consistency.test.ts can pin the family against the
 *  rate-limit set and the proof-action set. */
export declare const WAVE2_TOOLS: Set<string>;
export declare function handleHostTools(ctx: Ctx, _role: ActorRole, phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>): Promise<DispatchResult | null>;
