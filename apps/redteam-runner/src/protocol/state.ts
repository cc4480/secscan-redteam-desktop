/**
 * Protocol step state (A1): the engagement's bound family and the ONE step its
 * seats may act in right now.
 *
 * The state is the mechanical half of the plan being law: dispatch reads it and
 * refuses any tool call outside the current step (dispatch/protocol-gate.ts),
 * and the coordinator moves it with the `protocol_step` tool. The single
 * sanctioned exception — a seat that sees a live vulnerability inside an
 * engagement may attack it — is recorded here with its reason, so an exception
 * is a recorded fact, never a silent improvisation (A6).
 */

import {
  TARGET_PROTOCOLS,
  bindTargetFamily,
  type ProtocolStep,
  type TargetFamily,
} from '../prompts/target-protocol.js'

/** One recorded in-engagement exception (live-vulnerability attack path). */
export interface ProtocolException {
  /** The step the seat was in when it took the exception. */
  stepId: string
  /** The tool the exception covered. */
  tool: string
  /** Why the seat took it — required, never blank. */
  reason: string
  /** ISO timestamp of the exception. */
  at: string
}

/** The engagement's protocol position. */
export interface ProtocolState {
  /** The bound target family. */
  family: TargetFamily
  /** The step every non-bookkeeping tool call is judged against. */
  stepId: string
  /** Why the family was bound (declared / inferred / default). */
  reason: string
  /** Recorded exceptions, appended in order. */
  exceptions: ProtocolException[]
}

/**
 * Bind a family and open its first step.
 * @param input - the engagement target and any declared families.
 * @returns the fresh protocol state.
 */
export function openProtocolState(input: {
  target: string
  declared?: readonly string[]
}): ProtocolState {
  const binding = bindTargetFamily(input)
  const first = TARGET_PROTOCOLS[binding.family].steps[0]
  return {
    family: binding.family,
    stepId: first ? first.id : '',
    reason: binding.reason,
    exceptions: [],
  }
}

/**
 * The step the state is currently in.
 * @param state - the protocol state.
 * @returns the step, or undefined when the id no longer resolves.
 */
export function currentStepOf(state: ProtocolState): ProtocolStep | undefined {
  return TARGET_PROTOCOLS[state.family].steps.find(step => step.id === state.stepId)
}

/**
 * Move to a step of the bound family.
 * @param state - the protocol state (mutated).
 * @param stepId - the step to move to.
 * @returns the moved-to step.
 * @throws Error when the id names no step of the bound family.
 */
export function advanceProtocol(state: ProtocolState, stepId: string): ProtocolStep {
  const step = TARGET_PROTOCOLS[state.family].steps.find(candidate => candidate.id === stepId)
  if (!step) {
    const known = TARGET_PROTOCOLS[state.family].steps.map(candidate => candidate.id).join(', ')
    throw new Error(
      `[protocol] "${stepId}" is not a step of family ${state.family}. Steps: ${known}.`,
    )
  }
  state.stepId = step.id
  return step
}

/**
 * Record an in-engagement exception (live-vulnerability attack path).
 * @param state - the protocol state (mutated).
 * @param input - the tool and the reason; the reason must be substantive.
 * @returns the recorded exception.
 * @throws Error when the reason is missing or too short to be a justification.
 */
export function recordException(
  state: ProtocolState,
  input: { tool: string; reason: string; at?: string },
): ProtocolException {
  const reason = input.reason.trim()
  if (reason.length < 12) {
    throw new Error(
      '[protocol] a live-vulnerability exception needs a real reason naming what was seen '
      + '(at least 12 characters) — an unexplained exception is an improvisation.',
    )
  }
  const exception: ProtocolException = {
    stepId: state.stepId,
    tool: input.tool,
    reason,
    at: input.at ?? new Date().toISOString(),
  }
  state.exceptions.push(exception)
  return exception
}

/**
 * Render the current position for a tool result or an event.
 * @param state - the protocol state.
 * @returns multi-line summary: family, current step, that step's allowlist,
 *   the family's full order, and any recorded exceptions.
 */
export function protocolSummary(state: ProtocolState): string {
  const protocol = TARGET_PROTOCOLS[state.family]
  const current = currentStepOf(state)
  const order = protocol.steps.map(step =>
    step.id === state.stepId ? `${step.id} <- current` : step.id,
  ).join(' -> ')
  const allowlist = current && current.tools.length > 0
    ? current.tools.map(tool => `\`${tool}\``).join(', ')
    : '_none (decision step — bookkeeping only)_'
  const lines = [
    `Protocol family: ${protocol.family} (${protocol.label}) — bound: ${state.reason}.`,
    `Current step: ${state.stepId}${current ? ` — ${current.title} (owner: ${current.owner})` : ''}`,
    `Allowed in this step: ${allowlist}`,
    `Order: ${order}`,
    current ? `Closes when: ${current.done}` : '',
  ].filter(line => line !== '')
  if (state.exceptions.length > 0) {
    lines.push(`Recorded exceptions: ${state.exceptions.length}`)
    for (const exception of state.exceptions) {
      lines.push(`- ${exception.at} ${exception.stepId} \`${exception.tool}\` — ${exception.reason}`)
    }
  }
  return lines.join('\n')
}
