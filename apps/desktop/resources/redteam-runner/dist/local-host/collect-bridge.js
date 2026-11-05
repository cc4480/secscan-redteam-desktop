/**
 * The bridge seam for local host mode — split out of collect.ts to keep
 * both files inside the file budget, with no behaviour change.
 *
 * It carries the channel interface, its tier-0 operation allow-list, the
 * local-mode verification proof and engagement-input builders, and the
 * environment-configured channel factory. collect.ts re-exports every one
 * of them, so importers of that module are unaffected.
 */
import { createPcAgentClient, pcAgentConfig, } from "../host-exec/pc-agent.js";
/** Raw section text cap; longer bridge results are truncated and flagged. */
export const LOCAL_RAW_CAP = 20_000;
/** Tier-0 inventory operations — the collector's first pass, all read-only. */
export const LOCAL_INVENTORY_OPERATIONS = [
    "system_info",
    "list_processes",
    "list_dir",
];
/**
 * The verification proof text recorded for a local engagement.
 * @param declaredHostname - the engagement's declared local target.
 * @param operatorName - the accountable operator, when named on the record.
 * @returns the basis text: possession of the paired channel plus attestation.
 */
export function localVerificationProof(declaredHostname, operatorName) {
    const operator = operatorName ?? "the engagement operator";
    return (`Local-mode ownership (operator possession): ${operator} runs this runner on ${declaredHostname} ` +
        `and paired the pc-agent bridge on that same machine; possession of the paired channel is the ` +
        `ownership evidence, and the operator attests on the engagement record that the machine is theirs ` +
        `to assess. The collected system_info hostname must match the declared local target before any ` +
        `inventory is accepted. No DNS/service ownership verification applies to a machine assessing ` +
        `itself, and none is claimed.`);
}
/**
 * Build the engagement input for a local-mode engagement.
 * @param opts - the local target hostname and the accountable operator.
 * @returns an engagement input whose scope is exactly the local hostname.
 */
export function buildLocalEngagementInput(opts) {
    return {
        target: opts.hostname,
        localHost: true,
        mode: opts.mode ?? "red",
        objective: opts.objective ?? "Assess this workstation (local host mode): inventory first, then the host battery.",
        roe: {
            scope: [opts.hostname],
            notes: "LOCAL MODE: the target is the machine this runner runs on. Collection is through the " +
                "paired pc-agent channel only (tier-0 reads, then fixed read-only tier-2 scripts); no " +
                "network services (SMB/WinRM/SSH) and no target credentials are used. Verification " +
                "basis: local-operator-possession — see the engagement record's verification proof.",
        },
        ...(opts.operatorName !== undefined ? { operatorName: opts.operatorName } : {}),
        targets: ["windows"],
    };
}
/**
 * Create a collector channel from the environment.
 * @param env - environment to read the bridge configuration from.
 * @param fetchImpl - transport seam for tests; defaults to global fetch.
 * @returns the channel, or undefined when the bridge is not configured —
 * the caller must fail loud, never fall back to network collection.
 */
export function localChannelFromEnv(env = process.env, fetchImpl) {
    const config = pcAgentConfig(env);
    if (config === undefined)
        return undefined;
    const transport = fetchImpl ?? globalThis.fetch;
    return createPcAgentClient(config, transport);
}
//# sourceMappingURL=collect-bridge.js.map