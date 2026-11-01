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
/** Artifact file name inside the engagement directory. */
export const HOST_INVENTORY_ARTIFACT = "host-inventory.json";
/** Collector identity recorded in the artifact. */
export const LOCAL_COLLECTOR_ID = "local-host collector (pc-agent channel) v1";
/** The system well rows the collector can fill from one system_info result. */
function systemRows(info) {
    const rows = [
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
        .filter((row) => row[1] !== undefined)
        .map(([label, value]) => ({ label, value: String(value) }));
}
/** Rows of one section when it collected; no rows when it did not. */
function sectionRows(section) {
    return section.status === "collected" && section.data !== undefined ? section.data : [];
}
function volumeRows(rows) {
    return rows.map((row) => ({
        name: row.name,
        ...(row.fileSystem !== "" ? { fileSystem: row.fileSystem } : {}),
        sizeBytes: row.sizeBytes,
        freeBytes: row.freeBytes,
    }));
}
function accountRows(rows) {
    return rows.map((row) => ({
        name: row.name,
        kind: row.kind,
        enabled: row.enabled,
        groups: row.groups,
    }));
}
function patchRows(rows) {
    return rows.map((row) => ({
        id: row.id,
        ...(row.installedOn !== "" ? { installedOn: row.installedOn } : {}),
    }));
}
function softwareRows(rows) {
    return rows.map((row) => ({
        name: row.name,
        ...(row.version !== "" ? { version: row.version } : {}),
        ...(row.publisher !== undefined ? { publisher: row.publisher } : {}),
    }));
}
function asRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function asString(value) {
    return typeof value === "string" && value !== "" ? value : undefined;
}
function asNumber(value) {
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
function processRows(section) {
    if (section.status !== "collected" || section.data === undefined)
        return undefined;
    const list = Array.isArray(section.data) ? section.data : asRecord(section.data)?.["processes"];
    if (!Array.isArray(list))
        return undefined;
    const rows = [];
    for (const entry of list) {
        const record = asRecord(entry);
        if (record === undefined)
            continue;
        const name = asString(record["name"]) ?? asString(record["exe"]);
        if (name === undefined)
            continue;
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
export function toHostInventoryArtifact(inventory) {
    if (!inventory.target.hostnameMatch) {
        return {
            status: "failed",
            hostname: inventory.target.declaredHostname,
            collectedAt: inventory.collectedAt,
            error: inventory.sections.system.note ??
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
            patchLevel: inventory.sections.patches.status === "collected"
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
export async function writeHostInventoryArtifact(dir, inventory) {
    const path = join(dir, HOST_INVENTORY_ARTIFACT);
    await writeFile(path, `${JSON.stringify(toHostInventoryArtifact(inventory), null, 2)}\n`, "utf8");
    return path;
}
//# sourceMappingURL=artifact.js.map