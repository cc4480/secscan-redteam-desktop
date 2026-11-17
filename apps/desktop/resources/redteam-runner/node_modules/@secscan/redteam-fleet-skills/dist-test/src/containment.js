/**
 * DISPOSITION NOTE: this module is a library-only reference implementation;
 * it is NOT the production refusal path. Production refusal handling is the
 * runner's policy-containment (chartered completion seam) together with the
 * llm-router classifier/refusal modules. Classifier convergence between this
 * module and the production path is deliberately deferred.
 */
/** Policy/classifier wording that marks a rejection as content-policy. */
const POLICY_PATTERN = /content[_\s-]?policy|safety|moderation|classifier|policy violation|violates (?:our |the )?policy|harmful content|request (?:was )?rejected (?:due to|by)|blocked by (?:the )?(?:safety|policy|moderation)/i;
/** Definitive transport error codes and wording. */
const NETWORK_CODE_PATTERN = /\b(?:econn\w*|enotfound|eai_again|etimedout)\b/i;
/** Broader network-failure wording, used when no status class decided it. */
const NETWORK_WORDING_PATTERN = /fetch failed|network error|socket hang up|connection (?:reset|refused|closed|aborted)|dns (?:lookup|resolution)|timed out/i;
/**
 * Classifies one failed call from its HTTP status and error text. Order is
 * decisive: 429 is rate limiting; a 400/403 (or status-less) failure whose
 * text carries policy, safety, moderation, or classifier wording is a
 * content-policy rejection; transport error codes are network failures; a
 * 5xx status is a server failure; broader network wording is a network
 * failure; anything else is unknown. A 400/403 without policy wording is
 * unknown, not policy — a bad request is a defect to repair, not a refusal.
 * @param input - the failure's HTTP status (when any) and body/message text.
 * @returns the error class.
 */
export function classifyError(input) {
    const text = `${input.body ?? ''}\n${input.message ?? ''}`;
    if (input.status === 429)
        return 'rate_limit';
    if ((input.status === 400 || input.status === 403 || input.status === undefined) &&
        POLICY_PATTERN.test(text)) {
        return 'content_policy';
    }
    if (NETWORK_CODE_PATTERN.test(text))
        return 'network';
    if (input.status !== undefined && input.status >= 500 && input.status <= 599)
        return 'server';
    if (NETWORK_WORDING_PATTERN.test(text))
        return 'network';
    return 'unknown';
}
/**
 * Plans containment for a step from its failure history. Failures for other
 * steps do not count: the history is read for the step of the latest
 * failure. Rules, in order:
 *
 * - Any class at 3 failures of the same step escalates.
 * - A first content-policy failure re-issues with the verified engagement
 *   record attached and the step narrowed — the rejection may have happened
 *   because the call carried no authorization context.
 * - A second content-policy failure reroutes the step to a different seat,
 *   model, or tool; the record was attached and it still failed.
 * - Rate-limit, server, network, and unknown failures narrow-and-retry.
 *
 * @param failures - recorded step failures, oldest first.
 * @returns the plan for the latest failure's step; an empty history yields
 * an escalation with an empty step id and error body, so a caller that has
 * lost its history fails loud instead of retrying blind.
 */
export function planContainment(failures) {
    const latest = failures[failures.length - 1];
    if (!latest)
        return { kind: 'escalate', stepId: '', preserveErrorBody: '' };
    const stepFailures = failures.filter((failure) => failure.stepId === latest.stepId);
    const count = stepFailures.length;
    const preserveErrorBody = latest.errorBody;
    if (count >= 3)
        return { kind: 'escalate', stepId: latest.stepId, preserveErrorBody };
    if (latest.errorClass === 'content_policy') {
        return count === 1
            ? { kind: 'reissue-with-record', stepId: latest.stepId, preserveErrorBody }
            : { kind: 'reroute', stepId: latest.stepId, preserveErrorBody };
    }
    return { kind: 'narrow-and-retry', stepId: latest.stepId, preserveErrorBody };
}
