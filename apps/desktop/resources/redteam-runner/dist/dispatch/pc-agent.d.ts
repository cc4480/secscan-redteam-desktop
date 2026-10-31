/**
 * Local-PC agent dispatch: tier gate + bridge call + receipt surface.
 *
 * The bridge is a paired service on the operator's workstation (Streamable HTTP,
 * bearer token). This handler is the only path from the model to it, so the
 * tier checks live here:
 *
 *   pc_observe -> tier 0 (read-only)   always allowed when configured
 *   pc_act     -> tier 1 (safe actions) always allowed when configured
 *   pc_run     -> tier 2 (destructive)  only with REDTEAM_PC_AGENT_ALLOW_DESTRUCTIVE=1
 *
 * A failed call returns a `DENIED:`/`pc-agent error:` string rather than
 * throwing, so one bad bridge call cannot kill an engagement.
 */
import { type Ctx } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
import { type FetchLike } from "../host-exec/pc-agent.js";
/** Environment flag the operator sets to allow tier-2 actions for a session. */
export declare const PC_AGENT_DESTRUCTIVE_ENV = "REDTEAM_PC_AGENT_ALLOW_DESTRUCTIVE";
/**
 * Handle one local-PC tool call.
 * @param ctx - engagement context (unused today; kept for the handler contract).
 * @param _role - actor role (unused).
 * @param _phase - engagement phase (unused).
 * @param call - the model's tool call.
 * @param args - parsed arguments.
 * @param fetchImpl - transport seam for tests; defaults to global fetch.
 * @returns the dispatch result, or null when the tool is not ours.
 */
export declare function handlePcAgentTools(ctx: Ctx, _role: ActorRole, _phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>, fetchImpl?: FetchLike): Promise<DispatchResult | null>;
