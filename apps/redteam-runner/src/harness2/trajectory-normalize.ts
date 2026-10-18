/**
 * Harness2 event normalization + token capture (H2-P1a).
 *
 * Event normalization: EngagementEvent[] -> contract TrajectoryEvent[].
 *
 * TOKEN CAPTURE - the honest finding (H2-P1a):
 *   The llm-router DOES expose usage: ChatResult.usage = { promptTokens,
 *   completionTokens, totalTokens } (packages/redteam/llm-router/src/types.ts).
 *   But the runner drops it: agents.ts agentLoop does `res = await complete(...)`
 *   and consumes only text/reasoning/toolCalls; no call site anywhere in
 *   apps/redteam-runner/src accumulates usage (grep for promptTokens /
 *   tokenUsage finds nothing), and Ctx has no token counter, so the finish path
 *   cannot retroactively recover real sums.
 *   Tokens are therefore recorded as explicit 0 via ZERO_TOKEN_TOTALS with
 *   TOKEN_CAPTURE_STATUS as the documented reason - never estimated. The
 *   createTokenMeter() meter below is the ready-made capture: installing it in
 *   agentLoop (one `meter.record(res.usage)` after the complete() call) and
 *   passing `meter.totals` through captureEngagementTrajectory's `tokens` seam
 *   turns tokensIn/tokensOut real for every future run.
 */
import type { EngagementEvent } from "../types.js";
import type { TrajectoryEvent } from "./contract.js";

/** One provider response's token usage, as ChatResult.usage reports it. */
export interface LlmTokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface TokenTotals {
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** Provider responses recorded, so a 0 is distinguishable from "no calls". */
  readonly responses: number;
}

/** Additive token accumulator for the model-router path. */
export interface TokenMeter {
  record(usage: LlmTokenUsage | undefined): void;
  readonly totals: TokenTotals;
}

/** Why tokens are 0 for H2-P1a runs: the usage exists but the runner drops it. */
export const TOKEN_CAPTURE_STATUS =
  "unavailable: ChatResult.usage is exposed by llm-router but agents.ts agentLoop discards it and Ctx has no token accumulator; no meter was installed for this run";

/** Explicit zeroes-with-reason; the default when no meter is installed. */
export const ZERO_TOKEN_TOTALS: TokenTotals = { tokensIn: 0, tokensOut: 0, responses: 0 };

function nonNegativeInt(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** Create the accumulator to install on the llm-router path. */
export function createTokenMeter(): TokenMeter {
  let tokensIn = 0;
  let tokensOut = 0;
  let responses = 0;
  return {
    record(usage: LlmTokenUsage | undefined): void {
      if (usage === undefined) return;
      tokensIn += nonNegativeInt(usage.promptTokens);
      tokensOut += nonNegativeInt(usage.completionTokens);
      responses++;
    },
    get totals(): TokenTotals {
      return { tokensIn, tokensOut, responses };
    },
  };
}

/**
 * Per-engagement token meters. Keyed by the run's Ctx so two engagements in
 * one process never share a counter, and no module-global total exists.
 */
const metersByEngagement = new WeakMap<object, TokenMeter>();

/** The token meter for one engagement context; created on first use. */
export function tokenMeterFor(owner: object): TokenMeter {
  const existing = metersByEngagement.get(owner);
  if (existing !== undefined) return existing;
  const meter = createTokenMeter();
  metersByEngagement.set(owner, meter);
  return meter;
}

/** Tool families whose dispatched events are tool calls. */
const TOOL_PREFIX = /^(scan_|probe_|http_|burst_|nmap_|nuclei_|msf_|john_|sqlmap_|ffuf_|gobuster_|nikto_|ssh_|smb_|winrm_|rdp_|ad_|krb_|nfs_|xtool_|browser_)/;
/** Tools without a family prefix: the bookkeeping / verdict tools. */
const TOOL_NAMES: ReadonlySet<string> = new Set([
  "query_registry",
  "update_target_map",
  "record_finding",
  "record_killed",
  "record_item_verdict",
  "variant_list",
  "abort_engagement",
]);

/**
 * True when the event is a tool invocation: a known tool name/family prefix, or
 * the event carried an ATT&CK technique (only tool dispatches set attackId).
 */
export function isToolAction(action: string, attackId?: string): boolean {
  return attackId !== undefined || TOOL_PREFIX.test(action) || TOOL_NAMES.has(action);
}

/** Normalize the runner's EngagementEvent[] into contract TrajectoryEvent[]. */
export function toTrajectoryEvents(events: readonly EngagementEvent[]): TrajectoryEvent[] {
  return events.map((event) => ({
    ts: event.ts,
    phase: event.phase,
    actor: event.actor,
    action: event.action,
    ...(event.attackId !== undefined ? { attackId: event.attackId } : {}),
    ...(event.target !== undefined ? { target: event.target } : {}),
    result: event.result,
    isToolCall: isToolAction(event.action, event.attackId),
  }));
}
