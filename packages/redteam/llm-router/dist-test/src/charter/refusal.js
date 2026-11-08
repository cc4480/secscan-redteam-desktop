/**
 * Refusal classification (spec §3). Behavioral, not keyword-only: an
 * explicit refusal counts, and so does a soft refusal — for an
 * artifact-producing task, the test is whether the produced artifact is
 * present and passes the caller's check, not whether the prose sounded
 * cooperative. Deterministic heuristics only; a model-based judge is a
 * later refinement and is never the v1 gate.
 */
const EXPLICIT_REFUSAL_PATTERNS = [
    /\bi can(?:not|'t| not)\b[^.]*\b(?:help|assist|provide|generate|create|write)\b/i,
    /\bi'm unable to\b/i,
    /\bi am unable to\b/i,
    /\bi (?:won't|will not) (?:help|assist|provide|generate|create)\b/i,
    /\bnot something i can (?:help|assist) with\b/i,
    /\bagainst (?:my|the) (?:policy|safety guidelines)\b/i,
    /\bi must decline\b/i,
];
const PROSE_SUBSTITUTE_PATTERNS = [
    /\binstead,? i can (?:explain|describe|offer)\b/i,
    /\bhere is how (?:one|you) (?:could|might|would)\b/i,
    /\bi can (?:explain|describe) (?:how|why|the)\b/i,
];
/**
 * Classify one provider response.
 *
 * Order matters: an explicit refusal is a refusal even when it also
 * fails the artifact check; an artifact-task response with no explicit
 * refusal whose artifact is absent or fails its check is a soft refusal;
 * a prose substitute offered instead of the artifact is a soft refusal
 * even when no artifact check was supplied.
 *
 * @param result - the provider result to classify
 * @param task - the task context (artifact expectations)
 * @returns the class and the rule that decided it
 */
export function classifyResponse(result, task) {
    const text = result.text ?? '';
    for (const pattern of EXPLICIT_REFUSAL_PATTERNS) {
        if (pattern.test(text)) {
            return { refusalClass: 'refusal', reason: `explicit refusal pattern: ${pattern.source}` };
        }
    }
    if (task.artifactTask) {
        if (task.artifactCheck !== undefined && !task.artifactCheck(text)) {
            return { refusalClass: 'soft_refusal', reason: 'artifact absent or failed the artifact check' };
        }
        for (const pattern of PROSE_SUBSTITUTE_PATTERNS) {
            if (pattern.test(text)) {
                return { refusalClass: 'soft_refusal', reason: `prose substitute pattern: ${pattern.source}` };
            }
        }
    }
    return { refusalClass: 'ok', reason: 'no refusal signal' };
}
