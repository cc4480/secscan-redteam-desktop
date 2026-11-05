/**
 * Credential-lockout classification — the pure half of Q-LOCKOUT.
 *
 * Extracted from lockout.ts in a structural split (no file under src/ may
 * exceed 300 lines). Moved verbatim: the shared lockout-signal pattern,
 * the protocol/credential class taxonomy, the operator config and its
 * defaults, the ledger/manifest types, and the two pure classifiers
 * (classifyCredentialAttempt by call shape, classifyAuthOutcome by result
 * text). Nothing here holds state or touches the target; the stateful
 * CredentialAttemptGuard and its admission/outcome budgets stay in
 * lockout-guard.ts, and lockout.ts remains the public module.
 */
/**
 * Lockout-signal phrasings (fleet charter spec §6): a target throttling
 * or locking accounts. One shared constant, read by the credential
 * lockout classifier below — the single set the Q-LOCKOUT spec (§5.3)
 * requires. Tested against lowercased result text. (Moved here from the
 * removed autohalt.ts, whose only surviving export this was.)
 */
export const LOCKOUT_TEXT_PATTERN = /http 429|status 429|too many requests|account (?:is )?(?:temporarily )?locked|locked out|login locked|too many (?:failed )?(?:login|sign-in|authentication) attempts/;
export const DEFAULT_LOCKOUT_CONFIG = {
    lockoutThreshold: 5,
    totalFailureCeiling: 25,
    opaqueRunsPerHost: 1,
};
/** Bounded attempt ledger (the donor's history bound). */
export const LOCKOUT_LEDGER_CAP = 50;
/**
 * The account dimension of every budget key in v1: all Class A tools
 * authenticate as the single engagement test account for their service,
 * resolved from the environment (spec §5.1). Carried as a struct field so
 * per-call credentials, if ever introduced, key by account as a data
 * change — and that change must key by account before it ships.
 */
export const LOCKOUT_ACCOUNT_LABEL = "env:test-account";
const CLASS_A_TOOLS = {
    rdp_auth: "rdp",
    smb_pth: "smb",
    smb_exec: "smb",
    ad_enum: "ldap",
    ssh_exec: "ssh",
    ssh_agent_audit: "ssh",
    winrm_exec: "winrm",
    // Build-time verify (spec §4): rdp_shadow_prep opens an authenticated
    // session with the test credential over WinRM — classified by the
    // transport it opens, not by its read-only intent.
    rdp_shadow_prep: "winrm",
};
/** Server-side auth arms: call-level ledger + signal watch, no per-attempt claim (spec §4). */
const WATCH_TOOLS = new Set(["seclayer_dast", "seclayer_aggressive", "seclayer_api"]);
/**
 * Explicitly never counted (spec §4): offline work, unauthenticated probes,
 * and tools with no credential submission. Named so the conservative-in
 * rule below can never sweep them in.
 */
const EXEMPT_TOOLS = new Set([
    "john_exec", // offline cracking — toolTargetHost() already returns undefined for it
    "winrm_probe", // unauthenticated scheme probe
    "nfs_enum", // no credentials
    "sqlmap_exec",
    "ffuf_exec",
    "gobuster_exec",
    "nikto_exec",
    "nuclei_exec",
    "http_probe", // a POST to /login is indistinguishable from content discovery here (spec §8)
    "burst_probe",
    "secscan_exec",
    "seclayer_redteam",
    "seclayer_bola",
    "seclayer_webhook",
]);
const PASSWORD_FILE_OPTION_KEYS = new Set(["USERPASS_FILE", "USER_FILE", "PASS_FILE", "USERPASS"]);
function protocolFromName(name) {
    if (/smb|cifs/.test(name))
        return "smb";
    if (/ldap/.test(name))
        return "ldap";
    if (/kerberos|krb/.test(name))
        return "kerberos-events";
    if (/rdp/.test(name))
        return "rdp";
    if (/winrm/.test(name))
        return "winrm";
    if (/ssh/.test(name))
        return "ssh";
    return undefined;
}
function protocolFromModulePath(modulePath) {
    if (modulePath.includes("smb"))
        return "smb";
    if (modulePath.includes("ssh"))
        return "ssh";
    if (modulePath.includes("winrm"))
        return "winrm";
    if (modulePath.includes("ldap"))
        return "ldap";
    if (modulePath.includes("rdp"))
        return "rdp";
    if (modulePath.includes("kerberos") || modulePath.includes("krb"))
        return "kerberos-events";
    return "web";
}
function classifyMsf(args) {
    // dispatch/msf.ts resolves any action other than "run" to suggest/search —
    // local msfrpcd queries that send nothing to the target.
    if (args["action"] !== "run")
        return { kind: "none" };
    const modulePath = typeof args["module"] === "string" ? args["module"].toLowerCase() : "";
    const options = args["options"] && typeof args["options"] === "object" ? args["options"] : {};
    const hasPasswordFile = Object.keys(options).some((k) => PASSWORD_FILE_OPTION_KEYS.has(k.toUpperCase()));
    if (args["moduleType"] === "auxiliary") {
        // A scanner fed a password file is a spray whatever its name (spec §5.4).
        const loginModule = modulePath.includes("_login") || modulePath.includes("/login");
        if (loginModule || hasPasswordFile) {
            return {
                kind: "class-b",
                protocolClass: protocolFromModulePath(modulePath),
                detail: loginModule ? "msf login-scanner module" : "msf auxiliary run with a password-file option",
            };
        }
        return { kind: "none" };
    }
    // Exploit modules are coordinator-gated already; v1 gives them signal
    // watch + a ledger note, no call budget (named gap, spec §8).
    return { kind: "watch", detail: "msf exploit run — signal watch only" };
}
function classifyNmap(args) {
    const raw = args["scriptCategories"];
    const entries = Array.isArray(raw)
        ? raw.filter((e) => typeof e === "string")
        : typeof raw === "string"
            ? raw.split(",")
            : typeof args["script"] === "string"
                ? [args["script"]]
                : [];
    const brute = entries.some((e) => {
        const s = e.trim().toLowerCase();
        return s === "auth" || s === "brute" || s.includes("brute");
    });
    return brute
        ? { kind: "class-b", protocolClass: "web", detail: "nmap NSE auth/brute scripts run attempts inside the call" }
        : { kind: "none" };
}
/**
 * Classify a tool call as credential testing (spec §4). Pure, args-only:
 * credentials are never in args in this runner, so classification is by
 * tool name + arg shape. Unknown host tooling classifies conservatively IN
 * (the donor's "cannot tell whether this authenticates — counted" rule):
 * that tripwire is what keeps a future auth tool from shipping uncounted,
 * which is exactly the gap this interlock exists to close.
 */
