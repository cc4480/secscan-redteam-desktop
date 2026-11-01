/**
 * Scope record — building the guard's allow/deny sets from raw entries,
 * extracted from scope-guard.ts.
 *
 * Two sources, one builder: the declared ROE fields (scope /
 * outOfScope) and the AUTHORIZE phase's verified record (the attested
 * scope entries persisted on the engagement record). Both parse their
 * entries through HostSet.fromEntries so classification — and the
 * skipped-entry surfacing for operator typos — is identical whichever
 * source the guard was built from; the decision itself stays in
 * scope-guard.ts (ScopeGuard).
 */
import { HostSet } from "./scope-hostset.js";
/**
 * Parse the guard's sets from raw allow entries and an optional deny
 * list. An undefined outOfScope means no deny list was declared — the
 * command scan then has nothing to enforce, exactly as a missing
 * out-of-scope.yaml disables the Python guard's command check.
 *
 * @param allowEntries - The raw allow entries (ROE scope, or the verified record's attested entries).
 * @param outOfScope - The raw deny entries, or undefined when no deny list was declared.
 * @returns The parsed sets and their load state for the ScopeGuard constructor.
 */
export function scopeGuardSetsFromEntries(allowEntries, outOfScope) {
    const allowBuilt = HostSet.fromEntries(allowEntries);
    const denyDeclared = outOfScope !== undefined;
    const denyBuilt = denyDeclared ? HostSet.fromEntries(outOfScope ?? []) : { set: new HostSet(), skipped: [] };
    return {
        allow: allowBuilt.set,
        deny: denyBuilt.set,
        allowEntries,
        allowLoaded: allowEntries.length > 0,
        denyLoaded: denyDeclared,
        skipped: [...allowBuilt.skipped, ...denyBuilt.skipped],
    };
}
/**
 * Parse the guard's sets from the AUTHORIZE phase's attestation
 * output: the raw ROE scope entries whose hosts passed authorization,
 * persisted on the engagement record (ctx.verifiedScope). The record
 * wins for the allow set — a launch-request scope that differs from
 * what was actually attested (or a launch object mutated after
 * authorize) does not move the guard. The deny set still comes from
 * the ROE `outOfScope`: deny always beats allow, record or not.
 *
 * @param record - The attested scope entries and the ROE deny list.
 * @returns The parsed sets for a guard allow-sourced from the record.
 */
export function scopeGuardSetsFromVerifiedRecord(record) {
    return scopeGuardSetsFromEntries(record.verifiedScope, record.outOfScope);
}
//# sourceMappingURL=scope-record.js.map