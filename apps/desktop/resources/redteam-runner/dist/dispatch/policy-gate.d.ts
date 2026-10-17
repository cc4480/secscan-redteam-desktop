/**
 * Dispatch policy gate (v0.34.0) — the operator controls that sit between the
 * mechanical safety core and the tool handlers.
 *
 * Extracted from dispatch/router.ts so the dispatcher stays readable and under
 * the 300-line file budget, and so the gate can be tested on its own.
 *
 * Order per call:
 *   1. operator policy (allow/deny rules, deny-wins) — a denied call sends nothing
 *   2. PreToolUse hooks (allow / deny / modify)
 *   3. handler
 *   4. PostToolUse hooks (may replace the result)
 *
 * Every evaluation is appended as an individual audit event — a policy decision
 * is never silent.
 */
import type { Ctx } from "../context.js";
import type { EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import type { DispatchResult } from "./types.js";
export interface DispatchGate {
    /** Set when the call must not reach the handler. */
    denial?: DispatchResult;
    /** The call to execute (may carry hook-modified arguments). */
    call: ToolCallRequest;
}
/** Policy + pre-hooks. Never sends anything; returns a denial or the call to run. */
export declare function preDispatchGate(ctx: Ctx, phase: EngagementPhase, call: ToolCallRequest, host: string | undefined): Promise<DispatchGate>;
/** Post-hooks. May replace the handler's result (e.g. scrub a secret). */
export declare function postDispatchHooks(ctx: Ctx, phase: EngagementPhase, call: ToolCallRequest, result: DispatchResult, host: string | undefined): Promise<DispatchResult>;
