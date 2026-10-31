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

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MemoryError } from "./errors.js";
import { directoryKey } from "./paths.js";
import type { MemoryPaths } from "./paths.js";
import { aggregateHashes, canonicalize, hashRecord, parseUnitLine, sealUnit, validateUnit, verifyUnitHash } from "./schema.js";
import { assertScopeBinding } from "./scope.js";
import { deriveTrust } from "./trust.js";
import {
  atomicWriteText,
  generateUnitViews,
  readViewsIndex,
  refreshDirectoryView,
  unitViewSourceHash,
  writeViewsIndex,
  VIEW_GENERATOR_VERSION,
} from "./views.js";
import type {
  MemoryStatusLine,
  MemoryUnit,
  MemoryUnitStatus,
  MemoryViews,
} from "./types.js";

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
export function finalizeUnit(draft: UnitDraft, derivedAt: string): MemoryUnit {
  const trust = deriveTrust(
    {
      proof: draft.proof,
      corroboration: draft.corroboration,
      contentClass: draft.contentClass,
      sourceRefs: draft.provenance.sourceRefs,
    },
    derivedAt,
  );
  const withTrust: Omit<MemoryUnit, "views" | "hash"> = {
    ...draft,
    version: draft.version ?? 1,
    retrieval: draft.retrieval ?? { retrievalCount: 0 },
    trust,
  };
  const generated = generateUnitViews(withTrust);
  const views: MemoryViews = {
    ...generated,
    sourceHash: "",
    generatedAt: derivedAt,
    generator: VIEW_GENERATOR_VERSION,
    stale: false,
  };
  const assembled: Omit<MemoryUnit, "hash"> = { ...withTrust, views };
  views.sourceHash = unitViewSourceHash(assembled);
  return sealUnit(assembled);
}

interface LoadedStore {
  manifest: MemoryManifest;
  current: Map<string, MemoryUnit>;
  statuses: Map<string, MemoryStatusLine>;
  versionCount: number;
  commitCount: number;
}

function manifestHash(manifest: Omit<MemoryManifest, "hash">): string {
  return hashRecord(manifest);
}

function sealManifest(manifest: Omit<MemoryManifest, "hash">): MemoryManifest {
  return { ...manifest, hash: manifestHash(manifest) };
}

function validateManifest(raw: unknown, path: string): MemoryManifest {
  const rec = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const bad = (detail: string): MemoryError => new MemoryError("STORE_CORRUPT", `${path}: manifest ${detail}`);
  if (rec.version !== 1) throw bad(`has unsupported version ${JSON.stringify(rec.version)}`);
  if (typeof rec.storeId !== "string" || !rec.storeId) throw bad("is missing storeId");
  if (typeof rec.createdAt !== "string" || !Number.isFinite(Date.parse(rec.createdAt))) throw bad("has a bad createdAt");
  for (const field of ["unitCount", "versionCount", "commitCount"] as const) {
    if (!Number.isInteger(rec[field]) || (rec[field] as number) < 0) throw bad(`has a bad ${field}`);
  }
  if (typeof rec.archiveSeqByEngagement !== "object" || rec.archiveSeqByEngagement === null) {
    throw bad("has a bad archiveSeqByEngagement");
  }
  const manifest = raw as MemoryManifest;
  const { hash, ...rest } = manifest;
  if (hash !== manifestHash(rest)) throw bad("hash mismatch (manifest was altered after sealing)");
  return manifest;
}

/** Split a JSONL file's content into lines; a torn final line stays a line and fails parsing downstream. */
function ledgerLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function loadStore(paths: MemoryPaths, opts: { skipIndexCheck?: boolean } = {}): LoadedStore {
  if (!existsSync(paths.manifestPath)) {
    throw new MemoryError("STORE_CORRUPT", `${paths.manifestPath}: manifest missing in an existing store root`);
  }
  let manifest: MemoryManifest;
  try {
    manifest = validateManifest(JSON.parse(readFileSync(paths.manifestPath, "utf8")), paths.manifestPath);
  } catch (err) {
    if (err instanceof MemoryError) throw err;
    throw new MemoryError("STORE_CORRUPT", `${paths.manifestPath}: manifest unparseable`, { cause: err });
  }
  if (!existsSync(paths.unitsPath)) {
    throw new MemoryError("STORE_CORRUPT", `${paths.unitsPath}: unit ledger missing in an existing store`);
  }
  const current = new Map<string, MemoryUnit>();
  const seenVersions = new Set<string>();
  const unitLines = ledgerLines(readFileSync(paths.unitsPath, "utf8"));
  for (const [i, line] of unitLines.entries()) {
    const unit = parseUnitLine(line, i + 1, paths.unitsPath);
    const versionKey = `${unit.unitId}@${unit.version}`;
    if (seenVersions.has(versionKey)) {
      throw new MemoryError("STORE_CORRUPT", `${paths.unitsPath}:${i + 1}: duplicate version line for ${versionKey}`);
    }
    seenVersions.add(versionKey);
    const existing = current.get(unit.unitId);
    if (!existing || unit.version > existing.version) current.set(unit.unitId, unit);
  }
  const statuses = new Map<string, MemoryStatusLine>();
  let commitCount = 0;
  if (!existsSync(paths.commitsPath)) {
    throw new MemoryError("STORE_CORRUPT", `${paths.commitsPath}: status overlay missing in an existing store`);
  }
  const commitLines = ledgerLines(readFileSync(paths.commitsPath, "utf8"));
  for (const [i, line] of commitLines.entries()) {
    let parsed: MemoryStatusLine;
    try {
      parsed = JSON.parse(line) as MemoryStatusLine;
    } catch (err) {
      throw new MemoryError("STORE_CORRUPT", `${paths.commitsPath}:${i + 1}: invalid JSON`, { cause: err });
    }
    if (
      typeof parsed.unitId !== "string" ||
      !Number.isInteger(parsed.version) ||
      !["active", "proposed", "superseded", "retired"].includes(parsed.status) ||
      typeof parsed.at !== "string" ||
      typeof parsed.by !== "string" ||
      typeof parsed.reason !== "string"
    ) {
      throw new MemoryError("STORE_CORRUPT", `${paths.commitsPath}:${i + 1}: malformed status line`);
    }
    statuses.set(parsed.unitId, parsed);
    commitCount += 1;
  }
  if (manifest.unitCount !== current.size || manifest.versionCount !== unitLines.length || manifest.commitCount !== commitCount) {
    throw new MemoryError(
      "STORE_CORRUPT",
      `${paths.manifestPath}: manifest counts (units ${manifest.unitCount}, versions ${manifest.versionCount}, commits ${manifest.commitCount}) ` +
        `disagree with the ledger (units ${current.size}, versions ${unitLines.length}, commits ${commitCount})`,
    );
  }
  if (!opts.skipIndexCheck) validateViewsIndex(paths, current, statuses);
  return { manifest, current, statuses, versionCount: unitLines.length, commitCount };
}

