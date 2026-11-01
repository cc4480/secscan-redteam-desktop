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
export declare const LOCKOUT_TEXT_PATTERN: RegExp;
export type ProtocolClass = "smb" | "ldap" | "kerberos-events" | "rdp" | "winrm" | "ssh" | "web";
export type CredentialClassKind = "class-a" | "class-b" | "event-only" | "watch" | "none";
export interface CredentialClassification {
    kind: CredentialClassKind;
    protocolClass?: ProtocolClass;
    detail?: string;
}
export type AuthOutcome = "success" | "failed-validation" | "lockout-signal" | "other";
export interface LockoutConfig {
    /** Operator-declared expected account-lockout threshold. Default 5. */
    lockoutThreshold: number;
    /** Total failed validations across all keys that trip the engagement. Default 25. */
    totalFailureCeiling: number;
    /** Per-host call budget for opaque multi-attempt (Class B) runs. Default 1. */
    opaqueRunsPerHost: number;
}
export declare const DEFAULT_LOCKOUT_CONFIG: LockoutConfig;
/** Bounded attempt ledger (the donor's history bound). */
export declare const LOCKOUT_LEDGER_CAP = 50;
/**
 * The account dimension of every budget key in v1: all Class A tools
 * authenticate as the single engagement test account for their service,
 * resolved from the environment (spec §5.1). Carried as a struct field so
 * per-call credentials, if ever introduced, key by account as a data
 * change — and that change must key by account before it ships.
 */
export declare const LOCKOUT_ACCOUNT_LABEL = "env:test-account";
/**
 * Classify a tool call as credential testing (spec §4). Pure, args-only:
 * credentials are never in args in this runner, so classification is by
 * tool name + arg shape. Unknown host tooling classifies conservatively IN
 * (the donor's "cannot tell whether this authenticates — counted" rule):
 * that tripwire is what keeps a future auth tool from shipping uncounted,
 * which is exactly the gap this interlock exists to close.
 */
export declare function classifyCredentialAttempt(call: {
    name: string;
    arguments?: Record<string, unknown>;
}): CredentialClassification;
/**
 * Classify a classified call's result (spec §5.3). Works on the result
 * text + the handler's `ok` — Class A executors surface no structured
 * status codes today. Precedence:
 * a lockout signal wins over everything (a locked account must trip even
 * on a mislabelled result); `ok === true` is a success (a session that
 * opened validated — its command output is not an auth verdict);
 * transport failures are `other`, never failed validations.
 */
export declare function classifyAuthOutcome(result: string, ok?: boolean): AuthOutcome;
export interface AttemptLedgerEntry {
    tool: string;
    host: string;
    protocolClass: ProtocolClass | null;
    kind: CredentialClassKind;
    outcome: AuthOutcome | "reserved";
    at: string;
}
export interface LockoutCheckVerdict {
    allowed: boolean;
    refusalKind?: "budget" | "opaque" | "tripped" | "ceiling";
    refusal?: string;
}
export interface LockoutOutcomeInfo {
    trippedNow?: "host" | "campaign";
    reason?: string;
}
export interface LockoutManifestData {
    threshold: number;
    failureLimit: number;
    totalFailureCeiling: number;
    opaqueRunsPerHost: number;
    totalFailures: number;
    campaignTripped: boolean;
    campaignTripReason?: string;
    trippedHosts: {
        host: string;
        reason: string;
    }[];
    perKey: {
        host: string;
        protocolClass: ProtocolClass;
        account: string;
        failures: number;
    }[];
    opaqueRuns: {
        host: string;
        used: number;
    }[];
}
export declare class CredentialAttemptGuard {
    private cfg;
    private hosts;
    private total;
    private ceilingBaseline;
    private campaignTripReason?;
    private ledgerEntries;
    private now;
    constructor(cfg?: Partial<LockoutConfig>, now?: () => number);
    get config(): LockoutConfig;
    /** Failed validations permitted per key: `max(1, lockoutThreshold − 1)`. */
    get failureLimit(): number;
    private hostState;
    private key;
    private pushLedger;
    campaignTripped(): boolean;
    isTripped(host: string): boolean;
    tripReason(host: string): string | undefined;
    trippedHosts(): string[];
    failuresFor(host: string, protocolClass: ProtocolClass): number;
    totalFailures(): number;
    opaqueRunsUsed(host: string): number;
    ledger(): AttemptLedgerEntry[];
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
    check(host: string, cls: CredentialClassification, tool: string): LockoutCheckVerdict;
    /**
     * Record a classified call's outcome beside the auto-halt recording in
     * dispatch. Success resets the key's failure count (the target's
     * bad-password counter reset with it); a failed validation increments
     * the key and the campaign total; a lockout signal trips the host.
     * Watch/event-only outcomes never touch failure budgets — signals
     * still trip.
     */
    recordOutcome(host: string, cls: CredentialClassification, tool: string, outcome: AuthOutcome): LockoutOutcomeInfo;
    /**
     * Operator resume — the ONLY way a trip or a spent budget clears, and
     * only as a recorded decision naming who decided and why (an empty
     * rationale is not a decision). Clears
     * the host's trip and counters; the ledger is retained — the attempts
     * that happened stay on record. When the campaign ceiling is tripped,
     * a decision-recorded reset also re-arms the ceiling from the current
     * total (the operator has seen the real numbers and chosen to proceed).
     */
    reset(host: string, decision: {
        by: string;
        rationale: string;
    }): void;
    /** The manifest block (spec §5.6): the interlock's numbers, or it did not happen. */
    manifestData(): LockoutManifestData;
}
/**
 * Resolve the engagement's guard from a context (the scopeGuardFor
 * precedent): phases/run.ts constructs it from the resolved config; a
 * context assembled without one (tests, partial contexts) gets a
 * default-configured guard built from whatever config the context
 * carries, cached on the context so every dispatch shares one guard.
 */
export declare function lockoutGuardFor(ctx: {
    safety: {
        lockout?: CredentialAttemptGuard;
    };
    config?: {
        lockoutThreshold?: number;
        lockoutTotalFailures?: number;
        lockoutOpaqueRuns?: number;
    };
}): CredentialAttemptGuard;
