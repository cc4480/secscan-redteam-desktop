/**
 * The bridge seam for local host mode — split out of collect.ts to keep
 * both files inside the file budget, with no behaviour change.
 *
 * It carries the channel interface, its tier-0 operation allow-list, the
 * local-mode verification proof and engagement-input builders, and the
 * environment-configured channel factory. collect.ts re-exports every one
 * of them, so importers of that module are unaffected.
 */
import { type FetchLike, type PcAgentTool } from "../host-exec/pc-agent.js";
import type { EngagementInput } from "../types.js";
/** The channel the collector consumes; the pc-agent client satisfies it. */
export interface LocalChannel {
    /**
     * Call one bridge tool and return its text result.
     * @param tool - an allow-listed pc-agent tool name.
     * @param args - the tool's arguments.
     * @returns the bridge's result text.
     */
    call(tool: PcAgentTool, args: Record<string, unknown>): Promise<string>;
}
/** Raw section text cap; longer bridge results are truncated and flagged. */
export declare const LOCAL_RAW_CAP = 20000;
/** Tier-0 inventory operations — the collector's first pass, all read-only. */
export declare const LOCAL_INVENTORY_OPERATIONS: readonly PcAgentTool[];
/**
 * The verification proof text recorded for a local engagement.
 * @param declaredHostname - the engagement's declared local target.
 * @param operatorName - the accountable operator, when named on the record.
 * @returns the basis text: possession of the paired channel plus attestation.
 */
export declare function localVerificationProof(declaredHostname: string, operatorName?: string): string;
/**
 * Build the engagement input for a local-mode engagement.
 * @param opts - the local target hostname and the accountable operator.
 * @returns an engagement input whose scope is exactly the local hostname.
 */
export declare function buildLocalEngagementInput(opts: {
    hostname: string;
    operatorName?: string;
    objective?: string;
    mode?: EngagementInput["mode"];
}): EngagementInput;
/**
 * Create a collector channel from the environment.
 * @param env - environment to read the bridge configuration from.
 * @param fetchImpl - transport seam for tests; defaults to global fetch.
 * @returns the channel, or undefined when the bridge is not configured —
 * the caller must fail loud, never fall back to network collection.
 */
export declare function localChannelFromEnv(env?: NodeJS.ProcessEnv, fetchImpl?: FetchLike): LocalChannel | undefined;
