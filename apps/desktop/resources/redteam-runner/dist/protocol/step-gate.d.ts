/**
 * Per-step tool gate.
 *
 * The target protocol (prompts/target-protocol.ts) says which step each seat
 * owns and which tools that step allows. This module is the mechanical half:
 * given the bound family and the CURRENT step, decide whether a tool call is
 * inside the step. It is deliberately small and side-effect free so it can be
 * called from a dispatch path without changing tool behavior when no step is
 * bound.
 *
 * Semantics:
 *   - book-keeping tools (record_finding, update_target_map, …) are always
 *     allowed — evidence capture must never be blocked by a step boundary;
 *   - a tool in the current step's allowlist is allowed;
 *   - a decision step (no tools) allows only book-keeping;
 *   - anything else is refused with the step id, the allowlist, and the two
 *     ways forward: cite a different step for the action, or advance the step.
 */
import { type ProtocolStep, type TargetFamily } from '../prompts/target-protocol.js';
/**
 * Tools that must work in every step: they record, read or adjudicate
 * evidence rather than touch the target.
 */
export declare const ALWAYS_ALLOWED_TOOLS: ReadonlySet<string>;
/** The verdict for one tool call against one step. */
export interface StepGateVerdict {
    /** True when the call may proceed. */
    allowed: boolean;
    /** The step the call was judged against. */
    stepId: string;
    /** Human-readable justification, naming the step and its allowlist. */
    reason: string;
}
/**
 * Look one step up by id.
 * @param family - the bound family.
 * @param stepId - the step id (e.g. `WIN-03`).
 * @returns the step, or undefined when the id names no step of that family.
 */
export declare function stepById(family: TargetFamily, stepId: string): ProtocolStep | undefined;
/**
 * Judge one tool call against the current step.
 * @param input - family, current step id, and the tool being called.
 * @returns the verdict; never throws.
 */
export declare function gateTool(input: {
    family: TargetFamily;
    stepId: string;
    tool: string;
}): StepGateVerdict;
/**
 * Throwing form of {@link gateTool} for dispatch paths that must stop.
 * @param input - family, current step id, and the tool being called.
 * @throws Error carrying the refusal reason when the call is outside the step.
 */
export declare function assertToolInStep(input: {
    family: TargetFamily;
    stepId: string;
    tool: string;
}): void;
/**
 * The next step in the family's order.
 * @param family - the bound family.
 * @param stepId - the step just completed.
 * @returns the next step, or undefined at the end of the protocol.
 */
export declare function nextStep(family: TargetFamily, stepId: string): ProtocolStep | undefined;
