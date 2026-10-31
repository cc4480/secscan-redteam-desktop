/**
 * AlterEgo bridge dispatch (Q-BRIDGE-TOOLS, Builder B).
 *
 * Routes `bridge_*` tool calls to Builder A's bridge client. The gate
 * is re-checked LIVE here on every call — an engagement that was
 * offered bridge tools while the bridge answered does not keep them
 * when it stops answering, and a re-dispatch (including a repair-loop
 * re-dispatch, which flows through dispatchTool unchanged) re-runs
 * this check like every other gate. Denials are plain DispatchResults
 * with ok:false and are NEVER tagged `repairable`: a closed gate is
 * not a call-shape defect, and the Item-6 tag list is a closed list
 * this handler does not extend. A's client enforces the allowlist
 * locally before any network call; a not-allowlisted rejection is
 * relayed as a denial, so a forbidden op is unreachable through this
 * surface even if a model names it.
 */
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import type { Ctx } from "../context.js";
import type { ActorRole, EngagementPhase } from "../types.js";
import { BridgeCallError, resolveBridgeClient, type BridgeClientLike } from "./bridge-client.js";
import { bridgeOpName, isBridgeToolName } from "./bridge-gate.js";
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
export async function handleBridgeTools(
  ctx: Ctx,
  _role: ActorRole,
  _phase: EngagementPhase,
  call: ToolCallRequest,
  args: Record<string, unknown>,
  clientArg?: BridgeClientLike,
): Promise<DispatchResult | null> {
  if (!isBridgeToolName(call.name)) return null;
  const op = bridgeOpName(call.name);
  // Gate (a): local-host engagements only. A bridge call in a remote
  // engagement was never offered; naming one anyway is refused here,
  // before any client resolution or network probe.
  if (ctx.input.localHost !== true) {
    return {
      result:
        `DENIED: ${call.name} exists only inside a local-host engagement — bridge tools act on the ` +
        "operator's own machine and are never a surface against remote targets.",
      ok: false,
    };
  }
  const client = clientArg ?? (await resolveBridgeClient(ctx));
  // Gate (b): the bridge must answer NOW, not merely when the tool
  // list was composed.
  let available = false;
  try {
    available = await client.available();
  } catch {
    available = false;
  }
  if (!available) {
    return {
      result:
        `DENIED: the AlterEgo bridge is not available on this machine right now, so ${call.name} ` +
        "cannot run. The engagement continues without bridge tools.",
      ok: false,
    };
  }
  try {
    const text = await client.call(op, args);
    return { result: text, ok: true };
  } catch (err) {
    if (err instanceof BridgeCallError) {
      if (err.kind === "not-allowlisted") {
        return {
          result:
            `DENIED: ${op} is not in the bridge allowlist — this surface exposes only the cdp_* family, ` +
            "the job layer (submit_job, job_status, job_result, job_cancel), screenshot, and uia_find.",
          ok: false,
        };
      }
      if (err.kind === "bridge-denied") {
        return {
          result: `DENIED: the bridge's operator consent denied ${call.name} (${err.message}). The operator said no; do not retry it.`,
          ok: false,
        };
      }
      if (err.kind === "unavailable") {
        return {
          result: `DENIED: the AlterEgo bridge became unavailable before ${call.name} could run (${err.message}).`,
          ok: false,
        };
      }
      return { result: `bridge error: ${err.message}`, ok: false };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { result: `bridge error: ${message}`, ok: false };
  }
}
