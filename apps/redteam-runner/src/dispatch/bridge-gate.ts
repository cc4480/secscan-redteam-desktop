/**
 * Bridge tool offering gate (Q-BRIDGE-TOOLS, Builder B).
 *
 * The gate is the whole point of the surface: AlterEgo bridge tools
 * are offered to fleet agents ONLY when both hold —
 *
 *   (a) the engagement is a local-host engagement (ctx.input.localHost,
 *       the Q-RP-11 flag: the target is the operator's own machine,
 *       possession-verified), and
 *   (b) the bridge answers on this machine (Builder A's client).
 *
 * Otherwise the tools are ABSENT from the tool list entirely — the
 * Seclayer-key doctrine (absent key = tools don't exist), never
 * present-but-erroring. Remote engagements do not even probe the
 * bridge. When (a) holds but (b) fails, the engagement records ONE
 * honest `bridge_tools_unavailable` event and proceeds; the offering
 * resolution is cached per engagement (WeakMap on Ctx), so the event
 * fires exactly once however many seams ask. Dispatch re-checks (b)
 * live on every call (dispatch/bridge.ts) — this cache governs only
 * what is offered, never what may run.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
import type { Ctx } from "../context.js";
import type { EngagementPhase } from "../types.js";
import { isAllowlistedBridgeOp, resolveBridgeClient, type BridgeClientLike, type BridgeToolInfo } from "./bridge-client.js";

/** Prefix separating the fleet surface's bridge tools from every other family. */
export const BRIDGE_TOOL_PREFIX = "bridge_";

/**
 * True when a tool name belongs to the bridge surface.
 * @param name - the offered/dispatched tool name.
 */
export function isBridgeToolName(name: string): boolean {
  return name.startsWith(BRIDGE_TOOL_PREFIX);
}

/**
 * The bare bridge operation name behind an offered tool name.
 * @param toolName - the `bridge_`-prefixed tool name.
 */
export function bridgeOpName(toolName: string): string {
  return toolName.slice(BRIDGE_TOOL_PREFIX.length);
}

/** The doctrine every bridge tool description carries (design point 4). */
const DOCTRINE =
  "This tool acts through the AlterEgo bridge on the OPERATOR'S OWN machine, inside a possession-verified " +
  "local-host engagement. It is never a surface against remote targets.";

/** Per-family teaching text, keyed by the bridge operation's family. */
function familyTeaching(op: string): string {
  if (op.startsWith("cdp_")) {
    return (
      "Authenticated browser work in a real Chrome on the operator's machine: drive the in-scope local " +
      "application the way a user would — log in as the owner to establish a session, then test authorization " +
      "as a second account. Address elements from cdp_snapshot output, never by coordinates. cdp_type " +
      "verifies by readback: if the readback differs, the type did not land — re-snapshot instead of " +
      "retrying blind."
    );
  }
  if (op === "submit_job" || op.startsWith("job_")) {
    return (
      "Long-running work on the operator's machine, run as a background job: submit_job returns a job_id " +
      "immediately and the work continues whether or not this call stays open — poll job_status, collect " +
      "the outcome with job_result, stop it with job_cancel. Use it for host-side runs that would outlast " +
      "a single call."
    );
  }
  if (op === "screenshot" || op === "uia_find") {
    return (
      "Verify what is actually on the operator's machine instead of inferring it from process or file " +
      "state: screenshot shows the screen; uia_find locates accessibility elements on it. Read-only " +
      "observation."
    );
  }
  return "";
}

/** Map one allowlisted bridge tool entry onto the fleet surface. */
function toBridgeTool(info: BridgeToolInfo): JsonSchemaTool {
  const teaching = familyTeaching(info.name);
  const description = [teaching, info.description?.trim() ?? "", DOCTRINE].filter(Boolean).join(" ");
  return {
    name: BRIDGE_TOOL_PREFIX + info.name,
    description,
    parameters: (info.inputSchema ?? info.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
  };
}

const offeringCache = new WeakMap<Ctx, Promise<JsonSchemaTool[]>>();

async function resolveOffering(
  ctx: Ctx,
  phase: EngagementPhase,
  clientArg?: BridgeClientLike,
): Promise<JsonSchemaTool[]> {
  if (ctx.input.localHost !== true) return [];
  const client = clientArg ?? (await resolveBridgeClient(ctx));
  let offered: BridgeToolInfo[] | undefined;
  try {
    if (await client.available()) offered = await client.listTools();
  } catch {
    offered = undefined;
  }
  if (!offered) {
    ctx.events.append({
      phase,
      actor: "runner",
      action: "bridge_tools_unavailable",
      result:
        "AlterEgo bridge tools unavailable: the bridge did not answer on this machine, so no bridge_* " +
        "tools are offered in this engagement. The engagement proceeds without them; local inventory " +
        "collection reports bridge absence separately.",
    });
    return [];
  }
  // Defense in depth: the wrapper already filters (bridge-client.ts),
  // but the offering drops any non-allowlisted name again — a forbidden
  // op is never offered, whatever a client returned.
  return offered.filter((t) => isAllowlistedBridgeOp(t.name)).map(toBridgeTool);
}

/**
 * The bridge tools offered in this engagement (empty unless the full
 * gate holds). Resolved once per engagement and cached.
 * @param ctx - the engagement context.
 * @param phase - the phase asking (named on the unavailable event).
 * @param client - client seam for tests; defaults to the resolved client.
 * @returns the offered bridge tools, `bridge_`-prefixed.
 */
export async function bridgeToolsForEngagement(
  ctx: Ctx,
  phase: EngagementPhase,
  client?: BridgeClientLike,
): Promise<JsonSchemaTool[]> {
  let pending = offeringCache.get(ctx);
  if (!pending) {
    pending = resolveOffering(ctx, phase, client);
    offeringCache.set(ctx, pending);
  }
  return pending;
}

/**
 * A phase's base tool set plus whatever bridge tools the gate offers.
 * @param ctx - the engagement context.
 * @param phase - the phase asking.
 * @param base - the phase's composed base tools.
 * @param client - client seam for tests.
 * @returns base unchanged when the gate is closed; base + bridge tools when it opens.
 */
export async function withBridgeTools(
  ctx: Ctx,
  phase: EngagementPhase,
  base: readonly JsonSchemaTool[],
  client?: BridgeClientLike,
): Promise<JsonSchemaTool[]> {
  const extra = await bridgeToolsForEngagement(ctx, phase, client);
  return extra.length > 0 ? [...base, ...extra] : [...base];
}