export function classifyCredentialAttempt(call) {
    const name = call.name;
    const args = call.arguments ?? {};
    const classA = CLASS_A_TOOLS[name];
    if (classA)
        return { kind: "class-a", protocolClass: classA };
    if (name === "krb_ptt") {
        // Presenting the account's own ticket is not a password guess — a bad
        // ticket does not increment badPwdCount. Event-only: ledger + signal
        // watch, exempt from the failure budget (spec §4).
        return { kind: "event-only", protocolClass: "kerberos-events", detail: "ticket presentation, not a password validation" };
    }
    if (name === "msf_exec")
        return classifyMsf(args);
    if (name === "nmap_exec")
        return classifyNmap(args);
    if (WATCH_TOOLS.has(name)) {
        return { kind: "watch", detail: "server-side auth testing — call-level ledger + signal watch, no per-attempt claim" };
    }
    if (EXEMPT_TOOLS.has(name))
        return { kind: "none" };
    if (/(?:^|_)(auth|login|spray|brute|pth|passwd|password|credential)(?:_|$)/.test(name) || (name.endsWith("_exec") && protocolFromName(name) !== undefined)) {
        return {
            kind: "class-a",
            protocolClass: protocolFromName(name) ?? "web",
            detail: "unknown host tool — counted conservatively (cannot tell whether it authenticates)",
        };
    }
    return { kind: "none" };
}
/**
 * Lockout signals that are NEW with this interlock (per-protocol status
 * shapes, spec §5.3). The HTTP/429/locked phrasings are NOT here — they are
 * the shared LOCKOUT_TEXT_PATTERN above, by design one set.
 * Tested against lowercased result text.
 */
const LOCKOUT_PROTOCOL_PATTERN = /status_account_locked_out|0xc0000234|kdc_err_client_revoked|client[ _]revoked|err:\s*1909|error_account_locked_out|data[:\s]*775\b|data[:\s]*533\b|pam_faillock/;
/** The target's validator said no — one failed validation. Tested against lowercased result text. */
const FAILED_VALIDATION_PATTERN = /status_logon_failure|0xc000006d|credential not valid|permission denied|authentication failed|auth failed|all configured authentication methods failed|invalid credentials|data[:\s]*52e\b|kdc_err_preauth_failed|preauth failed|pre-authentication failed|(?:http|status)[\s:]*40[13]\b|\(40[13]\)/;
/** No validation ever happened (transport failure, unreachable, no-NLA) — never a failed validation. */
const NO_VALIDATION_PATTERN = /connection refused|econnrefused|econnreset|enotfound|timed out|timeout|socket hang up|no verdict|unreachable|connection reset|broken pipe|http 5\d\d/;
/**
 * Classify a classified call's result (spec §5.3). Works on the result
 * text + the handler's `ok` — Class A executors surface no structured
 * status codes today. Precedence:
 * a lockout signal wins over everything (a locked account must trip even
 * on a mislabelled result); `ok === true` is a success (a session that
 * opened validated — its command output is not an auth verdict);
 * transport failures are `other`, never failed validations.
 */
export function classifyAuthOutcome(result, ok) {
    const r = result.toLowerCase();
    if (LOCKOUT_PROTOCOL_PATTERN.test(r) || LOCKOUT_TEXT_PATTERN.test(r))
        return "lockout-signal";
    if (ok === true)
        return "success";
    if (NO_VALIDATION_PATTERN.test(r))
        return "other";
    if (FAILED_VALIDATION_PATTERN.test(r))
        return "failed-validation";
    if (ok === false)
        return "other";
    return "success";
}
//# sourceMappingURL=lockout-classify.js.map