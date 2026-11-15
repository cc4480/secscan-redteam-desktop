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
import { type ProtocolStep, type TargetFamily } from '../prompts/target-protocol.js';
/** One recorded in-engagement exception (live-vulnerability attack path). */
export interface ProtocolException {
    /** The step the seat was in when it took the exception. */
    stepId: string;
    /** The tool the exception covered. */
    tool: string;
    /** Why the seat took it — required, never blank. */
    reason: string;
    /** ISO timestamp of the exception. */
    at: string;
}
/** The engagement's protocol position. */
export interface ProtocolState {
    /** The bound target family. */
    family: TargetFamily;
    /** The step every non-bookkeeping tool call is judged against. */
    stepId: string;
    /** Why the family was bound (declared / inferred / default). */
    reason: string;
    /** Recorded exceptions, appended in order. */
    exceptions: ProtocolException[];
}
/**
 * Bind a family and open its first step.
 * @param input - the engagement target and any declared families.
 * @returns the fresh protocol state.
 */
export declare function openProtocolState(input: {
    target: string;
    declared?: readonly string[];
}): ProtocolState;
/**
 * The step the state is currently in.
 * @param state - the protocol state.
 * @returns the step, or undefined when the id no longer resolves.
 */
export declare function currentStepOf(state: ProtocolState): ProtocolStep | undefined;
/**
 * Move to a step of the bound family.
 * @param state - the protocol state (mutated).
 * @param stepId - the step to move to.
 * @returns the moved-to step.
 * @throws Error when the id names no step of the bound family.
 */
export declare function advanceProtocol(state: ProtocolState, stepId: string): ProtocolStep;
/**
 * Record an in-engagement exception (live-vulnerability attack path).
 * @param state - the protocol state (mutated).
 * @param input - the tool and the reason; the reason must be substantive.
 * @returns the recorded exception.
 * @throws Error when the reason is missing or too short to be a justification.
 */
export declare function recordException(state: ProtocolState, input: {
    tool: string;
    reason: string;
    at?: string;
}): ProtocolException;
/**
 * Render the current position for a tool result or an event.
 * @param state - the protocol state.
 * @returns multi-line summary: family, current step, that step's allowlist,
 *   the family's full order, and any recorded exceptions.
 */
export declare function protocolSummary(state: ProtocolState): string;
