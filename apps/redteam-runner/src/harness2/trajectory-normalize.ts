/**
 * Harness2 event normalization + token capture (H2-P1a).
 *
 * Event normalization: EngagementEvent[] -> contract TrajectoryEvent[].
 *
 * TOKEN CAPTURE (H2-P1):
 *   The llm-router exposes usage: ChatResult.usage = { promptTokens,
 *   completionTokens, totalTokens, cacheReadTokens? } (packages/redteam/
 *   llm-router/src/types.ts). On the OpenAI-shaped wire promptTokens is the
 *   gross prompt, cached tokens included; cacheReadTokens is the cached
 *   subset when the provider reports the split, so fresh input is
 *   tokensIn - cacheReadTokens.
 *   agents.ts agentLoop now records EVERY response into the per-engagement
 *   meter below (`tokenMeterFor(ctx).record(res.usage)` right after the
 *   complete() call), and captureEngagementTrajectory reads `meter.totals`, so
 *   tokensIn/tokensOut are real for every run that made a model call. The same
 *   usage is attached per response to the section-5 step journal (steps.ts).
 *   A recorded 0 therefore means "no model response happened (or the run
 *   predates the meter)", never an estimate: nothing here guesses token counts.
 */
import type { EngagementEvent } from '../types.js'
import type { TrajectoryEvent } from './contract.js'

/** One provider response's token usage, as ChatResult.usage reports it. */
export interface LlmTokenUsage {
  readonly promptTokens?: number
  readonly completionTokens?: number
  readonly totalTokens?: number
  /** Cached subset of promptTokens, present only when the provider reports the split. */
  readonly cacheReadTokens?: number
}

export interface TokenTotals {
  readonly tokensIn: number
  readonly tokensOut: number
  /**
   * Cached-input tokens summed over the responses that reported the split;
   * a subset of tokensIn, so fresh input is tokensIn - cacheReadTokens.
   * Responses whose provider reports no split contribute 0.
   */
  readonly cacheReadTokens: number
  /** Provider responses recorded, so a 0 is distinguishable from "no calls". */
  readonly responses: number
}

/** Additive token accumulator for the model-router path. */
export interface TokenMeter {
  record(usage: LlmTokenUsage | undefined): void
  readonly totals: TokenTotals
}

/** Why a run can still show 0 tokens: it made no model call (never estimated). */
export const TOKEN_CAPTURE_STATUS =
  'captured: agents.ts agentLoop records every ChatResult.usage into the per-engagement meter and captureEngagementTrajectory sums it; 0 means no model response happened (or the run predates the P1 meter) - never an estimate'

/** Explicit zeroes-with-reason; the default when no response was recorded. */
export const ZERO_TOKEN_TOTALS: TokenTotals = { tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, responses: 0 }

function nonNegativeInt(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** Create the accumulator to install on the llm-router path. */
export function createTokenMeter(): TokenMeter {
  let tokensIn = 0
  let tokensOut = 0
  let cacheReadTokens = 0
  let responses = 0
  return {
    record(usage: LlmTokenUsage | undefined): void {
      if (usage === undefined) return
      tokensIn += nonNegativeInt(usage.promptTokens)
      tokensOut += nonNegativeInt(usage.completionTokens)
      cacheReadTokens += nonNegativeInt(usage.cacheReadTokens)
      responses++
    },
    get totals(): TokenTotals {
      return { tokensIn, tokensOut, cacheReadTokens, responses }
    },
  }
}

/**
 * Per-engagement token meters. Keyed by the run's Ctx so two engagements in
 * one process never share a counter, and no module-global total exists.
 */
const metersByEngagement = new WeakMap<object, TokenMeter>()

/** The token meter for one engagement context; created on first use. */
export function tokenMeterFor(owner: object): TokenMeter {
  const existing = metersByEngagement.get(owner)
  if (existing !== undefined) return existing
  const meter = createTokenMeter()
  metersByEngagement.set(owner, meter)
  return meter
}

/** Tool families whose dispatched events are tool calls. */
const TOOL_PREFIX =
  /^(scan_|probe_|http_|burst_|nmap_|nuclei_|msf_|john_|sqlmap_|ffuf_|gobuster_|nikto_|ssh_|smb_|winrm_|rdp_|ad_|krb_|nfs_|xtool_|browser_)/
/** Tools without a family prefix: the bookkeeping / verdict tools. */
const TOOL_NAMES: ReadonlySet<string> = new Set([
  'query_registry',
  'update_target_map',
  'record_finding',
  'record_killed',
  'record_item_verdict',
  'variant_list',
])

/**
 * True when the event is a tool invocation: a known tool name/family prefix, or
 * the event carried an ATT&CK technique (only tool dispatches set attackId).
 */
export function isToolAction(action: string, attackId?: string): boolean {
  return attackId !== undefined || TOOL_PREFIX.test(action) || TOOL_NAMES.has(action)
}

/** Normalize the runner's EngagementEvent[] into contract TrajectoryEvent[]. */
export function toTrajectoryEvents(events: readonly EngagementEvent[]): TrajectoryEvent[] {
  return events.map(event => ({
    ts: event.ts,
    phase: event.phase,
    actor: event.actor,
    action: event.action,
    ...(event.attackId !== undefined ? { attackId: event.attackId } : {}),
    ...(event.target !== undefined ? { target: event.target } : {}),
    result: event.result,
    isToolCall: isToolAction(event.action, event.attackId),
  }))
}
