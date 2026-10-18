/**
 * Harness2 permanent layer archive (H2-P3, spec sections 11.2/11.3).
 *
 * A layer is NEVER deleted. Rollback and consolidation MOVE the layer directory
 * out of `<paths.layers>/` into a dated, manifest-bearing archive directory
 * under `<paths.root>/archive/`:
 *
 *   archive/<YYYY-MM-DD>-rollback-<reason>/<layer-id>/{layer.yml,meta.json}
 *   archive/<YYYY-MM-DD>-consolidated/<layer-id>/{layer.yml,meta.json}
 *   archive/<YYYY-MM-DD>-incident-<reason>/<layer-id>/...
 *   ... and manifest.json next to the layer directories.
 *
 * The manifest records the operation (kind, reason, timestamps, active set
 * before/after) and a per-layer snapshot (id, targetClass, adoptedAt,
 * evidenceRunId, installedAt, sha256) plus whatever metrics the caller supplies
 * (gate scores, rollback trigger, measured deltas). That is the "ids, dates,
 * metrics" record the spec requires, and it survives forever.
 *
 * Archive directories are never overwritten and never pruned: a name collision
 * gets a `-2`, `-3`, ... suffix, so two consolidations on the same date both
 * stay readable. `moveLayersToArchive` verifies every source layer before it
 * creates anything, and verifies every archived layer document after the move,
 * so a partial archive is loud rather than silent.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Harness2Paths } from "./contract.js";
import { LAYER_FILE, layerDir } from "./layers.js";

/** `<root>/archive`. */
export function archiveRoot(paths: Harness2Paths): string {
  return join(paths.root, "archive");
}

/** UTC YYYY-MM-DD archive stamp. */
export function archiveDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Sanitize a free-text rollback reason into a safe single archive-name segment. */
export function sanitizeArchiveReason(reason: string): string {
  const cleaned = reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return cleaned === "" ? "unspecified" : cleaned;
}

/** mkdir -p that returns the path; small wrapper so callers stay short. */
function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/** First free `<parent>/<name>` (then `-2`, `-3`, ...): an archive is never overwritten. */
export function uniqueArchivePath(parent: string, name: string): string {
  let candidate = join(parent, name);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = join(parent, `${name}-${counter}`);
    counter += 1;
  }
  return candidate;
}

/** What kind of lifecycle operation produced an archive directory. */
export type ArchiveKind = "consolidated" | "rollback" | "incident";

/** One layer as captured in an archive manifest. */
export interface ArchivedLayerSnapshot {
  readonly id: string;
  readonly dir: string;
  readonly targetClass: string | null;
  readonly adoptedAt: string;
  readonly evidenceRunId: string;
  readonly installedAt: string;
  readonly sha256: string;
}

/** Read a layer's meta.json tolerantly; [] fields become "" when absent/corrupt. */
function snapshotLayer(paths: Harness2Paths, id: string): ArchivedLayerSnapshot {
  const dir = layerDir(paths, id);
  let meta: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as unknown;
    if (raw !== null && typeof raw === "object") meta = raw as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const text = (name: string): string => (typeof meta[name] === "string" ? (meta[name] as string) : "");
  return {
    id: typeof meta["id"] === "string" ? (meta["id"] as string) : id,
    dir: basename(dir),
    targetClass: typeof meta["targetClass"] === "string" ? (meta["targetClass"] as string) : null,
    adoptedAt: text("adoptedAt"),
    evidenceRunId: text("evidenceRunId"),
    installedAt: text("installedAt"),
    sha256: text("sha256"),
  };
}

export interface ArchiveMoveInput {
  readonly paths: Harness2Paths;
  /** Layer ids to move, in active-set order. */
  readonly layerIds: readonly string[];
  readonly kind: ArchiveKind;
  /** Free-text reason (rollback cause / incident cause); absent for consolidation. */
  readonly reason?: string;
  /** UTC date for the directory name; defaults to today. */
  readonly date?: string;
  readonly now?: Date;
  /** Caller metrics/metadata merged into manifest.json (never replaces layers[]). */
  readonly manifest?: Readonly<Record<string, unknown>>;
}

export interface ArchiveMoveResult {
  /** The dated archive directory (unique; never an existing one). */
  readonly dir: string;
  readonly manifestPath: string;
  readonly createdAt: string;
  readonly layers: readonly ArchivedLayerSnapshot[];
}

/** The dated directory name for one operation: `<date>-<kind>[-<reason>]`. */
export function archiveDirName(kind: ArchiveKind, reason: string | undefined, date: string): string {
  return kind === "consolidated" ? `${date}-consolidated` : `${date}-${kind}-${sanitizeArchiveReason(reason ?? kind)}`;
}

/**
 * Move layer directories into a new dated archive directory and write its
 * manifest. Every source is validated BEFORE anything is created; after the
 * move every archived layer must still carry its `layer.yml`, so a lost layer is
 * reported instead of silently dropped. Never deletes an archive.
 */
export function moveLayersToArchive(input: ArchiveMoveInput): ArchiveMoveResult {
  const { paths } = input;
  if (input.layerIds.length === 0) throw new Error("[harness2] archive refused: no layer ids given");
  const unique = [...new Set(input.layerIds)];
  const snapshots = unique.map((id) => snapshotLayer(paths, id));
  for (const snapshot of snapshots) {
    const source = layerDir(paths, snapshot.id);
    if (!existsSync(source)) throw new Error(`[harness2] archive refused: layer "${snapshot.id}" is not installed under ${paths.layers}`);
    if (!statSync(source).isDirectory()) throw new Error(`[harness2] archive refused: "${source}" is not a directory`);
  }
  const date = input.date ?? archiveDate(input.now);
  const dir = uniqueArchivePath(archiveRoot(paths), archiveDirName(input.kind, input.reason, date));
  ensureDir(dir);
  const archived: ArchivedLayerSnapshot[] = [];
  for (const snapshot of snapshots) {
    const source = layerDir(paths, snapshot.id);
    const target = join(dir, snapshot.id);
    try {
      renameSync(source, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      cpSync(source, target, { recursive: true });
      rmSync(source, { recursive: true, force: true });
    }
    if (!existsSync(join(target, LAYER_FILE))) {
      throw new Error(`[harness2] archive lost layer "${snapshot.id}": ${join(target, LAYER_FILE)} is missing after the move`);
    }
    archived.push(snapshot);
  }
  const createdAt = (input.now ?? new Date()).toISOString();
  const manifest = {
    kind: input.kind,
    reason: input.reason ?? null,
    date,
    createdAt,
    layerIds: archived.map((layer) => layer.id),
    layers: archived,
    ...input.manifest,
  };
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifestPath, createdAt, layers: archived };
}

/** Every archive directory on disk, newest name first (missing archive root = []). */
export function listArchiveDirs(paths: Harness2Paths): string[] {
  try {
    return readdirSync(archiveRoot(paths), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(archiveRoot(paths), entry.name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Find an already-archived layer directory by id, across every archive; null when never archived. */
export function findArchivedLayer(paths: Harness2Paths, layerId: string): string | null {
  for (const dir of listArchiveDirs(paths)) {
    const candidate = join(dir, layerId);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

/** Read one archive manifest tolerantly; null when absent or unreadable. */
export function readArchiveManifest(dir: string): Record<string, unknown> | null {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