/** §8 row 4: the views index must agree with the ledger, or open fails. */
function validateViewsIndex(
  paths: MemoryPaths,
  current: Map<string, MemoryUnit>,
  statuses: Map<string, MemoryStatusLine>,
): void {
  if (!existsSync(paths.viewsIndexPath)) {
    throw new MemoryError(
      "STORE_INDEX_MISMATCH",
      `${paths.viewsIndexPath}: views index missing (repair: memory reindex)`,
    );
  }
  const index = readViewsIndex(paths);
  const activeByDir = new Map<string, MemoryUnit[]>();
  for (const unit of current.values()) {
    if ((statuses.get(unit.unitId)?.status ?? "active") !== "active") continue;
    const key = directoryKey(unit.scope);
    activeByDir.set(key, [...(activeByDir.get(key) ?? []), unit]);
  }
  for (const [dir, units] of activeByDir) {
    const entry = index.dirs[dir];
    if (!entry) {
      throw new MemoryError("STORE_INDEX_MISMATCH", `views.json has no entry for ${dir} (repair: memory reindex)`);
    }
    const aggregate = aggregateHashes(units.map((u) => u.hash));
    if (entry.totalUnits !== units.length || entry.sourceHashAggregate !== aggregate) {
      throw new MemoryError(
        "STORE_INDEX_MISMATCH",
        `views.json entry for ${dir} disagrees with the ledger (repair: memory reindex)`,
      );
    }
  }
  for (const [dir, entry] of Object.entries(index.dirs)) {
    if (!activeByDir.has(dir) && entry.totalUnits !== 0) {
      throw new MemoryError(
        "STORE_INDEX_MISMATCH",
        `views.json entry for ${dir} claims ${entry.totalUnits} units the ledger does not hold (repair: memory reindex)`,
      );
    }
  }
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
      return fn();
    } finally {
      this.lockDepth = 0;
      rmSync(this.paths.lockPath, { force: true });
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
export function openMemoryStore(paths: MemoryPaths, nowIso: string = new Date().toISOString()): MemoryStore {
  if (!existsSync(paths.root)) {
    mkdirSync(paths.viewsDir, { recursive: true });
    mkdirSync(paths.archivesDir, { recursive: true });
    mkdirSync(paths.proposalsDir, { recursive: true });
    mkdirSync(paths.recallDir, { recursive: true });
    writeFileSync(paths.unitsPath, "");
    writeFileSync(paths.commitsPath, "");
    const manifest = sealManifest({
      version: 1,
      storeId: randomUUID(),
      createdAt: nowIso,
      unitCount: 0,
      versionCount: 0,
      commitCount: 0,
      archiveSeqByEngagement: {},
    });
    atomicWriteText(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeViewsIndex(paths, { version: 1, dirs: {} });
    return new MemoryStore(paths, { manifest, current: new Map(), statuses: new Map(), versionCount: 0, commitCount: 0 }, true);
  }
  return new MemoryStore(paths, loadStore(paths), false);
}

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
export function reindexMemoryStore(
  paths: MemoryPaths,
  nowIso: string,
): { receiptPath: string; dirsRefreshed: string[]; unitsChecked: number } {
  const state = loadStore(paths, { skipIndexCheck: true });
  const store = new MemoryStore(paths, state, false);
  const dirKeys = new Set<string>();
  for (const entry of store.listUnitsWithStatus()) dirKeys.add(directoryKey(entry.unit.scope));
  if (existsSync(paths.viewsIndexPath)) {
    for (const key of Object.keys(readViewsIndex(paths).dirs)) dirKeys.add(key);
  }
  const dirsRefreshed: string[] = [];
  for (const dirKey of [...dirKeys].sort()) {
    refreshDirectoryView(store, dirKey, nowIso);
    dirsRefreshed.push(dirKey);
  }
  const receiptPath = join(paths.root, "reindex-receipt.json");
  atomicWriteText(
    receiptPath,
    `${JSON.stringify(
      { at: nowIso, storeRoot: paths.root, manifestHash: state.manifest.hash, unitsChecked: state.versionCount, dirsRefreshed },
      null,
      2,
    )}\n`,
  );
  return { receiptPath, dirsRefreshed, unitsChecked: state.versionCount };
}
