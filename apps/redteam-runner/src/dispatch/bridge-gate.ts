/**
 * Bridge tool offering gate (Q-BRIDGE-TOOLS, Builder B).
 *
 * REVISED DESIGN (Carlos's direct order, 2026-10-31 ~18:00 CDT): the
 * allowlist is REMOVED and the localHost-only restriction is LIFTED.
 * The full AlterEgo toolset is offered — every tool the bridge offers,
 * unfiltered — and the ONE gate that remains is bridge availability:
 *
 *   bridge tools exist ONLY when the bridge is live on the machine
 *   this app runs on (paired + answering). Bridge down or unpaired =
 *   the tools are absent entirely, in every engagement type.
 *
 * A live bridge on the operator's machine makes its tools available to
 * an engagement running from that machine — any engagement, local or
 * remote-target — because the tools act on the operator's own machine,
 * which can be the launch point for work (the xtool posture). When the
 * gate opens, the engagement records ONE honest `bridge_tools_active`
 * event saying so; the offering resolution is cached per engagement
 * (WeakMap on Ctx), so the event fires exactly once however many seams
 * ask. Dispatch re-checks availability live on every call
 * (dispatch/bridge.ts) — this cache governs only what is offered,
 * never what may run.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
import type { Ctx } from "../context.js";
import type { EngagementPhase } from "../types.js";
import { resolveBridgeClient, type BridgeClientLike, type BridgeToolInfo } from "./bridge-client.js";

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

/**
 * The truth every bridge tool description carries: these are the
 * operator's hands on his own box — never an action against a remote
 * target directly.
 */
const OWN_MACHINE =
  "This tool acts through the AlterEgo bridge on the OPERATOR'S OWN machine — the operator's hands on " +
  "his own box. It is never an action against a remote target directly; the operator's machine can be " +
  "the launch point for the work, the way xtool runs from this machine.";

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
  return (
    "Direct control of the operator's own machine — shell, files, windows, input, processes, power: " +
    "the operator's hands on his own box. Work on this machine as the operator would himself; anything " +
    "aimed at a target goes out from this machine through its own network and tools."
  );
}

/** Map one bridge tool entry onto the fleet surface, full registry, unfiltered. */
function toBridgeTool(info: BridgeToolInfo): JsonSchemaTool {
  const teaching = familyTeaching(info.name);
  const description = [teaching, info.description?.trim() ?? "", OWN_MACHINE].filter(Boolean).join(" ");
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
  const client = clientArg ?? (await resolveBridgeClient(ctx));
  let offered: BridgeToolInfo[] | undefined;
  try {
    if (await client.available()) offered = await client.listTools();
  } catch {
    offered = undefined;
  }
  if (!offered) return [];
  ctx.events.append({
    phase,
    actor: "runner",
    action: "bridge_tools_active",
    result:
      `AlterEgo bridge tools are active in this engagement: the bridge is live on the operator's machine, ` +
      `so its full toolset (${offered.length} tools) is offered as bridge_* tools. They act on the ` +
      "operator's OWN machine — shell, files, windows, browser, power — never against a remote target directly.",
  });
  return offered.map(toBridgeTool);
}

/**
 * The bridge tools offered in this engagement (empty unless the bridge
 * is live on this machine). Resolved once per engagement and cached.
 * @param ctx - the engagement context.
 * @param phase - the phase asking (named on the active event).
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
 * @returns base unchanged when the bridge is down; base + the full bridge toolset when it is live.
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
