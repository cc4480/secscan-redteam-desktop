/**
 * Credential-attempt lockout interlock (Q-LOCKOUT) — the "how hard" brake
 * beside scope's "where" and the rate limiter's "how fast".
 *
 * Ported mechanism (ZimZilla AttemptBudget, re-implemented as original
 * TypeScript like turn-integrity.ts): an operator who declares the target
 * locks accounts at N bad passwords can afford N−1 failed validations; the
 * Nth is refused BEFORE it runs. Default threshold 5 — the most conservative
 * value in common use: being wrong on the low side costs a re-run, being
 * wrong on the high side costs a locked-out workforce.
 *
 * What is enforced here (spec: lockout-spec-2026-10-31.md):
 *  - Per-(host, protocolClass) FAILED-validation budget of
 *    `lockoutThreshold − 1`. Class A calls are exactly one validation of the
 *    single engagement test account (credentials come from the environment,
 *    never from tool args), and a successful validation resets the target's
 *    bad-password counter — so successes reset the key, only failures count.
 *  - Spend-before-run: admission reserves an in-flight slot; a call is
 *    refused when `failures + inFlight + 1 > limit`, so parallel calls
 *    cannot collectively overshoot the limit either.
 *  - Campaign backstop: `totalFailureCeiling` (default 25) total failed
 *    validations across all keys trips credential testing engagement-wide —
 *    the honest form of the donor's campaign-wide counter, for when the
 *    declared threshold is wrong on some host.
 *  - Class B (attempts happen INSIDE one call — msf login scanners, nmap
 *    auth/brute scripts) cannot be counted per attempt from the choke
 *    point, so it draws a per-host call budget (default 1) instead, and its
 *    summary is signal-watched. Anyone claiming per-attempt coverage for
 *    these paths is claiming something the architecture cannot produce.
 *  - A lockout SIGNAL in any classified result (STATUS_ACCOUNT_LOCKED_OUT,
 *    KDC_ERR_CLIENT_REVOKED, LDAP data 775, pam_faillock, the shared
 *    LOCKOUT_TEXT_PATTERN 429/locked phrasings) trips the WHOLE host: AD's
 *    bad-password counter is per-account across protocols, so one class's
 *    signal refuses them all. Other hosts and all non-credential work
 *    continue.
 *  - Resume is a recorded operator decision (who + rationale) or nothing.
 *    There is no agent path, no tool, no timer. The attempt ledger is
 *    never erased by a reset.
 *
 * Honest limits: reservations resolve when dispatch records the outcome; a
 * later gate's denial (variant cap, policy) strands the reservation, which
 * fails SAFE (later refusals, never extra attempts). Reads never count —
 * a null session, an anonymous bind, a probe are not credential attempts,
 * or the breaker would trip on reconnaissance.
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
export class CredentialAttemptGuard {
    cfg;
    hosts = new Map();
    total = 0;
    ceilingBaseline = 0;
    campaignTripReason;
    ledgerEntries = [];
    now;
    constructor(cfg = {}, now = Date.now) {
        const merged = { ...DEFAULT_LOCKOUT_CONFIG };
        if (cfg.lockoutThreshold !== undefined)
            merged.lockoutThreshold = cfg.lockoutThreshold;
        if (cfg.totalFailureCeiling !== undefined)
            merged.totalFailureCeiling = cfg.totalFailureCeiling;
        if (cfg.opaqueRunsPerHost !== undefined)
            merged.opaqueRunsPerHost = cfg.opaqueRunsPerHost;
        for (const [k, v] of Object.entries(merged)) {
            if (!Number.isFinite(v) || v <= 0) {
                throw new Error(`[safety] lockout ${k} must be a positive number, got ${v}`);
            }
        }
        this.cfg = merged;
        this.now = now;
    }
    get config() {
        return { ...this.cfg };
    }
    /** Failed validations permitted per key: `max(1, lockoutThreshold − 1)`. */
    get failureLimit() {
        return Math.max(1, this.cfg.lockoutThreshold - 1);
    }
    hostState(host) {
        let s = this.hosts.get(host);
        if (!s) {
            s = { keys: new Map(), opaqueRuns: 0, tripped: false };
            this.hosts.set(host, s);
        }
        return s;
    }
    key(state, protocolClass) {
        let t = state.keys.get(protocolClass);
        if (!t) {
            t = { failures: 0, inFlight: 0, account: LOCKOUT_ACCOUNT_LABEL };
            state.keys.set(protocolClass, t);
        }
        return t;
    }
    pushLedger(entry) {
        this.ledgerEntries.push({ ...entry, at: new Date(this.now()).toISOString() });
        if (this.ledgerEntries.length > LOCKOUT_LEDGER_CAP)
            this.ledgerEntries.shift();
    }
    campaignTripped() {
        return this.total - this.ceilingBaseline >= this.cfg.totalFailureCeiling;
    }
    isTripped(host) {
        return this.hosts.get(host)?.tripped ?? false;
    }
    tripReason(host) {
        return this.hosts.get(host)?.tripReason;
    }
    trippedHosts() {
        return [...this.hosts.entries()].filter(([, s]) => s.tripped).map(([h]) => h);
    }
    failuresFor(host, protocolClass) {
        return this.hosts.get(host)?.keys.get(protocolClass)?.failures ?? 0;
    }
    totalFailures() {
        return this.total;
    }
    opaqueRunsUsed(host) {
        return this.hosts.get(host)?.opaqueRuns ?? 0;
    }
    ledger() {
        return [...this.ledgerEntries];
    }
    /**
     * Admission check at the dispatch choke point (after the duplicate
     * guard, before the rate limiter — a refused attempt consumes no rate
     * token). Class A admission reserves an in-flight slot; Class B
     * admission consumes one opaque run. Watch/event-only calls are
     * admitted without consuming budgets but are still refused against a
     * tripped host / tripped campaign (event-only) — watch calls are the
     * named exception: coordinator-gated or server-side, signal-watched
     * only, never refused by this guard.
     */
    check(host, cls, tool) {
        if (cls.kind === "none" || cls.kind === "watch")
            return { allowed: true };
        const state = this.hostState(host);
        if (this.campaignTripped()) {
            return {
                allowed: false,
                refusalKind: "ceiling",
                refusal: `BLOCKED — credential lockout interlock: the campaign ceiling is spent (${this.total - this.ceilingBaseline} failed credential ` +
                    `validations across all targets, ceiling ${this.cfg.totalFailureCeiling}). Credential testing is refused engagement-wide — the declared ` +
                    `lockout threshold of ${this.cfg.lockoutThreshold} has proven optimistic somewhere, and continuing would walk target after target into ` +
                    `lockouts. This is the interlock working, not an error. Continue with unauthenticated vectors; credential testing resumes only on a ` +
                    `recorded operator resume decision.`,
            };
        }
        if (state.tripped) {
            return {
                allowed: false,
                refusalKind: "tripped",
                refusal: `BLOCKED — credential lockout interlock: ${host} is tripped (${state.tripReason ?? "lockout trip"}). All credential testing against ` +
                    `this host is refused for the rest of the engagement — the account's bad-password counter is shared across protocols, so switching ` +
                    `protocol classes does not help and would deepen the lockout. Other in-scope targets and all non-credential work continue. ` +
                    `Credential testing against ${host} resumes only on a recorded operator resume decision.`,
            };
        }
        if (cls.kind === "class-a") {
            const track = this.key(state, cls.protocolClass);
            if (track.failures + track.inFlight + 1 > this.failureLimit) {
                return {
                    allowed: false,
                    refusalKind: "budget",
                    refusal: `BLOCKED — credential lockout interlock: ${tool} against ${host} (${cls.protocolClass}) would risk failed validation ` +
                        `${track.failures + track.inFlight + 1} — the target is declared to lock accounts at ${this.cfg.lockoutThreshold}, so the budget is ` +
                        `threshold − 1 = ${this.failureLimit} failed validations and ${track.failures} are already spent. The next failed validation could ` +
                        `lock the account. This is the interlock working, not an error — report what the attempts so far established and stop guessing. ` +
                        `Continue with unauthenticated vectors; credential testing against this host resumes only on a recorded operator resume decision.`,
                };
            }
            track.inFlight++;
            this.pushLedger({ tool, host, protocolClass: cls.protocolClass, kind: cls.kind, outcome: "reserved" });
            return { allowed: true };
        }
        if (cls.kind === "class-b") {
            if (state.opaqueRuns + 1 > this.cfg.opaqueRunsPerHost) {
                return {
                    allowed: false,
                    refusalKind: "opaque",
                    refusal: `BLOCKED — credential lockout interlock: ${tool} against ${host} can make many authentication attempts inside one call, which the ` +
                        `runner cannot count individually; the per-host budget for such opaque runs is ${this.cfg.opaqueRunsPerHost} per engagement and it ` +
                        `is spent. Use the single-validation tools instead (rdp_auth, smb_pth, ad_enum, ssh_exec, smb_exec, winrm_exec), where every ` +
                        `attempt is counted by the interlock.`,
                };
            }
            state.opaqueRuns++;
            this.pushLedger({ tool, host, protocolClass: cls.protocolClass ?? null, kind: cls.kind, outcome: "reserved" });
            return { allowed: true };
        }
        // event-only: admitted, no budget consumed; the outcome entry is the ledger record.
        return { allowed: true };
    }
    /**
     * Record a classified call's outcome beside the auto-halt recording in
     * dispatch. Success resets the key's failure count (the target's
     * bad-password counter reset with it); a failed validation increments
     * the key and the campaign total; a lockout signal trips the host.
     * Watch/event-only outcomes never touch failure budgets — signals
     * still trip.
     */
    recordOutcome(host, cls, tool, outcome) {
        if (cls.kind === "none")
            return {};
        const state = this.hostState(host);
        this.pushLedger({ tool, host, protocolClass: cls.protocolClass ?? null, kind: cls.kind, outcome });
        const info = {};
        if (cls.kind === "class-a") {
            const track = this.key(state, cls.protocolClass);
            track.inFlight = Math.max(0, track.inFlight - 1);
            if (outcome === "success") {
                track.failures = 0;
            }
            else if (outcome === "failed-validation") {
                track.failures++;
                this.total++;
                if (this.campaignTripped()) {
                    this.campaignTripReason =
                        `campaign ceiling reached: ${this.total - this.ceilingBaseline} failed credential validations across all keys ` +
                            `(ceiling ${this.cfg.totalFailureCeiling}, declared lockout threshold ${this.cfg.lockoutThreshold})`;
                    info.trippedNow = "campaign";
                    info.reason = this.campaignTripReason;
                }
            }
        }
        if (outcome === "lockout-signal" && !state.tripped) {
            state.tripped = true;
            state.tripReason = `lockout signal on ${cls.protocolClass ?? "unknown class"} via ${tool} — the target reports the account locked or locking`;
            if (!info.trippedNow) {
                info.trippedNow = "host";
                info.reason = state.tripReason;
            }
        }
        return info;
    }
    /**
     * Operator resume — the ONLY way a trip or a spent budget clears, and
     * only as a recorded decision naming who decided and why (an empty
     * rationale is not a decision). Clears
     * the host's trip and counters; the ledger is retained — the attempts
     * that happened stay on record. When the campaign ceiling is tripped,
     * a decision-recorded reset also re-arms the ceiling from the current
     * total (the operator has seen the real numbers and chosen to proceed).
     */
    reset(host, decision) {
        if (!decision?.by?.trim()) {
            throw new Error(`lockout reset for ${host} names no decider — a resume without a recorded who + rationale is not a decision`);
        }
        if (!decision?.rationale?.trim()) {
            throw new Error(`lockout reset for ${host} has no rationale — a resume without a stated reason is not a decision`);
        }
        this.hosts.delete(host);
        if (this.campaignTripped()) {
            this.ceilingBaseline = this.total;
            this.campaignTripReason = undefined;
        }
    }
    /** The manifest block (spec §5.6): the interlock's numbers, or it did not happen. */
    manifestData() {
        const perKey = [];
        const opaqueRuns = [];
        const trippedHosts = [];
        for (const [host, state] of this.hosts.entries()) {
            for (const [protocolClass, track] of state.keys.entries()) {
                perKey.push({ host, protocolClass, account: track.account, failures: track.failures });
            }
            if (state.opaqueRuns > 0)
                opaqueRuns.push({ host, used: state.opaqueRuns });
            if (state.tripped)
                trippedHosts.push({ host, reason: state.tripReason ?? "lockout trip" });
        }
        return {
            threshold: this.cfg.lockoutThreshold,
            failureLimit: this.failureLimit,
            totalFailureCeiling: this.cfg.totalFailureCeiling,
            opaqueRunsPerHost: this.cfg.opaqueRunsPerHost,
            totalFailures: this.total,
            campaignTripped: this.campaignTripped(),
            campaignTripReason: this.campaignTripReason,
            trippedHosts,
            perKey,
            opaqueRuns,
        };
    }
}
/**
 * Resolve the engagement's guard from a context (the scopeGuardFor
 * precedent): phases/run.ts constructs it from the resolved config; a
 * context assembled without one (tests, partial contexts) gets a
 * default-configured guard built from whatever config the context
 * carries, cached on the context so every dispatch shares one guard.
 */
export function lockoutGuardFor(ctx) {
    ctx.safety.lockout ??= new CredentialAttemptGuard({
        lockoutThreshold: ctx.config?.lockoutThreshold,
        totalFailureCeiling: ctx.config?.lockoutTotalFailures,
        opaqueRunsPerHost: ctx.config?.lockoutOpaqueRuns,
    });
    return ctx.safety.lockout;
}
//# sourceMappingURL=lockout.js.map