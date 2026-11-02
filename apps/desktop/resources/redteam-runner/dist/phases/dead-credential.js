/**
 * The halt reason when every credential for `providerId` is dead in the
 * pool, or undefined when the provider has no pool, an empty pool, or at
 * least one living credential (the pool then rotates and serves).
 */
export function deadCredentialHaltReason(snapshots, providerId) {
    const snap = snapshots.find((s) => s.providerId === providerId);
    if (snap === undefined || snap.entries.length === 0)
        return undefined;
    if (!snap.entries.every((entry) => entry.dead))
        return undefined;
    const segments = snap.entries.map((entry) => {
        const said = [];
        if (entry.deadStatus !== undefined)
            said.push(`HTTP ${entry.deadStatus}`);
        if (entry.deadCode !== undefined)
            said.push(entry.deadCode);
        return (`key …${entry.fingerprint} marked ${entry.deadReason ?? "dead"}` +
            (entry.deadAtMs !== undefined ? ` at ${new Date(entry.deadAtMs).toISOString()}` : "") +
            (said.length > 0 ? ` (provider answered ${said.join(" ")})` : ""));
    });
    return (`Fleet credential DEAD for provider '${providerId}': ${segments.join("; ")}. ` +
        "The provider rejected the key itself — this is not a rate limit and no bench will lift it. " +
        "Re-seat a valid provider key (MODEL_API_KEY) and restart; no engagement can run until then.");
}
//# sourceMappingURL=dead-credential.js.map