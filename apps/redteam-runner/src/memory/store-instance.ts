/**
 * The open memory store, extracted from `store.ts` to keep that module
 * inside the 300-line file budget. The class is moved verbatim: same
 * lock discipline, same append/overlay writes, same manifest
 * persistence and freshness guard. Behaviour is unchanged.
 */

import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { MemoryError } from "./errors.js";
import { directoryKey } from "./paths.js";
import type { MemoryPaths } from "./paths.js";
import { aggregateHashes, canonicalize, validateUnit, verifyUnitHash } from "./schema.js";
import { assertScopeBinding } from "./scope.js";
import { atomicWriteText, readViewsIndex, writeViewsIndex } from "./views.js";
import type { MemoryStatusLine, MemoryUnit, MemoryUnitStatus } from "./types.js";
import { manifestHash, validateManifest } from "./store-load.js";
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
export class MemoryStore {
  readonly paths: MemoryPaths;
  readonly bootstrapped: boolean;
  private readonly state: LoadedStore;
  private lockDepth = 0;

  constructor(paths: MemoryPaths, state: LoadedStore, bootstrapped: boolean) {
    this.paths = paths;
    this.state = state;
    this.bootstrapped = bootstrapped;
  }

  /** The store manifest (identity + counts), kept current by every mutation. */
  get manifest(): MemoryManifest {
    return this.state.manifest;
  }

  /** Current-version units with status `active` — the recall-facing set. */
  listUnits(): MemoryUnit[] {
    return this.listUnitsWithStatus()
      .filter((entry) => entry.status === "active")
      .map((entry) => entry.unit);
  }

  /** Every current-version unit with its overlay status (audit listing). */
  listUnitsWithStatus(): StoredUnit[] {
    return [...this.state.current.values()]
      .map((unit) => ({ unit, status: this.getUnitStatus(unit.unitId) }))
      .sort((a, b) => (a.unit.unitId < b.unit.unitId ? -1 : a.unit.unitId > b.unit.unitId ? 1 : 0));
  }

  /** The current version of a unit, whatever its status. */
  getUnit(unitId: string): MemoryUnit | undefined {
    return this.state.current.get(unitId);
  }

  /** The unit's current overlay status (units appended through this store always carry an overlay line). */
  getUnitStatus(unitId: string): MemoryUnitStatus {
    return this.state.statuses.get(unitId)?.status ?? "active";
  }

  /** True when the unit exists at any status. */
  hasUnit(unitId: string): boolean {
    return this.state.current.has(unitId);
  }

  /**
   * Run `fn` under the store lock (§3.3): the lock file is created with
   * `wx`; a held lock throws `STORE_LOCKED` naming the holder — never
   * stolen, never waited on silently. Reentrant within one store
   * instance; held only across synchronous critical sections.
   *
   * @param fn - The synchronous critical section.
   * @returns The section's result.
   */
  withLock<T>(fn: () => T): T {
    if (this.lockDepth > 0) {
      this.lockDepth += 1;
      try {
        return fn();
      } finally {
        this.lockDepth -= 1;
      }
    }
    try {
      writeFileSync(
        this.paths.lockPath,
        `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`,
        { flag: "wx" },
      );
    } catch {
      let holder = "unknown holder";
      try {
        const raw = JSON.parse(readFileSync(this.paths.lockPath, "utf8")) as { pid?: number; at?: string };
        const ageS = raw.at ? Math.max(0, Math.round((Date.now() - Date.parse(raw.at)) / 1000)) : null;
        holder = `pid ${raw.pid ?? "?"}${ageS !== null ? `, age ${ageS}s` : ""}`;
      } catch {
        // Unreadable lock file — holder stays unknown; the refusal stands.
      }
      throw new MemoryError("STORE_LOCKED", `memory store is locked by ${holder} (${this.paths.lockPath})`);
    }
    this.lockDepth = 1;
    try {
      this.assertManifestFresh();
      return fn();
    } finally {
      this.lockDepth = 0;
      rmSync(this.paths.lockPath, { force: true });
    }
  }

