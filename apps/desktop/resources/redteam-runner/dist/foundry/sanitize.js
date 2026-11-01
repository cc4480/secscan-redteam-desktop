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
import { collectSecrets, redact } from '../events/redact.js';
const SECRET_KEY_NAME = /token|secret|password|passwd|pwd|credential|authorization|api[_-]?key|apikey/i;
/**
 * Derive endpoint shapes (route templates) from free text that may contain
 * URLs. Only path segments survive: numeric / hex / uuid segments become
 * {id}, query values are dropped, query names are kept only when they are
 * not secret-shaped. Hosts and schemes never appear in a shape.
 *
 * @param text - evidence text to scan for URLs and paths
 * @returns up to four unique shapes, in first-seen order
 */
export function endpointShapesFromText(text) {
    const shapes = [];
    const push = (shape) => {
        if (shape && !shapes.includes(shape) && shapes.length < 4)
            shapes.push(shape);
    };
    const urlPattern = /https?:\/\/[^\s'"<>)\]]+/gi;
    for (const match of text.matchAll(urlPattern)) {
        try {
            const url = new URL(match[0]);
            push(shapeOf(url.pathname, url.searchParams));
        }
        catch {
            /* an unparseable URL contributes nothing */
        }
    }
    if (shapes.length === 0) {
        const pathPattern = /(?:^|\s)(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+(?:\?[^\s'"<>]+)?)/g;
        for (const match of text.matchAll(pathPattern)) {
            const raw = match[1] ?? '';
            const q = raw.indexOf('?');
            const pathname = q >= 0 ? raw.slice(0, q) : raw;
            const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
            push(shapeOf(pathname, params));
        }
    }
    return shapes;
}
function shapeOf(pathname, params) {
    const segments = pathname
        .split('/')
        .filter(s => s.length > 0)
        .map((segment) => {
        let decoded = segment;
        try {
            decoded = decodeURIComponent(segment);
        }
        catch {
            /* keep the raw segment */
        }
        if (/^\d+$/.test(decoded))
            return '{id}';
        if (/^[0-9a-f]{8,}$/i.test(decoded))
            return '{id}';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded))
            return '{id}';
        if (!/^[A-Za-z0-9._~-]+$/.test(decoded))
            return '{seg}';
        return decoded.slice(0, 40);
    });
    const names = [...new Set([...params.keys()].filter(n => !SECRET_KEY_NAME.test(n) && /^[A-Za-z0-9_-]{1,24}$/.test(n)))].sort();
    const query = names.length > 0 ? `?${names.map(n => `${n}={}`).join('&')}` : '';
    return `/${segments.join('/')}${query}`;
}
/** Payload classes: the canonical forms a payload is bucketed into. */
export const PAYLOAD_CLASSES = [
    'union-select',
    'tautology-quote',
    'tautology-numeric',
    'tautology-numeric-comment',
    'comment-terminated',
    'script-tag',
    'svg-onload',
    'event-handler',
    'dotdot-slash',
    'dotdot-double',
    'dotdot-encoded',
    'loopback-literal',
    'loopback-hostname',
    'metadata-ip',
    'generic',
    'none',
];
/**
 * Bucket a raw payload into its class. The payload itself never persists —
 * only the class label does. Ordered: most specific first.
 *
 * @param payload - the raw payload (transient; never stored)
 * @returns the payload class label
 */
export function payloadClassOf(payload) {
    if (!payload || !payload.trim())
        return 'none';
    const p = payload;
    if (/169\.254\.169\.254/.test(p))
        return 'metadata-ip';
    if (/union\s+(all\s+)?select/i.test(p))
        return 'union-select';
    if (/'\s*or\s+'?\d+'?\s*=\s*'?\d+/i.test(p) || /"\s*or\s+"?\d+"?\s*=\s*"??\d+/i.test(p))
        return 'tautology-quote';
    if (/\bor\s+\d+\s*=\s*\d+\s*--/i.test(p))
        return 'tautology-numeric-comment';
    if (/\bor\s+\d+\s*=\s*\d+/i.test(p))
        return 'tautology-numeric';
    if (/--(\s|$)/.test(p) || /\/\*/.test(p))
        return 'comment-terminated';
    if (/<script[\s>]/i.test(p))
        return 'script-tag';
    if (/<svg[^>]*onload/i.test(p))
        return 'svg-onload';
    if (/on(error|load|click|focus)\s*=/i.test(p))
        return 'event-handler';
    if (/%2e%2e/i.test(p))
        return 'dotdot-encoded';
    if (/\.\.\/\.\.\//.test(p) || /\.\.\.\.\/\//.test(p))
        return 'dotdot-double';
    if (/\.\.\//.test(p) || /\.\.\\/.test(p))
        return 'dotdot-slash';
    if (/127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(p))
        return 'loopback-literal';
    if (/localhost/i.test(p))
        return 'loopback-hostname';
    return 'generic';
}
const DLP_RULES = [
    { name: 'url-with-host', pattern: /https?:\/\/[^\s/]/i },
    { name: 'ipv4-literal', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
    { name: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
    { name: 'hostname-with-tld', pattern: /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|co|uk|de|fr|info|biz|example|test|local|internal|corp)\b/i },
    { name: 'long-hex-token', pattern: /\b[0-9a-f]{32,}\b/i },
    { name: 'long-base64-token', pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/ },
    { name: 'secret-assignment', pattern: /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/i },
    { name: 'bearer-token', pattern: /\bBearer\s+\S+/i },
];
/**
 * Sanitize one candidate pattern. Fail-closed: any DLP hit, or the target
 * literal surviving projection, drops the case with reasons recorded.
 *
 * @param pattern - the projected pattern fields
 * @param opts - the engagement target (transient; used only as a tripwire)
 *   and the known secret literals (defaults to the environment's)
 * @returns the sanitized pattern, or the drop reasons
 */
export function sanitizePattern(pattern, opts = {}) {
    const secrets = opts.secrets ?? collectSecrets();
    const cleaned = redact(pattern, secrets);
    const serialized = JSON.stringify(cleaned);
    const reasons = [];
    for (const rule of DLP_RULES) {
        if (rule.pattern.test(serialized))
            reasons.push(`dlp:${rule.name}`);
    }
    if (serialized.includes('<redacted>'))
        reasons.push('redaction-marker-present');
    const target = (opts.target ?? '').trim();
    if (target) {
        if (serialized.includes(target))
            reasons.push('target-literal-present');
        try {
            const host = new URL(target.includes('://') ? target : `https://${target}`).hostname;
            if (host && serialized.includes(host))
                reasons.push('target-host-present');
        }
        catch {
            /* an unparseable target adds no tripwire */
        }
    }
    if (reasons.length > 0)
        return { ok: false, reasons };
    return { ok: true, pattern: cleaned };
}
//# sourceMappingURL=sanitize.js.map