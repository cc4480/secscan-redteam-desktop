/**
 * The open memory store, extracted from `store.ts` to keep that module
 * inside the 300-line file budget. The class is moved verbatim: same
 * lock discipline, same append/overlay writes, same manifest
 * persistence and freshness guard. Behaviour is unchanged.
 */
import type { MemoryPaths } from "./paths.js";
import type { MemoryStatusLine, MemoryUnit, MemoryUnitStatus } from "./types.js";
import type { LoadedStore, MemoryManifest } from "./store-load.js";
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
