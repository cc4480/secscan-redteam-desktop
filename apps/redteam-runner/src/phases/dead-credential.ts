/**
 * Fail-fast dead-credential check (FIX-DEADKEY): before the plan phase
 * burns an engagement on a credential the provider already pronounced
 * dead, read the router's live pool snapshots and — when EVERY credential
 * seated for the fleet provider is dead — produce the halt reason the
 * engagement closes with. The reason names the terminal cause honestly:
 * the provider rejected the key (with the recorded HTTP status/code and
 * the time the death was recorded), plus the remedy. It never calls the
 * death a rate limit or a bench.
 *
 * Pure over the snapshots so tests feed it fixtures; the caller passes
 * the router's live poolSnapshots() and the fleet provider id from the
 * role model policy (every seat routes to the one fleet provider).
 */
import type { PoolSnapshot } from "@secscan/redteam-llm-router";

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
  return (
    `Fleet credential DEAD for provider '${providerId}': ${segments.join("; ")}. ` +
    "The provider rejected the key itself — this is not a rate limit and no bench will lift it. " +
    "Re-seat a valid provider key (MODEL_API_KEY) and restart; no engagement can run until then."
  );
}
