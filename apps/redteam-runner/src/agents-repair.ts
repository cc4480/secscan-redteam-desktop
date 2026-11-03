/**
 * Tool-call repair (RC Item 6) — the bounded repair exchange for one
 * malformed tool call.
 *
 * Extracted from agents.ts in a structural split (no file under src/ may
 * exceed 300 lines). The body is the original closure, moved verbatim: one
 * side-channel completion sees the call and its result, the model answers
 * with one corrected call, and the corrected call re-runs through
 * dispatchTool — every gate — with the corrected result becoming the
 * effective result. The only edits are that the per-loop counters
 * (spent / cap / closed) now travel in the budget object and are read
 * through it; every decision, event string and prompt is unchanged.
 */

import {
  type AgentRole,
  type ChatMessage,
  type ChatResult,
  type JsonSchemaTool,
  type ToolCallRequest,
} from '@secscan/redteam-llm-router'
import { type Ctx } from './context.js'
import { type EngagementPhase } from './types.js'
import { type StepJournal } from './harness2/steps.js'
import { tokenMeterFor } from './harness2/trajectory-normalize.js'
import { type DispatchResult } from './dispatch/types.js'
import { dispatchTool } from './dispatch/router.js'
import { buildRepairPrompt } from './agents-budget.js'

/** One repair exchange: called with the refused call and its result. */
export type RepairAttempt = (call: ToolCallRequest, d: DispatchResult) => Promise<DispatchResult>

/** The per-invocation repair budget and its live state. */
export interface RepairBudget {
  /** The most repair exchanges this loop invocation may spend. */
  readonly cap: number
  /** Exchanges spent so far. */
  spent: number
  /** Set when the model answered a repair prompt with no tool call. */
  closed: boolean
}

export interface RepairDeps {
  ctx: Ctx
  role: AgentRole
  phase: EngagementPhase
  system: string
  tools: JsonSchemaTool[]
  complete: (role: AgentRole, messages: ChatMessage[], opts?: { tools: JsonSchemaTool[] }) => Promise<ChatResult>
  steps: StepJournal
  budget: RepairBudget
}

export function createRepairExchange(deps: RepairDeps): RepairAttempt {
  const { ctx, role, phase, system, tools, complete, steps, budget } = deps
  return async (call: ToolCallRequest, d: DispatchResult): Promise<DispatchResult> => {
    budget.spent++
    const defect = d.repairable ?? ''
    const unknownTool = defect.startsWith('unknown tool')
    const logRepair = (outcome: string, detail: string): void => {
      ctx.events.append({
        phase,
        actor: 'runner',
        action: 'tool_repair',
        target: d.target,
        result: `tool_repair (${budget.spent}/${budget.cap}) outcome=${outcome} — ${detail}`,
      })
    }
    let res: ChatResult
    try {
      res = await complete(role, [
        { role: 'system', content: system },
        { role: 'assistant', content: '(tool calls)', toolCalls: [call] },
        { role: 'tool', toolCallId: call.id, content: d.result },
        { role: 'user', content: buildRepairPrompt(call, d, tools, budget.spent, budget.cap) },
      ], { tools })
    } catch (err) {
      logRepair('error', `the repair completion failed: ${(err as Error).message}. Original result stands.`)
      return d
    }
    tokenMeterFor(ctx).record(res.usage)
    const fix = res.toolCalls && res.toolCalls.length > 0 ? res.toolCalls[0] : undefined
    if (!fix) {
      budget.closed = true
      logRepair(
        'no-correction',
        `the repair exchange for ${call.name} returned no tool call (defect: ${defect}); repair is closed for this loop. Original result stands.`,
      )
      return d
    }
    if (!unknownTool && fix.name !== call.name) {
      logRepair(
        'failed',
        `the corrected call names ${fix.name}, not ${call.name} — the tool name may change only for an unknown-tool defect (this defect: ${defect}). Original result stands.`,
      )
      return d
    }
    if (unknownTool && tools.length > 0 && !tools.some(t => t.name === fix.name)) {
      logRepair('failed', `the corrected call names ${fix.name}, which is not one of the offered tools. Original result stands.`)
      return d
    }
    steps.tool(fix.name, JSON.stringify(fix.arguments ?? {}))
    const corrected = await dispatchTool(ctx, role, phase, fix)
    if (corrected.repairable === undefined && !/^(DENIED|HALTED)/i.test(corrected.result)) {
      logRepair('repaired', `${call.name} defect: ${defect}; corrected call ${fix.name} re-dispatched and executed: ${corrected.result.slice(0, 300)}`)
      return corrected
    }
    logRepair('failed', `corrected call ${fix.name} was refused: ${corrected.result.slice(0, 300)}. Original result stands.`)
    return d
  }
}
