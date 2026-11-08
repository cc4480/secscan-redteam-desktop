/**
 * Sanitizer egress hook (spec §4), following the Foundry sanitizer
 * pattern: replace what is known (per-engagement pseudonyms, generic
 * secret shapes), then independently re-scan the output — any
 * high-confidence secret still present fails the call closed. A
 * sanitizer that cannot prove its output is clean sends nothing.
 *
 * Findings report KINDS and counts only. Secret values never appear in
 * results, errors, or logs produced by this module.
 */
/** Sanitization could not prove its output clean. Always fatal for the call. */
export class SanitizerError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SanitizerError';
    }
}
const REDACTED = '[REDACTED]';
const SECRET_PATTERNS = [
    {
        kind: 'private-key',
        pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        detectPattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
        replace: () => REDACTED,
    },
    { kind: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => REDACTED },
    { kind: 'api-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: () => REDACTED },
    {
        kind: 'jwt',
        pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        replace: () => REDACTED,
    },
    {
        kind: 'bearer-token',
        pattern: /\bBearer\s+\S{10,}/gi,
        replace: () => `Bearer ${REDACTED}`,
    },
    {
        kind: 'password-assignment',
        pattern: /\b(password|passwd|pwd)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
        replace: (match) => {
            const label = match.match(/^(password|passwd|pwd)(\s*[:=]\s*)/i);
            return `${label?.[1] ?? 'password'}${label?.[2] ?? ': '}${REDACTED}`;
        },
    },
];
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/**
 * The secret kinds still detectable in a text. Used for the fail-closed
 * re-scan; `[REDACTED]` placeholders are outputs, not hits.
 *
 * @param text - the text to scan
 * @returns the kinds found (no values, no positions)
 */
export function findSecretKinds(text) {
    const kinds = [];
    for (const { kind, pattern, detectPattern } of SECRET_PATTERNS) {
        const detector = detectPattern ?? pattern;
        detector.lastIndex = 0;
        // A match that already carries the redaction marker is sanitizer
        // output (a kept label with its value replaced), not a survivor.
        const hits = [...text.matchAll(detector)].filter(match => !match[0].includes(REDACTED));
        if (hits.length > 0)
            kinds.push(kind);
    }
    return kinds;
}
function bump(findings, kind, by = 1) {
    findings[kind] = (findings[kind] ?? 0) + by;
}
/**
 * Sanitize one text: explicit pseudonyms first (longest term first, so a
 * full name is replaced before a surname inside it), then generic secret
 * shapes, then emails to stable per-text pseudonyms (EMAIL-1, EMAIL-2 in
 * first-appearance order). The result is re-scanned; any surviving
 * secret kind throws instead of returning tainted text.
 *
 * @param text - the text to sanitize
 * @param pseudonyms - per-engagement map of literal term → pseudonym, held by the caller
 * @returns the sanitized text and finding counts
 * @throws SanitizerError when a secret kind survives sanitization
 */
export function sanitizeText(text, pseudonyms = {}) {
    const findings = {};
    let out = text;
    const terms = Object.entries(pseudonyms)
        .filter(([term]) => term.length > 0)
        .sort((a, b) => b[0].length - a[0].length);
    for (const [term, pseudonym] of terms) {
        const parts = out.split(term);
        if (parts.length > 1) {
            bump(findings, 'pseudonym', parts.length - 1);
            out = parts.join(pseudonym);
        }
    }
    for (const { kind, pattern, replace } of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        out = out.replace(pattern, (match) => {
            bump(findings, kind);
            return replace(match);
        });
    }
    const emailPseudonyms = new Map();
    out = out.replace(EMAIL_PATTERN, (email) => {
        bump(findings, 'email');
        let pseudonym = emailPseudonyms.get(email);
        if (pseudonym === undefined) {
            pseudonym = `EMAIL-${emailPseudonyms.size + 1}`;
            emailPseudonyms.set(email, pseudonym);
        }
        return pseudonym;
    });
    const survivors = findSecretKinds(out);
    if (survivors.length > 0) {
        throw new SanitizerError(`sanitizer failed closed: secret kinds survived sanitization: ${survivors.join(', ')}`);
    }
    return { text: out, findings };
}
/**
 * Sanitize every message's content. Originals are never mutated; tool
 * call arguments are model-bound content too and are left to the caller
 * (they are structured tool input, not prose egress).
 *
 * @param messages - the messages to sanitize
 * @param pseudonyms - per-engagement pseudonym map
 * @returns new messages with sanitized content, and combined finding counts
 * @throws SanitizerError when any message fails closed
 */
export function sanitizeMessages(messages, pseudonyms = {}) {
    const combined = {};
    const sanitized = messages.map((message) => {
        const { text, findings } = sanitizeText(message.content, pseudonyms);
        for (const [kind, count] of Object.entries(findings))
            bump(combined, kind, count);
        return text === message.content ? message : { ...message, content: text };
    });
    return { messages: sanitized, findings: combined };
}
