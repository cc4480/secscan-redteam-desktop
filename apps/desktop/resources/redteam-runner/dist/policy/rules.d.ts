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
export interface PolicyRules {
    allow: string[];
    deny: string[];
    /** Where the rules came from (file path or "inline"), for the audit trail. */
    source: string;
}
export declare const POLICY_ENV_FILE = "REDTEAM_POLICY_FILE";
/** Translate a glob into an anchored, case-insensitive RegExp. */
export declare function globToRegExp(pattern: string): RegExp;
/** True when `value` matches the glob pattern. */
export declare function globMatch(pattern: string, value: string): boolean;
/** Parse a policy document. Returns undefined for anything unrecognisable (fail closed at the caller). */
export declare function parsePolicy(raw: unknown, source?: string): PolicyRules | undefined;
export interface PolicyDecision {
    allowed: boolean;
    reason: string;
}
/**
 * Check one tool call against the rules. `subject` candidates are the bare tool
 * name and `"<tool> <target>"` when a target is known; a pattern matching either
 * counts. Deny wins over allow.
 */
export declare function checkToolPolicy(rules: PolicyRules | undefined, tool: string, target?: string, args?: Record<string, unknown>): PolicyDecision;
