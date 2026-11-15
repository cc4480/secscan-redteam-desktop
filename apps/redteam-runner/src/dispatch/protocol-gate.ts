/**
 * Dispatch-time protocol gate (A1).
 *
 * The plan is law: every tool call is judged against the engagement's current
 * protocol step before it executes. Bookkeeping is never blocked (evidence
 * capture outranks a step boundary), and an unbound engagement — no protocol
 * state at all — takes the legacy path untouched, so this gate can never turn a
 * working run into a dead one.
 *
 * The ONE sanctioned exception (A6): a seat that sees a live vulnerability may
 * attack it. It passes `protocolException` with a reason; the exception is
 * recorded on the state, so it shows up in the transcript instead of being an
 * invisible improvisation.
 */

import { type ActorRole, type EngagementPhase } from '../types.js'
import { type Ctx } from '../context.js'
import { type ToolCallRequest } from '@secscan/redteam-llm-router'
import { ALWAYS_ALLOWED_TOOLS, gateTool } from '../protocol/step-gate.js'
import { recordException } from '../protocol/state.js'
import { type DispatchResult } from './types.js'
import { optStr } from './prelude.js'

/** Tools that move or read protocol state itself — never judged by the step. */
const PROTOCOL_TOOLS: ReadonlySet<string> = new Set(['protocol_step'])

/**
 * Judge a call against the current protocol step.
 * @param ctx - the engagement context (carries the protocol state when bound).
 * @param phase - the current engagement phase, for the event record.
 * @param role - the acting seat, for the event record.
 * @param call - the tool call about to dispatch.
 * @returns a refusal result when the call is outside the step; undefined to proceed.
 */
export function checkProtocolGate(
  ctx: Ctx,
  phase: EngagementPhase,
  role: ActorRole,
  call: ToolCallRequest,
): DispatchResult | undefined {
  const state = ctx.protocol
  // Unbound: no protocol state means no opinion. Never a new way to block a run.
  if (state === undefined) return undefined
  if (PROTOCOL_TOOLS.has(call.name) || ALWAYS_ALLOWED_TOOLS.has(call.name)) return undefined
  const args = call.arguments ?? {}
  // The recorded exception path (A6): reason in, exception recorded, call proceeds.
  const exceptionReason = optStr(args['protocolException'])
  if (exceptionReason !== undefined && exceptionReason.trim() !== '') {
    try {
      const exception = recordException(state, { tool: call.name, reason: exceptionReason })
      ctx.events.append({
        phase,
        actor: role,
        action: 'protocol_exception',
        target: exception.stepId,
        result: `live-vulnerability exception for ${call.name}: ${exception.reason}`,
      })
      return undefined
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { result: message, target: state.stepId }
    }
  }
  const verdict = gateTool({ family: state.family, stepId: state.stepId, tool: call.name })
  if (verdict.allowed) return undefined
  ctx.events.append({
    phase,
    actor: role,
    action: 'protocol_refusal',
    target: state.stepId,
    result: verdict.reason,
  })
  return { result: verdict.reason, target: state.stepId }
}
