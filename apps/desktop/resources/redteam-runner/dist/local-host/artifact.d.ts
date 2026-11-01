import type { LocalHostInventory } from "./types.js";
/** Artifact file name inside the engagement directory. */
export declare const HOST_INVENTORY_ARTIFACT = "host-inventory.json";
/** Collector identity recorded in the artifact. */
export declare const LOCAL_COLLECTOR_ID = "local-host collector (pc-agent channel) v1";
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
/**
 * Map a collected inventory onto the artifact shape.
 * @param inventory - the collector's record.
 * @returns the ok form when the identity gate passed; the failed form otherwise.
 */
export declare function toHostInventoryArtifact(inventory: LocalHostInventory): HostInventoryArtifact;
/**
 * Collect through a channel and write the artifact in one call — the seam
 * the recon-phase wiring uses for local engagements.
 * @param dir - the engagement directory.
 * @param inventory - a collected inventory record.
 * @returns the artifact path.
 */
export declare function writeHostInventoryArtifact(dir: string, inventory: LocalHostInventory): Promise<string>;
