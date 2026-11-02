import type { ScopeGuardSets } from "./scope-guard.js";
/**
 * Parse the guard's sets from raw declared allow entries and an
 * optional deny list: the allow side through the scope-file
 * classification (HostSet.fromEntries), the deny side through the
 * attested placement (HostSet.fromAttestedEntries) so a bare
 * hostname in the deny list is placed and denies.
 *
 * @param allowEntries - The raw allow entries (the declared ROE scope).
 * @param outOfScope - The raw deny entries, or undefined when no deny list was declared.
 * @returns The parsed sets and their load state for the ScopeGuard constructor.
 */
export declare function scopeGuardSetsFromEntries(allowEntries: readonly string[], outOfScope: readonly string[] | undefined): ScopeGuardSets;
/**
 * Parse the guard's sets from the AUTHORIZE phase's attestation
 * output: the raw ROE scope entries whose hosts passed authorization,
 * persisted on the engagement record (ctx.verifiedScope). The record
 * wins for the allow set — a launch-request scope that differs from
 * what was actually attested (or a launch object mutated after
 * authorize) does not move the guard. The allow set places through
 * HostSet.fromAttestedEntries: the attested hosts are placed as the
 * hosts they are, bare machine hostnames included, instead of being
 * dropped by the scope-file classification's dot requirement. The
 * deny set still comes from the ROE `outOfScope`, parsed through the
 * same attested placement, so a bare hostname there denies too:
 * deny always beats allow, record or not.
 *
 * @param record - The attested scope entries and the ROE deny list.
 * @returns The parsed sets for a guard allow-sourced from the record.
 */
export declare function scopeGuardSetsFromVerifiedRecord(record: {
    verifiedScope: readonly string[];
    outOfScope?: readonly string[];
}): ScopeGuardSets;
