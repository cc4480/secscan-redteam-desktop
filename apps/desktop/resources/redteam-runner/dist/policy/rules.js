/**
 * Operator policy rules (v0.34.0) — allow/deny over tool calls, deny-wins.
 *
 * An engagement is often bound by a client's rules ("never touch the payment
 * path", "only these hosts", "no file writes"). Today that would mean patching
 * the dispatcher. This makes it data: a JSON file the operator supplies, loaded
 * once at engagement start and enforced mechanically before any packet, exactly
 * like the tier and variant caps.
 *
 * Format (REDTEAM_POLICY_FILE points at it):
 *   { "allow": ["*"], "deny": ["smb_exec *", "* 10.0.0.5"] }
 *
 * Subjects are matched as `<tool>` and `<tool> <target>`, so a rule can scope by
 * tool alone or by tool + host. Deny always wins; when `allow` is non-empty and
 * nothing matches it, the call is denied (default-deny, opt-in allow-list).
 *
 * Patterns are globs (`*`, `?`), case-insensitive — the same vocabulary the
 * external-tool registry uses for its command rules, so operators learn one
 * syntax.
 */
export const POLICY_ENV_FILE = "REDTEAM_POLICY_FILE";
/** Translate a glob into an anchored, case-insensitive RegExp. */
export function globToRegExp(pattern) {
    const escaped = pattern
        .trim()
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i");
}
/** True when `value` matches the glob pattern. */
export function globMatch(pattern, value) {
    const p = pattern.trim();
    if (p === "" || p === "*")
        return true;
    return globToRegExp(p).test(value.trim());
}
/** Parse a policy document. Returns undefined for anything unrecognisable (fail closed at the caller). */
export function parsePolicy(raw, source = "inline") {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        return undefined;
    const obj = raw;
    const list = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean) : [];
    return { allow: list(obj["allow"]), deny: list(obj["deny"]), source };
}
/**
 * Check one tool call against the rules. `subject` candidates are the bare tool
 * name and `"<tool> <target>"` when a target is known; a pattern matching either
 * counts. Deny wins over allow.
 */
export function checkToolPolicy(rules, tool, target, args) {
    if (!rules)
        return { allowed: true, reason: "no policy configured" };
    const subjects = [tool, target ? `${tool} ${target}` : undefined].filter((s) => Boolean(s));
    // Include a compact args rendering so operator rules can scope by parameter
    // (e.g. `* --mode=delete`), without exposing the raw object to the matcher.
    if (args) {
        const rendered = Object.entries(args)
            .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(" ");
        if (rendered)
            subjects.push(`${tool} ${rendered}`);
    }
    for (const pattern of rules.deny) {
        if (subjects.some((s) => globMatch(pattern, s))) {
            return { allowed: false, reason: `deny rule ${JSON.stringify(pattern)} matched (${rules.source})` };
        }
    }
    if (rules.allow.length > 0 && !rules.allow.some((p) => subjects.some((s) => globMatch(p, s)))) {
        return { allowed: false, reason: `no allow rule matched — allow-list is non-empty (default deny, ${rules.source})` };
    }
    return { allowed: true, reason: "allowed by policy" };
}
//# sourceMappingURL=rules.js.map