/**
 * The agent driver (v0.19.0 refactor — extracted from phases.ts).
 *
 * agentLoop is the thin REASON → ACT → OBSERVE loop over the model router:
 * promptCtx builds each role's context, extractJsonBlock parses structured
 * model output, and commanderRedirect / blackout / halt plumbing keeps the
 * loop bounded and safe. HaltError is the loop's stop signal.
 */
import { type AgentRole, type JsonSchemaTool } from '@secscan/redteam-llm-router'
import { type DeliverableSpec, type RoundCaps } from './turn-integrity.js'
import { type EngagementMode, type EngagementPhase, type RulesOfEngagement } from './types.js'
import { type TargetId } from './targets.js'
import { type Ctx } from './context.js'
export type { DeliverableSpec, RoundCaps } from './turn-integrity.js'
export declare function agentLoop(ctx: Ctx, role: AgentRole, phase: EngagementPhase, system: string, user: string, tools: JsonSchemaTool[], maxTurns: number, opts?: {
  /** Called when the model stops calling tools. Return a follow-up prompt to
     *  keep the phase going, or null to finish the phase. */
  onIdle?: () => string | null
  /**
     * Progress-aware round caps (ZimZilla port, 2026-10-23). Per-call
     * override of config.softRoundCap / config.hardRoundCap.
     */
  roundCaps?: RoundCaps
  /** When declared, the turn is not finished until this file exists. */
  deliverable?: DeliverableSpec
}): Promise<string>
export declare function promptCtx(ctx: Ctx): {
  mode: EngagementMode
  objective: string
  target: string
  scopeHosts: string[]
  roe: RulesOfEngagement
  fullBattery?: boolean
  targets?: TargetId[]
  localSandbox?: boolean
}
export declare function commanderRedirect(ctx: Ctx, reason: string): Promise<string>
