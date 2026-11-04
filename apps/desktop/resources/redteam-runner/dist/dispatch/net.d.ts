import { type Ctx } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
import { NetExecutor } from "../net/index.js";
/** The engagement's NetExecutor (created lazily; sessions live per-Ctx). */
export declare function netExecutorFor(ctx: Ctx): NetExecutor;
/** Test seam: bind a prepared executor (injected spawn/fixtures) to a ctx. */
export declare function setNetExecutor(ctx: Ctx, exec: NetExecutor): void;
/**
 * Route one net_exec call.
 * @param ctx - the engagement context.
 * @param role - the calling actor's role.
 * @param phase - the current engagement phase.
 * @param call - the model's tool call.
 * @param args - the call arguments.
 * @returns the result, or null when the call is not net_exec.
 */
export declare function handleNetTools(ctx: Ctx, role: ActorRole, phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>, _seam?: unknown, dispatchSignal?: AbortSignal): Promise<DispatchResult | null>;
