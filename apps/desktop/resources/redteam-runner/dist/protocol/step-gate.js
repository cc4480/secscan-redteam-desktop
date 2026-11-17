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
import { TARGET_PROTOCOLS, } from '../prompts/target-protocol.js';
/**
 * Tools that must work in every step: they record, read or adjudicate
 * evidence rather than touch the target.
 */
export const ALWAYS_ALLOWED_TOOLS = new Set([
    'record_finding',
    'record_killed',
    'record_item_verdict',
    'query_registry',
    'update_target_map',
    'get_coverage',
    'get_findings',
    'get_proof',
    'reverify',
    'engagement_status',
    'engagement_report',
    // Reading back an output the runner itself spilled. This never touches the
    // target: it is the second half of a tool result the seat already received, and
    // without it a seat is blind to everything past the spill cap. Observed live: a
    // registry query spilled at WIN-01 and the read that would have consumed it was
    // refused as "outside step WIN-01".
    'read_spill',
]);
/**
 * Build the refusal reason for a tool outside the step.
 * @param stage - the step being judged.
 * @param tool - the tool that was called.
 * @returns the reason string, with both ways forward stated.
 */
function refusal(stage, tool) {
    const allowlist = stage.tools.length > 0 ? stage.tools.map(name => `\`${name}\``).join(', ') : '_none (decision step)_';
    return (`[protocol] \`${tool}\` is outside step ${stage.id} (${stage.title}). `
        + `Allowed here: ${allowlist}. `
        + 'Either cite the step this action serves, or advance to the step that allows it — '
        + 'a tool call without a step is a seat working without a plan.');
}
/**
 * Look one step up by id.
 * @param family - the bound family.
 * @param stepId - the step id (e.g. `WIN-03`).
 * @returns the step, or undefined when the id names no step of that family.
 */
export function stepById(family, stepId) {
    return TARGET_PROTOCOLS[family].steps.find(step => step.id === stepId);
}
/**
 * Judge one tool call against the current step.
 * @param input - family, current step id, and the tool being called.
 * @returns the verdict; never throws.
 */
export function gateTool(input) {
    const stage = stepById(input.family, input.stepId);
    if (stage === undefined) {
        const known = TARGET_PROTOCOLS[input.family].steps.map(step => step.id).join(', ');
        return {
            allowed: false,
            stepId: input.stepId,
            reason: `[protocol] unknown step "${input.stepId}" for family ${input.family}. `
                + `Known steps: ${known}.`,
        };
    }
    if (ALWAYS_ALLOWED_TOOLS.has(input.tool)) {
        return {
            allowed: true,
            stepId: stage.id,
            reason: `[protocol] \`${input.tool}\` records or reads evidence; allowed in every step.`,
        };
    }
    if (stage.tools.includes(input.tool)) {
        return {
            allowed: true,
            stepId: stage.id,
            reason: `[protocol] \`${input.tool}\` is in step ${stage.id}'s allowlist.`,
        };
    }
    return { allowed: false, stepId: stage.id, reason: refusal(stage, input.tool) };
}
/**
 * Throwing form of {@link gateTool} for dispatch paths that must stop.
 * @param input - family, current step id, and the tool being called.
 * @throws Error carrying the refusal reason when the call is outside the step.
 */
export function assertToolInStep(input) {
    const verdict = gateTool(input);
    if (!verdict.allowed)
        throw new Error(verdict.reason);
}
/**
 * The next step in the family's order.
 * @param family - the bound family.
 * @param stepId - the step just completed.
 * @returns the next step, or undefined at the end of the protocol.
 */
export function nextStep(family, stepId) {
    const steps = TARGET_PROTOCOLS[family].steps;
    const index = steps.findIndex(step => step.id === stepId);
    if (index < 0)
        return undefined;
    return steps[index + 1];
}
//# sourceMappingURL=step-gate.js.map