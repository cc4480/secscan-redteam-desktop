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
import type { MemoryStatusLine, MemoryUnit, MemoryUnitStatus } from "./types.js";
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
/** A current-version unit with its overlay status applied. */
export interface StoredUnit {
    unit: MemoryUnit;
    status: MemoryUnitStatus;
}
/** How a freshly appended unit version enters the overlay. */
export interface AppendUnitInit {
    status: MemoryUnitStatus;
    by: string;
    reason: string;
    diffId?: string;
    /** ISO timestamp for the overlay line. */
    at: string;
}
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
interface LoadedStore {
    manifest: MemoryManifest;
    current: Map<string, MemoryUnit>;
    statuses: Map<string, MemoryStatusLine>;
    versionCount: number;
    commitCount: number;
}
/** The open memory store. All mutations are synchronous and locked (§3.3). */
export declare class MemoryStore {
    readonly paths: MemoryPaths;
    readonly bootstrapped: boolean;
    private readonly state;
    private lockDepth;
    constructor(paths: MemoryPaths, state: LoadedStore, bootstrapped: boolean);
    /** The store manifest (identity + counts), kept current by every mutation. */
    get manifest(): MemoryManifest;
    /** Current-version units with status `active` — the recall-facing set. */
    listUnits(): MemoryUnit[];
    /** Every current-version unit with its overlay status (audit listing). */
    listUnitsWithStatus(): StoredUnit[];
    /** The current version of a unit, whatever its status. */
    getUnit(unitId: string): MemoryUnit | undefined;
    /** The unit's current overlay status (units appended through this store always carry an overlay line). */
    getUnitStatus(unitId: string): MemoryUnitStatus;
    /** True when the unit exists at any status. */
    hasUnit(unitId: string): boolean;
    /**
     * Run `fn` under the store lock (§3.3): the lock file is created with
     * `wx`; a held lock throws `STORE_LOCKED` naming the holder — never
     * stolen, never waited on silently. Reentrant within one store
     * instance; held only across synchronous critical sections.
     *
     * @param fn - The synchronous critical section.
     * @returns The section's result.
     */
    withLock<T>(fn: () => T): T;
    /**
     * Concurrency guard, run inside the lock before every mutation: this
     * instance mutates from the state it loaded at open, so if another
     * instance (in this or another process) has mutated the store since,
     * the on-disk manifest hash no longer matches the loaded one. Refuse
     * loudly instead of persisting counts derived from stale state —
     * that is what leaves the manifest disagreeing with the ledger
     * (STORE_CORRUPT at the next open) after two writers race.
     */
    private assertManifestFresh;
    /**
     * Append one unit version + its initial overlay line. The unit must be
     * complete and sealed (see {@link finalizeUnit}); it is validated and
     * scope-bound again here — an invalid record is never written (§4).
     * Version sequencing is enforced: a new unit starts at 1, a known unit
     * continues at current + 1.
     *
     * @param unit - The sealed unit version.
     * @param init - The initial overlay status for this version.
     */
    appendUnitVersion(unit: MemoryUnit, init: AppendUnitInit): void;
    /**
     * Append a status transition for an existing unit (supersede/retire).
     *
     * @param line - The overlay line (unitId, version, status, at, by, reason).
     */
    appendStatus(line: MemoryStatusLine): void;
    /**
     * Allocate the next archive sequence for an engagement (§7.2 Phase 1),
     * persisted in the manifest so a sequence is never reused.
     *
     * @param engagementId - The engagement being committed.
     * @returns The allocated sequence (1-based).
     */
    allocateArchiveSeq(engagementId: string): number;
    private appendStatusLine;
    /** Keep the views index's per-directory totals/aggregate exact after a mutation; pending grows by one change. */
    private touchDirectory;
    private persistManifest;
}
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
export {};
