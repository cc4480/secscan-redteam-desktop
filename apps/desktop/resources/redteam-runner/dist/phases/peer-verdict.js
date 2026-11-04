import { extractJsonBlock } from '../util.js';
/** Checker preference: the Architect owns review; then the coordinator
 * (the sign-off seat), reporter, recon, exploiter. The producer is
 * removed from the list before picking — see selectChecker. */
export const CHECKER_PREFERENCE = ['architect', 'coordinator', 'reporter', 'recon', 'exploiter'];
/**
 * The checker for a finding: the first preferred seat that is NOT the
 * producer. Pure and total — for every producer (including 'runner'
 * and an absent stamp) some other seat is returned, so the pass can
 * never seat a finding's producer as its own checker.
 */
export function selectChecker(producer) {
    for (const seat of CHECKER_PREFERENCE) {
        if (seat !== producer)
            return seat;
    }
    // Unreachable: the preference list holds five distinct seats and a
    // producer can exclude at most one. Fail loud if that ever changes.
    throw new Error(`[peer-review] no checker seat available for producer ${String(producer)}`);
}
export const SEVERITY_LADDER = ['info', 'low', 'medium', 'high', 'critical'];
export function coerceSeverity(s) {
    const l = s.toLowerCase();
    return SEVERITY_LADDER.includes(l)
        ? l
        : 'low';
}
export function oneNotchDown(sev) {
    const i = SEVERITY_LADDER.indexOf(coerceSeverity(sev));
    return i > 0 ? SEVERITY_LADDER[i - 1] : null;
}
const VERDICTS = ['upheld', 'downgraded', 'needs-evidence', 'killed'];
/** Parse the checker's answer. Anything off-shape is null — the caller
 * records a failed challenge, never a guessed verdict. */
export function parsePeerVerdict(text) {
    const parsed = extractJsonBlock(text);
    if (!parsed || typeof parsed.verdict !== 'string')
        return null;
    if (!VERDICTS.includes(parsed.verdict))
        return null;
    return {
        verdict: parsed.verdict,
        severity: typeof parsed.severity === 'string' ? parsed.severity : undefined,
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 500) : '',
    };
}
//# sourceMappingURL=peer-verdict.js.map