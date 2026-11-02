/**
 * Scope record — building the guard's allow/deny sets from raw entries,
 * extracted from scope-guard.ts.
 *
 * Two sources, one assembly: the declared ROE fields (scope /
 * outOfScope) and the AUTHORIZE phase's verified record (the attested
 * scope entries persisted on the engagement record). The deny list
 * parses identically for both — the operator's out-of-scope entries
 * through HostSet.fromAttestedEntries, so a bare hostname in the deny
 * list is placed and denies: deny-beats-allow must not silently fail
 * for exactly the bare hosts the attested placement exists to serve.
 * The allow side differs by what the entries are: declared entries
 * are scope-file lines and parse through the file classification
 * (HostSet.fromEntries), while attested entries are authorization
 * output — hosts that already passed authorization — and place
 * through HostSet.fromAttestedEntries, which also places the bare
 * hostnames among them. The decision itself stays in
 * scope-guard.ts (ScopeGuard).
 */
import { HostSet } from "./scope-hostset.js";
import type { ScopeGuardSets } from "./scope-guard.js";

/**
 * Assemble the guard's sets from a built allow set, the raw allow
 * entries it was built from, and an optional deny list. An undefined
 * outOfScope means no deny list was declared — the command scan then
 * has nothing to enforce, exactly as a missing out-of-scope.yaml
 * disables the Python guard's command check.
 *
 * @param allowBuilt - The parsed allow set and its skipped entries.
 * @param allowEntries - The raw allow entries (kept for the guard's literal-listing local-host rule).
 * @param outOfScope - The raw deny entries, or undefined when no deny list was declared.
 * @returns The parsed sets and their load state for the ScopeGuard constructor.
 */
function assembleSets(
  allowBuilt: { set: HostSet; skipped: string[] },
  allowEntries: readonly string[],
  outOfScope: readonly string[] | undefined,
): ScopeGuardSets {
  const denyDeclared = outOfScope !== undefined;
  const denyBuilt = denyDeclared ? HostSet.fromAttestedEntries(outOfScope ?? []) : { set: new HostSet(), skipped: [] as string[] };
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
export function scopeGuardSetsFromEntries(
  allowEntries: readonly string[],
  outOfScope: readonly string[] | undefined,
): ScopeGuardSets {
  return assembleSets(HostSet.fromEntries(allowEntries), allowEntries, outOfScope);
}

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
export function scopeGuardSetsFromVerifiedRecord(record: {
  verifiedScope: readonly string[];
  outOfScope?: readonly string[];
}): ScopeGuardSets {
  return assembleSets(HostSet.fromAttestedEntries(record.verifiedScope), record.verifiedScope, record.outOfScope);
}
