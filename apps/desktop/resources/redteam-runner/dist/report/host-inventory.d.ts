/** One label/value row (system, Defender, remote-config, hardening wells). */
export interface InventoryRow {
    label: string;
    value: string;
}
export interface InventoryVolume {
    name: string;
    fileSystem?: string;
    sizeBytes?: number;
    freeBytes?: number;
}
export interface InventoryAccount {
    name: string;
    kind: string;
    enabled?: boolean;
    groups?: string[];
}
export interface InventoryPatch {
    id: string;
    installedOn?: string;
}
export interface InventorySoftware {
    name: string;
    version?: string;
    publisher?: string;
}
/** One running process, normalized by the collector's artifact mapper. */
export interface InventoryProcess {
    name: string;
    pid?: number;
    user?: string;
    cpuPercent?: number;
    memoryPercent?: number;
}
export interface InventoryFilesystem {
    totalsByVolume: {
        volume: string;
        files: number;
        bytes: number;
    }[];
    categories: {
        category: string;
        files: number;
        bytes: number;
    }[];
    largestDirectories: {
        path: string;
        bytes: number;
    }[];
    largestFiles: {
        path: string;
        bytes: number;
    }[];
    recentExecutables: {
        path: string;
        modifiedAt: string;
    }[];
    coverage?: string;
}
/** §8 — presence and counts only, never contents. */
export interface InventorySensitive {
    categories: {
        category: string;
        files: number;
    }[];
    credentialLocations: {
        location: string;
        present: boolean;
        note?: string;
    }[];
    stores: {
        store: string;
        entries: number;
    }[];
}
/** The collector's recorded counts, reconciled against the rows. */
export interface InventoryTotals {
    volumes: number;
    accounts: number;
    patches: number;
    software: number;
    files: number;
}
export interface HostInventory {
    hostname: string;
    collectedAt: string;
    collector: string;
    system: InventoryRow[];
    volumes: InventoryVolume[];
    accounts: InventoryAccount[];
    patches: InventoryPatch[];
    patchLevel?: string;
    /** Optional: present only when the collector's mapper carries its process list into the artifact. */
    processes?: InventoryProcess[];
    defender?: InventoryRow[];
    remoteConfig?: InventoryRow[];
    hardening?: InventoryRow[];
    software: InventorySoftware[];
    filesystem?: InventoryFilesystem;
    sensitive?: InventorySensitive;
    totals: InventoryTotals;
}
/** The artifact as the report consumes it: collected, or honestly failed. */
export type HostInventoryArtifact = {
    status: "ok";
    inventory: HostInventory;
} | {
    status: "failed";
    hostname?: string;
    collectedAt?: string;
    error: string;
};
/** Parse + validate a host-inventory.json value. Throws on any contract
 * violation — the caller degrades to the `failed` form, never guesses. */
export declare function parseHostInventory(raw: unknown): HostInventoryArtifact;
/** Counts derived from the row arrays — what the section prints. */
export declare function derivedTotals(inv: HostInventory): InventoryTotals;
/** Recorded vs derived, field by field; empty when they agree. */
export declare function reconcileInventory(inv: HostInventory): string[];
/**
 * Read the artifact from an engagement dir. Absent file => undefined (the
 * engagement is not a local collection, or collection never ran — either
 * way the report renders no inventory section). A present-but-broken
 * artifact degrades to the `failed` form so the report says so.
 */
export declare function readHostInventory(dir: string): HostInventoryArtifact | undefined;