  /**
   * Concurrency guard, run inside the lock before every mutation: this
   * instance mutates from the state it loaded at open, so if another
   * instance (in this or another process) has mutated the store since,
   * the on-disk manifest hash no longer matches the loaded one. Refuse
   * loudly instead of persisting counts derived from stale state —
   * that is what leaves the manifest disagreeing with the ledger
   * (STORE_CORRUPT at the next open) after two writers race.
   */
  private assertManifestFresh(): void {
    let disk: MemoryManifest;
    try {
      disk = validateManifest(JSON.parse(readFileSync(this.paths.manifestPath, "utf8")), this.paths.manifestPath);
    } catch (err) {
      if (err instanceof MemoryError) throw err;
      throw new MemoryError("STORE_CORRUPT", `${this.paths.manifestPath}: manifest unreadable inside the store lock`, { cause: err });
    }
    if (disk.hash !== this.state.manifest.hash) {
      throw new MemoryError(
        "STORE_CONCURRENT_MODIFICATION",
        `memory store at ${this.paths.root} changed on disk since this instance opened it ` +
          `(manifest hash mismatch) — reopen the store and retry; refusing to persist stale state`,
      );
    }
  }

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
  appendUnitVersion(unit: MemoryUnit, init: AppendUnitInit): void {
    this.withLock(() => {
      validateUnit(unit, "appendUnitVersion");
      assertScopeBinding(unit);
      if (!verifyUnitHash(unit)) {
        throw new MemoryError("SCHEMA_INVALID", `appendUnitVersion: unit ${unit.unitId} hash does not verify (seal it first)`);
      }
      const existing = this.state.current.get(unit.unitId);
      const expected = existing ? existing.version + 1 : 1;
      if (unit.version !== expected) {
        throw new MemoryError(
          "SCHEMA_INVALID",
          `appendUnitVersion: unit ${unit.unitId} version ${unit.version}, expected ${expected}`,
        );
      }
      appendFileSync(this.paths.unitsPath, `${canonicalize(unit)}\n`);
      this.state.current.set(unit.unitId, unit);
      this.state.versionCount += 1;
      this.appendStatusLine({
        unitId: unit.unitId,
        version: unit.version,
        status: init.status,
        at: init.at,
        by: init.by,
        reason: init.reason,
        ...(init.diffId ? { diffId: init.diffId } : {}),
      });
      this.touchDirectory(directoryKey(unit.scope));
      this.persistManifest();
    });
  }

  /**
   * Append a status transition for an existing unit (supersede/retire).
   *
   * @param line - The overlay line (unitId, version, status, at, by, reason).
   */
  appendStatus(line: MemoryStatusLine): void {
    this.withLock(() => {
      const unit = this.state.current.get(line.unitId);
      if (!unit) throw new MemoryError("SCHEMA_INVALID", `appendStatus: unknown unit ${line.unitId}`);
      this.appendStatusLine(line);
      this.touchDirectory(directoryKey(unit.scope));
      this.persistManifest();
    });
  }

  /**
   * Allocate the next archive sequence for an engagement (§7.2 Phase 1),
   * persisted in the manifest so a sequence is never reused.
   *
   * @param engagementId - The engagement being committed.
   * @returns The allocated sequence (1-based).
   */
  allocateArchiveSeq(engagementId: string): number {
    return this.withLock(() => {
      const seq = (this.state.manifest.archiveSeqByEngagement[engagementId] ?? 0) + 1;
      this.state.manifest.archiveSeqByEngagement[engagementId] = seq;
      this.persistManifest();
      return seq;
    });
  }

  private appendStatusLine(line: MemoryStatusLine): void {
    appendFileSync(this.paths.commitsPath, `${canonicalize(line)}\n`);
    this.state.statuses.set(line.unitId, line);
    this.state.commitCount += 1;
  }

  /** Keep the views index's per-directory totals/aggregate exact after a mutation; pending grows by one change. */
  private touchDirectory(dirKey: string): void {
    const index = readViewsIndex(this.paths);
    const active = this.listUnitsWithStatus().filter(
      (entry) => entry.status === "active" && directoryKey(entry.unit.scope) === dirKey,
    );
    const existing = index.dirs[dirKey];
    const entry = {
      dir: dirKey,
      totalUnits: active.length,
      coveredUnits: existing?.coveredUnits ?? 0,
      pendingUnitChanges: (existing?.pendingUnitChanges ?? 0) + 1,
      sourceHashAggregate: aggregateHashes(active.map((entry2) => entry2.unit.hash)),
      generatedAt: existing?.generatedAt ?? this.state.manifest.createdAt,
      stale: true,
    };
    index.dirs[dirKey] = entry;
    writeViewsIndex(this.paths, index);
  }

  private persistManifest(): void {
    const { hash: _hash, ...rest } = this.state.manifest;
    const counts = {
      ...rest,
      unitCount: this.state.current.size,
      versionCount: this.state.versionCount,
      commitCount: this.state.commitCount,
    };
    const updated: MemoryManifest = { ...counts, hash: manifestHash(counts) };
    this.state.manifest = updated;
    atomicWriteText(this.paths.manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
  }
}
