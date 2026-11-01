/**
 * Fail-closed case sanitizer (Foundry Phase-1 pipeline, in-app port).
 *
 * A candidate case is built ONLY from projected pattern fields — raw
 * evidence, titles, hosts, URLs, and response bodies are inputs to the
 * projection, never fields of the case. Before anything persists:
 *   1. the projected pattern passes through the runner's redaction
 *      machinery (src/events/redact.ts),
 *   2. the serialized pattern is re-scanned by an independent DLP pass —
 *      any URL, IP literal, email, hostname-with-TLD, long hex/base64
 *      token, secret-shaped assignment, or the engagement's own target
 *      literal rejects the case outright. Doubt drops the case; nothing
 *      is repaired into compliance.
 */
import type { CasePattern } from './store.js';
/**
 * Derive endpoint shapes (route templates) from free text that may contain
 * URLs. Only path segments survive: numeric / hex / uuid segments become
 * {id}, query values are dropped, query names are kept only when they are
 * not secret-shaped. Hosts and schemes never appear in a shape.
 *
 * @param text - evidence text to scan for URLs and paths
 * @returns up to four unique shapes, in first-seen order
 */
export declare function endpointShapesFromText(text: string): string[];
/** Payload classes: the canonical forms a payload is bucketed into. */
export declare const PAYLOAD_CLASSES: readonly ["union-select", "tautology-quote", "tautology-numeric", "tautology-numeric-comment", "comment-terminated", "script-tag", "svg-onload", "event-handler", "dotdot-slash", "dotdot-double", "dotdot-encoded", "loopback-literal", "loopback-hostname", "metadata-ip", "generic", "none"];
/**
 * Bucket a raw payload into its class. The payload itself never persists —
 * only the class label does. Ordered: most specific first.
 *
 * @param payload - the raw payload (transient; never stored)
 * @returns the payload class label
 */
export declare function payloadClassOf(payload: string | undefined): string;
/** The outcome of the fail-closed sanitizer. */
export type SanitizeOutcome = {
    ok: true;
    pattern: CasePattern;
} | {
    ok: false;
    reasons: string[];
};
/**
 * Sanitize one candidate pattern. Fail-closed: any DLP hit, or the target
 * literal surviving projection, drops the case with reasons recorded.
 *
 * @param pattern - the projected pattern fields
 * @param opts - the engagement target (transient; used only as a tripwire)
 *   and the known secret literals (defaults to the environment's)
 * @returns the sanitized pattern, or the drop reasons
 */
export declare function sanitizePattern(pattern: CasePattern, opts?: {
    target?: string;
    secrets?: string[];
}): SanitizeOutcome;
