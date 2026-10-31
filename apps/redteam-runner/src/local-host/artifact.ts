/**
 * Local host mode — the `host-inventory.json` engagement artifact.
 *
 * Pair contract (rp11 build log): when a local engagement runs, the
 * collector writes ONE artifact into the engagement directory and the
 * report renders from it. This module maps the collector's record
 * (types.ts) onto that artifact's shape. The four enumeration blocks
 * (volumes, accounts, patches, software) carry the tier-2 collection's
 * real rows and reconciling totals; a block whose tier-2 collection did
 * not complete carries no rows and a zero total — the renderer is
 * responsible for presenting an empty required block as "not collected",
 * never as "none exist" (flagged in the pair log). Optional blocks the
 * collector cannot fill (defender, remoteConfig, hardening, filesystem,
 * sensitive) are omitted entirely: an absent block renders nothing.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { patchLevelSummary } from "./scripts.js";
import type {
  LocalAccountRow,
  LocalHostInventory,
  LocalInventorySection,
  LocalPatchRow,
  LocalSoftwareRow,
  LocalSystemInfo,
  LocalVolumeRow,
} from "./types.js";

/** Artifact file name inside the engagement directory. */
export const HOST_INVENTORY_ARTIFACT = "host-inventory.json";

/** Collector identity recorded in the artifact. */
export const LOCAL_COLLECTOR_ID = "local-host collector (pc-agent channel) v1";

/** One label/value row in the artifact's well sections. */
export interface HostInventoryWellRow {
  readonly label: string;
  readonly value: string;
}

/** One volume row in the artifact (fileSystem omitted when unreported). */
export interface HostInventoryVolumeRow {
  readonly name: string;
  readonly fileSystem?: string;
  readonly sizeBytes: number;
  readonly freeBytes: number;
}

/** One account row in the artifact. */
export interface HostInventoryAccountRow {
  readonly name: string;
  readonly kind: string;
  readonly enabled: boolean;
  readonly groups: readonly string[];
}

/** One hotfix row in the artifact (installedOn omitted when unknown). */
export interface HostInventoryPatchRow {
  readonly id: string;
  readonly installedOn?: string;
}

/** One software row in the artifact (empty version/publisher omitted). */
export interface HostInventorySoftwareRow {
  readonly name: string;
  readonly version?: string;
  readonly publisher?: string;
}

/**
 * One process row in the artifact — the optional processes block B's
 * renderer supports. The bridge's list_processes rows carry pid + exe
 * name only; user/CPU/memory stay absent rather than invented.
 */
export interface HostInventoryProcessRow {
  readonly name: string;
  readonly pid?: number;
  readonly user?: string;
  readonly cpuPercent?: number;
  readonly memoryPercent?: number;
}

