/**
 * Local host mode — the `host-inventory.json` engagement artifact.
 *
 * Pair contract (rp11 build log): when a local engagement runs, the
 * collector writes ONE artifact into the engagement directory and the
 * report renders from it. This module maps the collector's record
 * (types.ts) onto that artifact's shape. The mapping is honest about the
 * channel's limits: blocks the pc-agent channel cannot enumerate
 * (volumes, accounts, patches, software) are present because the artifact
 * contract requires them, but they carry no rows — the renderer is
 * responsible for presenting an empty required block as "not collected",
 * never as "none exist" (flagged in the pair log). Optional blocks the
 * collector cannot fill (defender, remoteConfig, hardening, filesystem,
 * sensitive) are omitted entirely: an absent block renders nothing.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LocalHostInventory, LocalSystemInfo } from "./types.js";

/** Artifact file name inside the engagement directory. */
export const HOST_INVENTORY_ARTIFACT = "host-inventory.json";

/** Collector identity recorded in the artifact. */
export const LOCAL_COLLECTOR_ID = "local-host collector (pc-agent channel) v1";

/** One label/value row in the artifact's well sections. */
export interface HostInventoryWellRow {
  readonly label: string;
  readonly value: string;
}

/** The ok form of the artifact (see the pair contract for the full shape). */
export interface HostInventoryArtifactOk {
  readonly status: "ok";
  readonly inventory: {
    readonly hostname: string;
    readonly collectedAt: string;
    readonly collector: string;
    readonly system: readonly HostInventoryWellRow[];
    readonly volumes: readonly never[];
    readonly accounts: readonly never[];
    readonly patches: readonly never[];
    /** Prose line: why the patch block carries no rows in v1. */
    readonly patchLevel: string;
    readonly software: readonly never[];
    readonly totals: {
      readonly volumes: 0;
      readonly accounts: 0;
      readonly patches: 0;
      readonly software: 0;
      readonly files: 0;
    };
  };
}

/** The failed form: collection failed, and the artifact says so plainly. */
export interface HostInventoryArtifactFailed {
  readonly status: "failed";
  readonly hostname: string;
  readonly collectedAt: string;
  readonly error: string;
}

/** Either artifact form. */
export type HostInventoryArtifact = HostInventoryArtifactOk | HostInventoryArtifactFailed;

/** The system well rows the collector can fill from one system_info result. */
function systemRows(info: LocalSystemInfo): HostInventoryWellRow[] {
  const rows: Array<readonly [string, string | number | undefined]> = [
    ["OS", info.system],
    ["Release", info.release],
    ["Build", info.version],
    ["Architecture", info.machine],
    ["Hostname", info.hostname],
    ["Signed-in user", info.user],
    ["CPU %", info.cpuPercent],
    ["Memory %", info.memPercent],
  ];
  return rows
    .filter((row): row is readonly [string, string | number] => row[1] !== undefined)
    .map(([label, value]) => ({ label, value: String(value) }));
}

/**
 * Map a collected inventory onto the artifact shape.
 * @param inventory - the collector's record.
 * @returns the ok form when the identity gate passed; the failed form otherwise.
 */
export function toHostInventoryArtifact(inventory: LocalHostInventory): HostInventoryArtifact {
  if (!inventory.target.hostnameMatch) {
    return {
      status: "failed",
      hostname: inventory.target.declaredHostname,
      collectedAt: inventory.collectedAt,
      error:
        inventory.sections.system.note ??
        "local collection failed: the collected hostname did not match the declared local target",
    };
  }
  return {
    status: "ok",
    inventory: {
      hostname: inventory.target.collectedHostname ?? inventory.target.declaredHostname,
      collectedAt: inventory.collectedAt,
      collector: LOCAL_COLLECTOR_ID,
      system: systemRows(inventory.sections.system.data ?? {}),
      volumes: [],
      accounts: [],
      patches: [],
      patchLevel:
        "Patch level not collected: the pc-agent channel has no patch-enumeration op (Q-RP-11 v1).",
      software: [],
      totals: { volumes: 0, accounts: 0, patches: 0, software: 0, files: 0 },
    },
  };
}

/**
 * Collect through a channel and write the artifact in one call — the seam
 * the recon-phase wiring uses for local engagements.
 * @param dir - the engagement directory.
 * @param inventory - a collected inventory record.
 * @returns the artifact path.
 */
export async function writeHostInventoryArtifact(
  dir: string,
  inventory: LocalHostInventory,
): Promise<string> {
  const path = join(dir, HOST_INVENTORY_ARTIFACT);
  await writeFile(path, `${JSON.stringify(toHostInventoryArtifact(inventory), null, 2)}\n`, "utf8");
  return path;
}
