/**
 * Finding-severity coercion (shared).
 *
 * Severities arrive from LLM-authored text (VERDICTS blocks, reporter
 * JSON) — untrusted formatting, never runner-validated at the source.
 * One whitelist, applied everywhere a severity becomes a Finding:
 * anything outside the five known values collapses to "low". Never
 * propagated verbatim, never fatal.
 */
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
/** Coerce an untrusted severity string into a Finding severity. */
export function coerceSeverity(s) {
    const l = s.toLowerCase();
    return (VALID_SEVERITIES.has(l) ? l : 'low');
}
//# sourceMappingURL=severity.js.map