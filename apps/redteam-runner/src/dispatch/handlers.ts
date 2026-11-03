/**
 * The dispatch handler chain (extracted from router.ts, which sits at
 * the file budget, when the bridge handler joined — Q-BRIDGE-TOOLS).
 *
 * dispatchToolInner routes each tool call to its handler module in
 * the original order; the first handler that claims the call answers
 * it. dispatchTool (router.ts) wraps this chain with the safety
 * wrapper. Handler order is load-bearing only where name spaces could
 * overlap; the bridge handler claims the exclusive `bridge_` prefix.
 */
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import type { Ctx } from "../context.js";
import type { ActorRole, EngagementPhase } from "../types.js";
import { handleBookkeepingTools } from "./bookkeeping.js";
import { handleBridgeTools } from "./bridge.js";
import { handleHostTools } from "./host.js";
import { handleMsfTools } from "./msf.js";
import { handleNmapTools } from "./nmap.js";
import { handleNetTools } from "./net.js";
import { handleNucleiTools } from "./nuclei.js";
import { handlePcAgentTools } from "./pc-agent.js";
import { handleResearchTools } from "./research.js";
import { handleSkillLoadTools } from "./skill-load.js";
import { handleSecscanTools } from "./secscan.js";
import { handleSeclayerTools } from "./seclayer.js";
import { handleSeclayerDastTool } from "./seclayer-dast.js";
import type { DispatchResult } from "./types.js";
import { handleWebTools } from "./web.js";
import { handleXTool } from "./xtool.js";

/* Handler chain note: dispatchToolInner passes the router's per-call
 * dispatch signal (dispatch/timeout.ts budget) as the SEVENTH argument.
 * It sits after the sixth slot because two handlers already own that
 * slot as a test seam (pc-agent's fetch, bridge's client); the chain
 * passes `undefined` there. Handlers that spawn or execute accept the
 * signal and pass it to their executor in place of a private controller,
 * so the dispatch deadline can actually stop the in-flight call. */
const HANDLERS = [
  handleWebTools,
  handleHostTools,
  handleMsfTools,
  handleNucleiTools,
  handleNmapTools,
  handleNetTools,
  handleXTool,
  handlePcAgentTools,
  handleBridgeTools,
  handleSecscanTools,
  handleSeclayerTools,
  handleSeclayerDastTool,
  handleResearchTools,
  handleSkillLoadTools,
  handleBookkeepingTools,
];

/**
 * Route one tool call through the handler chain.
 * @param ctx - the engagement context.
 * @param role - the calling actor's role.
 * @param phase - the current engagement phase.
 * @param call - the model's tool call.
 * @returns the first claiming handler's result; an unknown-tool denial
 * (tagged repairable, per RC Item 6) when no handler claims the call.
 */
export async function dispatchToolInner(
  ctx: Ctx,
  role: ActorRole,
  phase: EngagementPhase,
  call: ToolCallRequest,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  const args = call.arguments ?? {};
  ctx.actions++;
  for (const h of HANDLERS) {
    const r = await h(ctx, role, phase, call, args, undefined, signal);
    if (r) return r;
  }
  return { result: `DENIED: unknown tool ${call.name}`, repairable: `unknown tool "${call.name}"` };
}
