/**
 * The credential-lockout interlock itself — Q-LOCKOUT's stateful half.
 *
 * Extracted from lockout.ts in a structural split (no file under src/ may
 * exceed 300 lines). The CredentialAttemptGuard class is moved VERBATIM:
 * same fields, same admission reserves, same refusal text, same trip and
 * reset semantics. Its taxonomy, patterns and pure classifiers are
 * imported from lockout-classify.ts; lockout.ts re-exports the class so
 * every existing importer keeps working.
 */
import { type AttemptLedgerEntry, type AuthOutcome, type CredentialClassification, type LockoutCheckVerdict, type LockoutConfig, type LockoutManifestData, type LockoutOutcomeInfo, type ProtocolClass } from './lockout-classify.js';
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
