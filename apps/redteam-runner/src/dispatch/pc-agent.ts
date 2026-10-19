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
import {
  PC_AGENT_TOOL_NAMES, PC_ACT_OPERATIONS, PC_OBSERVE_OPERATIONS, PC_RUN_OPERATIONS,
} from "../tools/pc-agent.js";
import {
  createPcAgentClient, parsePcAgentReceipt, pcAgentConfig, pcAgentToolTier, type PcAgentTool, type FetchLike,
} from "../host-exec/pc-agent.js";

/** Environment flag the operator sets to allow tier-2 actions for a session. */
export const PC_AGENT_DESTRUCTIVE_ENV = "REDTEAM_PC_AGENT_ALLOW_DESTRUCTIVE";

/** Arguments the bridge receives: everything except the orchestration fields. */
function bridgeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { operation, ...rest } = args;
  void operation;
  return rest;
}

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
export async function handlePcAgentTools(
  ctx: Ctx,
  _role: ActorRole,
  _phase: EngagementPhase,
  call: ToolCallRequest,
  args: Record<string, unknown>,
  fetchImpl?: FetchLike,
): Promise<DispatchResult | null> {
  void ctx;
  if (!PC_AGENT_TOOL_NAMES.has(call.name)) return null;
  const config = pcAgentConfig();
  if (config === undefined) {
    return { result: "DENIED: pc-agent is not configured (REDTEAM_PC_AGENT_URL / REDTEAM_PC_AGENT_TOKEN)", ok: false };
  }
  const operation = typeof args["operation"] === "string" ? args["operation"] : "";
  const allowed = call.name === "pc_observe"
    ? (PC_OBSERVE_OPERATIONS as readonly string[]).includes(operation)
    : call.name === "pc_act"
      ? (PC_ACT_OPERATIONS as readonly string[]).includes(operation)
      : (PC_RUN_OPERATIONS as readonly string[]).includes(operation);
  if (!allowed) return { result: `DENIED: operation ${JSON.stringify(operation)} does not belong to ${call.name}`, ok: false };

  // The tier is the bridge's own classification, checked here as well: a name
  // that drifted into the wrong family cannot slip a tier-2 call into pc_act.
  const tier = pcAgentToolTier(operation);
  const expectedTier = call.name === "pc_observe" ? 0 : call.name === "pc_act" ? 1 : 2;
  if (tier !== expectedTier) {
    return { result: `DENIED: ${operation} is tier ${String(tier)}, not ${String(expectedTier)}`, ok: false };
  }
  if (tier === 2 && (process.env[PC_AGENT_DESTRUCTIVE_ENV] ?? "").trim() !== "1") {
    return {
      result: `DENIED: ${operation} is destructive; the operator must enable it for this session (${PC_AGENT_DESTRUCTIVE_ENV}=1)`,
      ok: false,
    };
  }

  const transport: FetchLike = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const client = createPcAgentClient(config, transport);
  try {
    const result = await client.callWithReceipt(operation as PcAgentTool, bridgeArgs(args));
    const receipt = result.receipt ?? parsePcAgentReceipt(result.text);
    if (receipt?.ok === false || receipt?.changed === false) {
      const code = receipt.error?.code ?? "UNCHANGED";
      return { result: `pc-agent action failed (${code}): ${result.text.slice(0, 1500)}`, ok: false };
    }
    if (receipt?.assert?.pass === false) {
      return { result: `pc-agent postcondition failed: ${result.text.slice(0, 1500)}`, ok: false };
    }
    return { result: result.text, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: `pc-agent error: ${message}`, ok: false };
  }
}
