/**
 * Store state loading and manifest validation, extracted from `store.ts`
 * to keep that module inside the 300-line file budget. Moved verbatim:
 * the manifest seal/validate rules, JSONL ledger parsing, the strict
 * load path and the views-index consistency check. Behaviour unchanged.
 */
import type { MemoryPaths } from "./paths.js";
import type { MemoryStatusLine, MemoryUnit } from "./types.js";
/** `manifest.json`: store identity + counts + last archive seq (§2.2). */
export interface MemoryManifest {
    version: 1;
    storeId: string;
    createdAt: string;
    /** Distinct unitIds in the ledger. */
    unitCount: number;
    /** Total unit version lines in the ledger. */
    versionCount: number;
    /** Total status-overlay lines. */
    commitCount: number;
    /** Last allocated archive sequence per engagement (§7.2 Phase 1). */
    archiveSeqByEngagement: Record<string, number>;
    /** sha256 over the canonical manifest excluding this field. */
    hash: string;
}
export interface LoadedStore {
    manifest: MemoryManifest;
    current: Map<string, MemoryUnit>;
    statuses: Map<string, MemoryStatusLine>;
    versionCount: number;
    commitCount: number;
}
export declare function manifestHash(manifest: Omit<MemoryManifest, "hash">): string;
export declare function sealManifest(manifest: Omit<MemoryManifest, "hash">): MemoryManifest;
export declare function validateManifest(raw: unknown, path: string): MemoryManifest;
export declare function loadStore(paths: MemoryPaths, opts?: {
    skipIndexCheck?: boolean;
}): LoadedStore;
