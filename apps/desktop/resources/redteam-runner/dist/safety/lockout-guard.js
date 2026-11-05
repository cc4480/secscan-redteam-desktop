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
import { DEFAULT_LOCKOUT_CONFIG, LOCKOUT_ACCOUNT_LABEL, LOCKOUT_LEDGER_CAP, } from './lockout-classify.js';
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
//# sourceMappingURL=lockout-guard.js.map