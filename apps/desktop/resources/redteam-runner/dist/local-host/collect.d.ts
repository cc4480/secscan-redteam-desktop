/**
 * Local host mode — the collector core.
 *
 * Why this exists: the audit (report-parity row 23) found the rebuild had no
 * local mode at all — `/pcscan` re-aimed the REMOTE Windows battery at
 * `os.hostname()`, whose checks need SMB/WinRM/SSH and test credentials on
 * the target, the exact combination a real field run stalled on
 * (host-exec/pc-agent.ts field note). Local mode inverts that: the target is
 * the machine this runner runs on, and collection happens over the
 * operator-paired pc-agent channel already running on that machine. No
 * network service and no target credential is involved. Collection runs
 * in two tiers over that one channel: tier-0 read-only bridge tools
 * (identity, processes, directory listings), then — only after the
 * identity gate passes — tier-2 fixed read-only PowerShell scripts
 * (scripts.ts) for the blocks no tier-0 op enumerates. The tier-2 scripts
 * are fixed strings, executed by the operator's own paired agent under
 * the bridge's own consent prompts; a declined prompt fails that one
 * block, honestly, and collection continues.
 *
 * Scope posture — explicit, never a silent bypass: a local engagement's
 * scope is exactly the machine's own hostname, and ownership is established
 * by possession: the operator paired the bridge on that machine (the 6-digit
 * pairing flow is a physical-presence act) and attests on the engagement
 * record. The collector enforces the claim mechanically — the collected
 * `system_info` hostname must match the declared local target, or
 * collection aborts before any further inventory is taken. No DNS or
 * service ownership verification applies to a machine assessing itself,
 * and none is claimed in the recorded proof.
 */
import { type FetchLike, type PcAgentTool } from "../host-exec/pc-agent.js";
import type { EngagementInput } from "../types.js";
import type { LocalHostInventory } from "./types.js";
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
/** Options for one local collection. */
export interface CollectLocalOptions {
    /** The hostname the engagement declared as its local target. */
    declaredHostname: string;
    /** The accountable operator, recorded in the verification proof. */
    operatorName?: string;
    /** The bridge URL the channel is bound to (recorded; never the token). */
    channelUrl: string;
    /** Directories to list in the filesystem section. Default: the bridge's home ("."). */
    dirPaths?: readonly string[];
    /** Clock seam for tests. */
    now?: () => Date;
}
/**
 * Collect a local inventory through the paired channel.
 *
 * Order matters: `system_info` runs first and gates everything else — when
 * the machine's own hostname does not match the declared local target (or
 * identity cannot be read at all), collection aborts before any tier-2
 * call and every remaining section is marked failed with the reason.
 * Section failures after the identity gate are per-section, across both
 * tiers: one dead op or declined script does not lose the rest.
 * @param channel - the collector channel (the pc-agent client, or a stub).
 * @param opts - the declared target and collection options.
 * @returns the collected inventory record.
 */
export declare function collectLocalInventory(channel: LocalChannel, opts: CollectLocalOptions): Promise<LocalHostInventory>;
