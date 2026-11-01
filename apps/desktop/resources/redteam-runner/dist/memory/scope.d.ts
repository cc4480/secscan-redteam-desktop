/**
 * Memory scope (brief §4.2): derivation from a verified engagement, the
 * scopeKey identity (§3.2), and `scopeEligible` — the read/write gate
 * every recall gather passes through. Deny beats allow, mirroring
 * `safety/scope-guard.ts`. Memory never binds to an unverified scope.
 */
import type { MemoryScope, MemoryUnit } from "./types.js";
/** Lowercase, trim, strip a trailing dot and any port — scopeHosts semantics. */
export declare function normalizeHost(raw: string): string;
/** Identity for an engagement-target scope: slug of the primary host + host-set hash. */
export declare function scopeKeyForHosts(hosts: string[]): string;
/** Identity for a target-class scope. */
export declare function scopeKeyForClass(targetClass: string): string;
/** The one global-procedural scope key. */
export declare const GLOBAL_SCOPE_KEY = "global";
export interface DerivableEngagementScope {
    engagementId: string;
    hosts: string[];
    verifiedAt?: string;
    verificationProof?: string;
}
/**
 * Derive the running engagement's memory scope. Call ONLY after
 * authorization succeeded (§7.1 Moment 2): absent proof/`verifiedAt` or
 * zero hosts throws MEMORY_SCOPE_UNVERIFIED before planning (§8 row 5).
 */
export declare function deriveMemoryScope(input: DerivableEngagementScope): MemoryScope;
/**
 * Host membership per the scope guard: exact match, or `host` is a
 * subdomain of `domain`. IP literals match exactly only — subdomain
 * arithmetic on addresses is meaningless and fails closed.
 */
export declare function hostMatchesScope(host: string, domain: string): boolean;
export interface ScopeEligibilityContext {
    /** ROE out-of-scope hosts — deny beats allow. */
    outOfScopeHosts?: string[];
    /** The engagement's derived target class (refresh phase only). */
    targetClass?: string;
    /** Post-recon fingerprint stack (refresh phase only). */
    stack?: string[];
    /** Post-recon fingerprint appType (refresh phase only). */
    appType?: string;
}
/**
 * The read gate (§4.2 rule 4). No other path into recall exists.
 * - engagement-target unit: some unit host matches the engagement scope
 *   AND no unit host is out-of-scope.
 * - target-class unit: class equality (refresh) or stack/appType match.
 * - global-procedural unit: always eligible.
 */
export declare function scopeEligible(unit: MemoryUnit, engagementScope: MemoryScope, ctx?: ScopeEligibilityContext): boolean;
/**
 * The write-time binding rules (§4.2 rules 2–3, content half). Structural
 * scope requirements are `validateUnit`'s (schema.ts); this enforces what
 * may LIVE under a scope kind:
 *
 * - A `target-derived-claim` (or any `target-content` unit) is
 *   engagement-target scoped only — never class, never global.
 * - A class-scoped unit must not assert host-specific values (URLs, IPs,
 *   hostnames) in claim or body — those belong under engagement-target.
 *   The detector is mechanical (URL / IP / hostname patterns), so a hit is
 *   a loud rejection the operator can re-scope, never a silent drop.
 * - `global-procedural` carries only operator/experience procedural
 *   lessons — never target facts or findings.
 *
 * @param unit - The unit about to be written or proposed.
 */
export declare function assertScopeBinding(unit: MemoryUnit): void;
