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
import { type BridgeClientLike } from "./bridge-client.js";
/** Prefix separating the fleet surface's bridge tools from every other family. */
export declare const BRIDGE_TOOL_PREFIX = "bridge_";
/**
 * True when a tool name belongs to the bridge surface.
 * @param name - the offered/dispatched tool name.
 */
export declare function isBridgeToolName(name: string): boolean;
/**
 * The bare bridge operation name behind an offered tool name.
 * @param toolName - the `bridge_`-prefixed tool name.
 */
export declare function bridgeOpName(toolName: string): string;
/**
 * The bridge tools offered in this engagement (empty unless the bridge
 * is live on this machine). Resolved once per engagement and cached.
 * @param ctx - the engagement context.
 * @param phase - the phase asking (named on the active event).
 * @param client - client seam for tests; defaults to the resolved client.
 * @returns the offered bridge tools, `bridge_`-prefixed.
 */
export declare function bridgeToolsForEngagement(ctx: Ctx, phase: EngagementPhase, client?: BridgeClientLike): Promise<JsonSchemaTool[]>;
/**
 * A phase's base tool set plus whatever bridge tools the gate offers.
 * @param ctx - the engagement context.
 * @param phase - the phase asking.
 * @param base - the phase's composed base tools.
 * @param client - client seam for tests.
 * @returns base unchanged when the bridge is down; base + the full bridge toolset when it is live.
 */
export declare function withBridgeTools(ctx: Ctx, phase: EngagementPhase, base: readonly JsonSchemaTool[], client?: BridgeClientLike): Promise<JsonSchemaTool[]>;
