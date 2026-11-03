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
import type {
  LocalDirListing,
  LocalHostInventory,
  LocalInventorySection,
  LocalSystemInfo,
} from "./types.js";
import { localVerificationProof, type LocalChannel } from "./collect-bridge.js";
import {
  capRaw,
  collectTier2Sections,
  errorText,
  failedSection,
  hostnameMatches,
  parseJson,
  toSystemInfo,
  unCollectedSections,
  unsupportedSections,
} from "./collect-sections.js";

// The bridge seam and the local-mode builders live in collect-bridge.ts (a
// file-budget split). Re-exported here so every importer of this module —
// phases/recon.ts, local-host/index.ts, the tests — is unchanged.
export {
  LOCAL_INVENTORY_OPERATIONS,
  LOCAL_RAW_CAP,
  buildLocalEngagementInput,
  localChannelFromEnv,
  localVerificationProof,
} from "./collect-bridge.js";
export type { LocalChannel } from "./collect-bridge.js";

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
export async function collectLocalInventory(
  channel: LocalChannel,
  opts: CollectLocalOptions,
): Promise<LocalHostInventory> {
  const collectedAt = (opts.now ?? (() => new Date()))().toISOString();
  const base = {
    version: 1 as const,
    mode: "local" as const,
    collectedAt,
    channel: { kind: "pc-agent" as const, url: opts.channelUrl },
    verification: {
      basis: "local-operator-possession" as const,
      proof: localVerificationProof(opts.declaredHostname, opts.operatorName),
      scopeHosts: [opts.declaredHostname],
    },
  };

  let systemText: string;
  try {
    systemText = await channel.call("system_info", {});
  } catch (error) {
    const note = `identity not established: system_info failed (${errorText(error)}); collection aborted`;
    return {
      ...base,
      target: { declaredHostname: opts.declaredHostname, collectedHostname: null, hostnameMatch: false },
      sections: {
        system: failedSection(note),
        processes: failedSection(note),
        filesystem: failedSection(note),
        ...unCollectedSections(note),
        ...unsupportedSections(),
      },
    };
  }

  const systemInfo = toSystemInfo(systemText);
  const collectedHostname = systemInfo.hostname ?? null;
  const cappedSystem = capRaw(systemText);
  const systemSection: LocalInventorySection<LocalSystemInfo> = {
    status: "collected",
    data: systemInfo,
    ...cappedSystem,
    ...(cappedSystem.truncated ? { truncated: true } : {}),
    batteryCoverage: "partial",
  };

  if (collectedHostname === null || !hostnameMatches(opts.declaredHostname, collectedHostname)) {
    const note =
      collectedHostname === null
        ? "collection aborted: system_info reported no hostname, so the local target cannot be confirmed"
        : `collection aborted: collected hostname ${JSON.stringify(collectedHostname)} does not match the declared local target ${JSON.stringify(opts.declaredHostname)}`;
    return {
      ...base,
      target: { declaredHostname: opts.declaredHostname, collectedHostname, hostnameMatch: false },
      sections: {
        system: { ...systemSection, note },
        processes: failedSection(note),
        filesystem: failedSection(note),
        ...unCollectedSections(note),
        ...unsupportedSections(),
      },
    };
  }

  let processes: LocalInventorySection;
  try {
    const text = await channel.call("list_processes", {});
    const capped = capRaw(text);
    const parsed = parseJson(text);
    processes = {
      status: "collected",
      ...(parsed !== undefined ? { data: parsed } : {}),
      ...capped,
      ...(capped.truncated ? { truncated: true } : {}),
      batteryCoverage: "partial",
    };
  } catch (error) {
    processes = failedSection(`list_processes failed: ${errorText(error)}`);
  }

  const listings: LocalDirListing[] = [];
  const failures: string[] = [];
  for (const path of opts.dirPaths ?? ["."]) {
    try {
      const text = await channel.call("list_dir", { path });
      listings.push({ path, raw: capRaw(text).raw });
    } catch (error) {
      failures.push(`${path}: ${errorText(error)}`);
    }
  }
  const filesystem: LocalInventorySection<readonly LocalDirListing[]> =
    listings.length > 0
      ? {
          status: "collected",
          data: listings,
          ...(failures.length > 0 ? { note: `failed listings: ${failures.join("; ")}` } : {}),
          batteryCoverage: "partial",
        }
      : failedSection(`all directory listings failed: ${failures.join("; ")}`);

  const tier2 = await collectTier2Sections(channel);

  return {
    ...base,
    target: { declaredHostname: opts.declaredHostname, collectedHostname, hostnameMatch: true },
    sections: {
      system: systemSection,
      processes,
      filesystem,
      ...tier2,
      ...unsupportedSections(),
    },
  };
}
