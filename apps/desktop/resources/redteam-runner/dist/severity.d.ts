/**
 * Finding-severity coercion (shared).
 *
 * Severities arrive from LLM-authored text (VERDICTS blocks, reporter
 * JSON) — untrusted formatting, never runner-validated at the source.
 * One whitelist, applied everywhere a severity becomes a Finding:
 * anything outside the five known values collapses to "low". Never
 * propagated verbatim, never fatal.
 */
import type { Finding } from './types.js';
/** Coerce an untrusted severity string into a Finding severity. */
export declare function coerceSeverity(s: string): Finding['severity'];
