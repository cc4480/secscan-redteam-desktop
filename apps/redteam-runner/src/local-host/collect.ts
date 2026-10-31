/**
 * Local host mode — the collector core.
 *
 * Why this exists: the audit (report-parity row 23) found the rebuild had no
 * local mode at all — `/pcscan` re-aimed the REMOTE Windows battery at
 * `os.hostname()`, whose checks need SMB/WinRM/SSH and test credentials on
 * the target, the exact combination a real field run stalled on
 * (host-exec/pc-agent.ts field note). Local mode inverts that: the target is
 * the machine this runner runs on, and collection happens over the
 * operator-paired pc-agent channel already running on that machine. Every
 * call the collector makes is a tier-0 (read-only) bridge tool; no network
 * service and no target credential is involved.
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
import {
  createPcAgentClient,
  pcAgentConfig,
  type FetchLike,
  type PcAgentTool,
} from "../host-exec/pc-agent.js";
import type { EngagementInput } from "../types.js";
import type {
  LocalDirListing,
  LocalHostInventory,
  LocalInventorySection,
  LocalSystemInfo,
} from "./types.js";

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
export const LOCAL_RAW_CAP = 20_000;

/** Inventory operations the collector uses — all tier-0 bridge tools. */
export const LOCAL_INVENTORY_OPERATIONS: readonly PcAgentTool[] = [
  "system_info",
  "list_processes",
  "list_dir",
];

/**
 * Sections the pc-agent channel cannot answer, with the reason each is
 * unsupported. The channel's closed allow-list has no op that enumerates
 * these; answering them would need tier-2 shell access, which read-only
 * local collection must not require.
 */
const UNSUPPORTED_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["users", "no pc-agent op enumerates local user accounts"],
  ["installedSoftware", "no pc-agent op enumerates installed software"],
  ["services", "no pc-agent op enumerates services"],
  ["listeningPorts", "no pc-agent op enumerates listening ports"],
  ["patches", "no pc-agent op enumerates installed patches"],
];

/**
 * The verification proof text recorded for a local engagement.
 * @param declaredHostname - the engagement's declared local target.
 * @param operatorName - the accountable operator, when named on the record.
 * @returns the basis text: possession of the paired channel plus attestation.
 */
export function localVerificationProof(declaredHostname: string, operatorName?: string): string {
  const operator = operatorName ?? "the engagement operator";
  return (
    `Local-mode ownership (operator possession): ${operator} runs this runner on ${declaredHostname} ` +
    `and paired the pc-agent bridge on that same machine; possession of the paired channel is the ` +
    `ownership evidence, and the operator attests on the engagement record that the machine is theirs ` +
    `to assess. The collected system_info hostname must match the declared local target before any ` +
    `inventory is accepted. No DNS/service ownership verification applies to a machine assessing ` +
    `itself, and none is claimed.`
  );
}

/**
 * Build the engagement input for a local-mode engagement.
 * @param opts - the local target hostname and the accountable operator.
 * @returns an engagement input whose scope is exactly the local hostname.
 */
export function buildLocalEngagementInput(opts: {
  hostname: string;
  operatorName?: string;
  objective?: string;
  mode?: EngagementInput["mode"];
}): EngagementInput {
  return {
    target: opts.hostname,
    mode: opts.mode ?? "red",
    objective:
      opts.objective ?? "Assess this workstation (local host mode): inventory first, then the host battery.",
    roe: {
      scope: [opts.hostname],
      notes:
        "LOCAL MODE: the target is the machine this runner runs on. Collection is through the " +
        "paired pc-agent channel only (tier-0 reads); no network services (SMB/WinRM/SSH) and no " +
        "target credentials are used. Verification basis: local-operator-possession — see the " +
        "engagement record's verification proof.",
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
export function localChannelFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): LocalChannel | undefined {
  const config = pcAgentConfig(env);
  if (config === undefined) return undefined;
  const transport: FetchLike = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  return createPcAgentClient(config, transport);
}

/** Hostname comparison: case-insensitive, and a short name matches its own FQDN. */
function hostnameMatches(declared: string, collected: string): boolean {
  const a = declared.trim().toLowerCase();
  const b = collected.trim().toLowerCase();
  if (a === "" || b === "") return false;
  return a === b || a === b.split(".")[0] || b === a.split(".")[0];
}

/** Parse a bridge result as JSON when it is JSON; undefined otherwise. */
function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Map a system_info result onto the fields the collector relies on. */
function toSystemInfo(text: string): LocalSystemInfo {
  const record = parseJson(text);
  if (record === undefined) return {};
  return {
    ...(asString(record["system"]) !== undefined ? { system: asString(record["system"]) } : {}),
    ...(asString(record["release"]) !== undefined ? { release: asString(record["release"]) } : {}),
    ...(asString(record["version"]) !== undefined ? { version: asString(record["version"]) } : {}),
    ...(asString(record["machine"]) !== undefined ? { machine: asString(record["machine"]) } : {}),
    ...(asString(record["hostname"]) !== undefined ? { hostname: asString(record["hostname"]) } : {}),
    ...(asString(record["user"]) !== undefined ? { user: asString(record["user"]) } : {}),
    ...(asNumber(record["cpu_percent"]) !== undefined ? { cpuPercent: asNumber(record["cpu_percent"]) } : {}),
    ...(asNumber(record["mem_percent"]) !== undefined ? { memPercent: asNumber(record["mem_percent"]) } : {}),
  };
}

/** Cap one raw bridge result at LOCAL_RAW_CAP, flagging truncation. */
function capRaw(text: string): { raw: string; truncated: boolean } {
  return text.length > LOCAL_RAW_CAP
    ? { raw: text.slice(0, LOCAL_RAW_CAP), truncated: true }
    : { raw: text, truncated: false };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedSection<T>(note: string): LocalInventorySection<T> {
  return { status: "failed", note, batteryCoverage: "none" };
}

function unsupportedSections(): Pick<
  LocalHostInventory["sections"],
  "users" | "installedSoftware" | "services" | "listeningPorts" | "patches"
> {
  const sections: Record<string, LocalInventorySection> = {};
  for (const [name, reason] of UNSUPPORTED_SECTIONS) {
    sections[name] = { status: "unsupported", note: reason, batteryCoverage: "none" };
  }
  return sections as Pick<
    LocalHostInventory["sections"],
    "users" | "installedSoftware" | "services" | "listeningPorts" | "patches"
  >;
}

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
 * identity cannot be read at all), collection aborts and every remaining
 * section is marked failed with the reason. Section failures after the
 * identity gate are per-section: one dead op does not lose the rest.
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

  return {
    ...base,
    target: { declaredHostname: opts.declaredHostname, collectedHostname, hostnameMatch: true },
    sections: {
      system: systemSection,
      processes,
      filesystem,
      ...unsupportedSections(),
    },
  };
}
