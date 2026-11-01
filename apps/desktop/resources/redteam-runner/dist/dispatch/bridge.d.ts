/**
 * AlterEgo bridge dispatch (Q-BRIDGE-TOOLS, Builder B).
 *
 * Routes `bridge_*` tool calls to Builder A's bridge client. The one
 * gate — bridge availability — is re-checked LIVE here on every call:
 * an engagement that was offered bridge tools while the bridge
 * answered does not keep them when it stops answering, and a
 * re-dispatch (including a repair-loop re-dispatch, which flows
 * through dispatchTool unchanged) re-runs this check. Denials are
 * plain DispatchResults with ok:false and are NEVER tagged
 * `repairable`: a down bridge is not a call-shape defect, and the
 * Item-6 tag list is a closed list this handler does not extend. A
 * bridge-side consent denial (the bridge's native dialog said no, or
 * timed out) surfaces as its own clean typed result — never a hang,
 * a crash, or a silent drop.
 */
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import type { Ctx } from "../context.js";
import type { ActorRole, EngagementPhase } from "../types.js";
import { type BridgeClientLike } from "./bridge-client.js";
import type { DispatchResult } from "./types.js";
/**
 * Handle one bridge tool call.
 * @param ctx - the engagement context.
 * @param _role - actor role (unused; the gate is engagement-scoped).
 * @param _phase - engagement phase (unused).
 * @param call - the model's tool call.
 * @param args - parsed arguments, forwarded to the bridge unchanged.
 * @param clientArg - client seam for tests; defaults to the resolved client.
 * @returns the dispatch result, or null when the tool is not ours.
 */
export declare function handleBridgeTools(ctx: Ctx, _role: ActorRole, _phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>, clientArg?: BridgeClientLike): Promise<DispatchResult | null>;
