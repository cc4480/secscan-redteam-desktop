import { SQLI_VARIANTS, XSS_VARIANTS, CMDI_VARIANTS, SSTI_VARIANTS, XXE_VARIANTS } from "./injection.js";
import { TRAVERSAL_VARIANTS, SSRF_VARIANTS, REDIRECT_VARIANTS } from "./traversal.js";
import { AUTH_VARIANTS } from "./auth.js";
import { HEADER_VARIANTS } from "./headers.js";
const LIBRARIES = {
    sqli: SQLI_VARIANTS,
    xss: XSS_VARIANTS,
    cmdi: CMDI_VARIANTS,
    ssti: SSTI_VARIANTS,
    xxe: XXE_VARIANTS,
    traversal: TRAVERSAL_VARIANTS,
    ssrf: SSRF_VARIANTS,
    redirect: REDIRECT_VARIANTS,
    auth: AUTH_VARIANTS,
    headers: HEADER_VARIANTS,
};
/** All payloads for one class (the curated library, uncut). */
export function libraryForClass(cls) {
    return LIBRARIES[cls];
}
/** Total payloads across every library. */
export function totalLibrarySize() {
    return Object.keys(LIBRARIES).reduce((n, c) => n + LIBRARIES[c].length, 0);
}
/**
 * Which variant classes apply to a battery item. Order matters: SSRF is
 * checked before open-redirect because SSRF items discuss redirect chains.
 */
export function classifyItem(item) {
    const text = `${item.owasp} ${item.name} ${item.brief} ${item.what}`.toLowerCase();
    const has = (...subs) => subs.some((s) => text.includes(s));
    // Word-boundary match for short terms ("tls" must not match "sysctls").
    const hasWord = (...words) => words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
    const out = [];
    // SSRF first — its items mention redirect chains; don't misclassify.
    if (has("ssrf", "server-side request forgery"))
        out.push("ssrf");
    else if (has("open redirect", "unvalidated redirect", "redirect validation"))
        out.push("redirect");
    if (has("sql injection", "sqli", "sql syntax"))
        out.push("sqli");
    if (has("xss", "cross-site scripting", "cross site scripting"))
        out.push("xss");
    if (has("command injection", "os command", "shell injection"))
        out.push("cmdi");
    if (has("ssti", "template injection", "server-side template"))
        out.push("ssti");
    if (has("xxe", "xml external entity", "external entity"))
        out.push("xxe");
    if (has("path traversal", "directory traversal", "traversal"))
        out.push("traversal");
    // Host-protocol context (SMB/RDP/WinRM/LDAP/NFS/Kerberos): the variant
    // libraries are HTTP-input shapes — they don't apply to host items.
    const hostProtocol = has("rdp", "smb", "winrm", "wmi", "ldap", "nfs", "kerberos", "ssh");
    // Auth/session parameter shapes: web/API authentication flows only
    // (login, session fixation, JWT, cookies, IDOR) — not credential-exposure
    // audits, SSH config, or Windows internals, and not the DNS ownership
    // gate items (those test verification, not session auth).
    if (!hostProtocol &&
        has("session fixation", "login", "logout", "jwt", "cookie", "auth bypass", "password reset", "2fa", "mfa", "idor", "cross-account", "authentication bypass") &&
        !has("dns", "ownership verification", "_secscan-challenge")) {
        out.push("auth");
    }
    // Header/CORS trust boundaries ("tls" needs a word boundary — not "sysctls").
    if (!hostProtocol && (has("header", "cors", "hsts", "csp ", "csp:", "content-security-policy") || hasWord("tls")) && !out.includes("xss")) {
        out.push("headers");
    }
    return [...new Set(out)];
}
/** All curated payloads for an item's classes, in class order. */
export function buildVariantsForClasses(classes) {
    const out = [];
    for (const c of classes)
        out.push(...LIBRARIES[c]);
    return out;
}
//# sourceMappingURL=classify.js.map