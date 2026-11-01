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
import { handleNucleiTools } from "./nuclei.js";
import { handlePcAgentTools } from "./pc-agent.js";
import { handleResearchTools } from "./research.js";
import { handleSecscanTools } from "./secscan.js";
import { handleSeclayerTools } from "./seclayer.js";
import { handleSeclayerDastTool } from "./seclayer-dast.js";
import type { DispatchResult } from "./types.js";
import { handleWebTools } from "./web.js";
import { handleXTool } from "./xtool.js";

const HANDLERS = [
  handleWebTools,
  handleHostTools,
  handleMsfTools,
  handleNucleiTools,
  handleNmapTools,
  handleXTool,
  handlePcAgentTools,
  handleBridgeTools,
  handleSecscanTools,
  handleSeclayerTools,
  handleSeclayerDastTool,
  handleResearchTools,
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
): Promise<DispatchResult> {
  const args = call.arguments ?? {};
  ctx.actions++;
  for (const h of HANDLERS) {
    const r = await h(ctx, role, phase, call, args);
    if (r) return r;
  }
  return { result: `DENIED: unknown tool ${call.name}`, repairable: `unknown tool "${call.name}"` };
}
