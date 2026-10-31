/**
 * PII redaction (v0.13.0) — the production safety case.
 *
 * Secrets (passwords, keys, hashes) were already redacted. Buyers also demand
 * PII handling: tool outputs routinely contain other people's data (error
 * pages echo emails, configs leak phone numbers, dumps contain ID-like
 * strings). This module redacts PII patterns from tool outputs BEFORE they
 * reach the audit log, the agent context, findings evidence, and reports.
 *
 * Deliberately conservative: we redact the well-known shapes (email, phone,
 * US-SSN-like, payment-card-like with a Luhn check) and document exactly what
 * we do NOT touch (IP addresses and hostnames stay — the agents need them to
 * reason about targets; usernames stay — they are usually the test account).
 * Over-redaction would blind the agents; under-redaction leaks PII. The
 * pattern list is exported so the manifest and docs state it plainly.
 */
/** The PII shapes we redact — exported for the manifest and docs. */
export declare function piiPatternLabels(): string[];
/**
 * Redact PII from text. Pure function — safe to apply to any tool output,
 * evidence string, or report fragment. Idempotent.
 */
export declare function redactPii(text: string): string;
/**
 * Heuristic: does this text still contain likely PII after redaction?
 * Used by tests and by the manifest's self-check line — not a guarantee,
 * stated honestly as a heuristic.
 */
export declare function likelyContainsPii(text: string): boolean;
