"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUsername = parseUsername;
exports.detectAuthMethod = detectAuthMethod;
exports.createBasicAuth = createBasicAuth;
/**
 * Parse a username to detect its format and extract domain/user components.
 *
 * Supported formats:
 * - Local: "Administrator" -> { user: "Administrator", domain: "", format: "local" }
 * - Domain: "DOMAIN\user" -> { user: "user", domain: "DOMAIN", format: "domain" }
 * - UPN: "user@domain.com" -> { user: "user", domain: "domain.com", format: "upn" }
 */
function parseUsername(username) {
    if (username.includes('\\')) {
        const [domain, user] = username.split('\\', 2);
        return { user, domain, format: 'domain' };
    }
    if (username.includes('@')) {
        const [user, domain] = username.split('@', 2);
        return { user, domain, format: 'upn' };
    }
    return { user: username, domain: '', format: 'local' };
}
/**
 * Detect the appropriate authentication method based on username format.
 */
function detectAuthMethod(username) {
    const parsed = parseUsername(username);
    return parsed.format === 'local' ? 'basic' : 'ntlm';
}
/**
 * Create a Basic authentication header string.
 */
function createBasicAuth(username, password) {
    return ('Basic ' + Buffer.from(`${username}:${password}`, 'utf8').toString('base64'));
}
