/**
 * Fail-fast dead-credential check (FIX-DEADKEY): before the plan phase
 * burns an engagement on a credential the provider already pronounced
 * dead, read the router's live pool snapshots and — when EVERY credential
 * seated for the fleet provider is dead — produce the halt reason the
 * engagement closes with. The reason names the terminal cause honestly:
 * the provider that died, the key that died (by fingerprint, with the
 * recorded HTTP status/code and the time the death was recorded), the
 * credential ref to re-seat, and the remedy. It never calls the death a
 * rate limit or a bench.
 *
 * The remedy is a re-seat, not a restart: pool snapshots reconcile with
 * the credentials store on every read (see the router's refreshKeys
 * wiring), so a valid key seated in Settings → Models revives the
 * provider for the very next engagement in this same process.
 *
 * Pure over the snapshots so tests feed it fixtures; the caller passes
 * the router's live poolSnapshots() and the fleet provider id from the
 * role model policy (every seat routes to the one fleet provider).
 */
import type { PoolSnapshot } from "@secscan/redteam-llm-router";
import { providerKeyEnvLabel } from "@secscan/redteam-llm-router";

/**
 * The halt reason when every credential for `providerId` is dead in the
 * pool, or undefined when the provider has no pool, an empty pool, or at
 * least one living credential (the pool then rotates and serves).
 */
export function deadCredentialHaltReason(snapshots: PoolSnapshot[], providerId: string): string | undefined {
  const snap = snapshots.find((s) => s.providerId === providerId);
  if (snap === undefined || snap.entries.length === 0) return undefined;
  if (!snap.entries.every((entry) => entry.dead)) return undefined;
  const segments = snap.entries.map((entry) => {
    const said: string[] = [];
    if (entry.deadStatus !== undefined) said.push(`HTTP ${entry.deadStatus}`);
    if (entry.deadCode !== undefined) said.push(entry.deadCode);
    return (
      `key …${entry.fingerprint} marked ${entry.deadReason ?? "dead"}` +
      (entry.deadAtMs !== undefined ? ` at ${new Date(entry.deadAtMs).toISOString()}` : "") +
      (said.length > 0 ? ` (provider answered ${said.join(" ")})` : "")
    );
  });
  const ref = providerKeyEnvLabel(providerId);
  const refText = ref !== undefined ? ` (credential ref ${ref})` : "";
  return (
    `Fleet credential DEAD for provider '${providerId}': ${segments.join("; ")}. ` +
    "The provider rejected the key itself — this is not a rate limit and no bench will lift it. " +
    `Re-seat a valid ${providerId} key in Settings → Models${refText}; the re-seated key takes ` +
    "effect on the next engagement with no restart. No engagement can run on this provider until then."
  );
}