/** The ok form of the artifact (see the pair contract for the full shape). */
export interface HostInventoryArtifactOk {
  readonly status: "ok";
  readonly inventory: {
    readonly hostname: string;
    readonly collectedAt: string;
    readonly collector: string;
    readonly system: readonly HostInventoryWellRow[];
    readonly volumes: readonly HostInventoryVolumeRow[];
    readonly accounts: readonly HostInventoryAccountRow[];
    readonly patches: readonly HostInventoryPatchRow[];
    /** Summary when the patch block was collected; the not-collected line otherwise. */
    readonly patchLevel: string;
    readonly software: readonly HostInventorySoftwareRow[];
    /** Optional block: present only when the process list was collected. */
    readonly processes?: readonly HostInventoryProcessRow[];
    readonly totals: {
      readonly volumes: number;
      readonly accounts: number;
      readonly patches: number;
      readonly software: number;
      readonly files: number;
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

/** Rows of one section when it collected; no rows when it did not. */
function sectionRows<T>(section: LocalInventorySection<readonly T[]>): readonly T[] {
  return section.status === "collected" && section.data !== undefined ? section.data : [];
}

function volumeRows(rows: readonly LocalVolumeRow[]): HostInventoryVolumeRow[] {
  return rows.map((row) => ({
    name: row.name,
    ...(row.fileSystem !== "" ? { fileSystem: row.fileSystem } : {}),
    sizeBytes: row.sizeBytes,
    freeBytes: row.freeBytes,
  }));
}

function accountRows(rows: readonly LocalAccountRow[]): HostInventoryAccountRow[] {
  return rows.map((row) => ({
    name: row.name,
    kind: row.kind,
    enabled: row.enabled,
    groups: row.groups,
  }));
}

function patchRows(rows: readonly LocalPatchRow[]): HostInventoryPatchRow[] {
  return rows.map((row) => ({
    id: row.id,
    ...(row.installedOn !== "" ? { installedOn: row.installedOn } : {}),
  }));
}

function softwareRows(rows: readonly LocalSoftwareRow[]): HostInventorySoftwareRow[] {
  return rows.map((row) => ({
    name: row.name,
    ...(row.version !== "" ? { version: row.version } : {}),
    ...(row.publisher !== undefined ? { publisher: row.publisher } : {}),
  }));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Map the tier-0 process section onto the optional processes block. The
 * bridge answers list_processes as a `{ count, processes }` envelope
 * whose rows carry `pid` + `exe` (+ `parent`, which the report shape has
 * no column for); a bare row array is accepted too. Rows without a name
 * are skipped, and the block is omitted entirely when the section did
 * not collect or no row maps — an omitted optional block renders
 * nothing, which is the honest form for uncollected processes.
 * @param section - the collector's process section (untyped data).
 * @returns the artifact rows, or undefined to omit the block.
 */
function processRows(section: LocalInventorySection): HostInventoryProcessRow[] | undefined {
  if (section.status !== "collected" || section.data === undefined) return undefined;
  const list: unknown = Array.isArray(section.data) ? section.data : asRecord(section.data)?.["processes"];
  if (!Array.isArray(list)) return undefined;
  const rows: HostInventoryProcessRow[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (record === undefined) continue;
    const name = asString(record["name"]) ?? asString(record["exe"]);
    if (name === undefined) continue;
    const pid = asNumber(record["pid"]);
    const user = asString(record["user"]);
    const cpuPercent = asNumber(record["cpuPercent"] ?? record["cpu_percent"]);
    const memoryPercent = asNumber(record["memoryPercent"] ?? record["memory_percent"]);
    rows.push({
      name,
      ...(pid !== undefined ? { pid } : {}),
      ...(user !== undefined ? { user } : {}),
      ...(cpuPercent !== undefined ? { cpuPercent } : {}),
      ...(memoryPercent !== undefined ? { memoryPercent } : {}),
    });
  }
  return rows.length > 0 ? rows : undefined;
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
  const volumes = volumeRows(sectionRows(inventory.sections.volumes));
  const accounts = accountRows(sectionRows(inventory.sections.users));
  const patches = patchRows(sectionRows(inventory.sections.patches));
  const software = softwareRows(sectionRows(inventory.sections.installedSoftware));
  const processes = processRows(inventory.sections.processes);
  return {
    status: "ok",
    inventory: {
      hostname: inventory.target.collectedHostname ?? inventory.target.declaredHostname,
      collectedAt: inventory.collectedAt,
      collector: LOCAL_COLLECTOR_ID,
      system: systemRows(inventory.sections.system.data ?? {}),
      volumes,
      accounts,
      patches,
      patchLevel:
        inventory.sections.patches.status === "collected"
          ? patchLevelSummary(inventory.sections.patches.data ?? [])
          : "Patch level not collected: the tier-2 Get-HotFix collection did not complete (Q-RP-11).",
      software,
      ...(processes !== undefined ? { processes } : {}),
      totals: {
        volumes: volumes.length,
        accounts: accounts.length,
        patches: patches.length,
        software: software.length,
        files: 0,
      },
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
