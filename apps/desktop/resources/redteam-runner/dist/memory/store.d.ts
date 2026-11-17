/**
 * The memory store (brief §2.1/§3): an append-only unit ledger
 * (`units.jsonl`, one JSON object per unit VERSION), a status overlay
 * (`commits.jsonl`, §4.4), a validated manifest, and the §3.3 lock.
 *
 * Posture (§8): bootstrap is allowed ONLY when the root directory itself
 * does not exist. A present-but-broken store is never "repaired" by
 * re-initialization — manifest damage is `STORE_CORRUPT`, a views index
 * that disagrees with the ledger is `STORE_INDEX_MISMATCH` (repair exists
 * only as the explicit `memory reindex` command), a malformed ledger line
 * is `STORE_CORRUPT` naming file + line. Mutations are synchronous
 * start-to-finish under the lock file, mirroring the registry's
 * transaction argument; the lock is never stolen and never held across
 * an `await`.
 */
import type { MemoryPaths } from "./paths.js";
import type { MemoryUnit } from "./types.js";
import { MemoryStore } from "./store-instance.js";
export { MemoryStore } from "./store-instance.js";
export type { StoredUnit, AppendUnitInit } from "./store-instance.js";
export type { MemoryManifest } from "./store-load.js";
/** A unit under construction: trust/views/hash/version are finalized by {@link finalizeUnit}; retrieval telemetry defaults to zero. */
export type UnitDraft = Omit<MemoryUnit, "trust" | "views" | "hash" | "version" | "retrieval"> & {
    version?: number;
    retrieval?: MemoryUnit["retrieval"];
};
/**
 * Finalize a draft unit: derive trust (never taken from the draft's
 * word — an overclaim throws `TRUST_OVERCLAIM`), generate the L0/L1
 * views, bind them to the record's source hash, and seal the record hash.
 *
 * @param draft - The extractor's proposed content.
 * @param derivedAt - ISO timestamp used for trust derivation and view generation.
 * @returns The complete, sealed unit, ready to append.
 */
export declare function finalizeUnit(draft: UnitDraft, derivedAt: string): MemoryUnit;
/**
 * Open the memory store at `paths`, bootstrapping ONLY when the root
 * directory itself does not exist (§8 row 2): first-run creation writes
 * the manifest, the empty ledger + overlay, and the empty views index.
 * An existing root is validated strictly; nothing is auto-repaired.
 *
 * @param paths - The store paths (from `resolveMemoryPaths`).
 * @param nowIso - Bootstrap timestamp (default: now).
 * @returns The open store (`bootstrapped` says whether this call created it).
 */
export declare function openMemoryStore(paths: MemoryPaths, nowIso?: string): MemoryStore;
/**
 * The explicit repair path (§8 row 4): rebuild the views index and every
 * directory view from the ledger, and write a repair receipt. The ledger
 * and manifest are still validated strictly — reindex repairs the INDEX,
 * never the record.
 *
 * @param paths - The store paths.
 * @param nowIso - Timestamp for the rebuild and receipt.
 * @returns The receipt summary (also written to `<root>/reindex-receipt.json`).
 */
export declare function reindexMemoryStore(paths: MemoryPaths, nowIso: string): {
    receiptPath: string;
    dirsRefreshed: string[];
    unitsChecked: number;
};
