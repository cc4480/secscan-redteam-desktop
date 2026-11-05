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
