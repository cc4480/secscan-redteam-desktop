/**
 * Harness2 trajectory writer (H2-P1).
 *
 * Writes three additive artifacts into an engagement directory:
 *  - trajectory.json (TrajectoryRecord: contract RunMetrics + normalized events),
 *  - metrics.json (the contract RunMetrics alone, so the store can ingest a run
 *    without parsing the events array),
 *  - run.json (section-5 rows: { run, metrics } - the runs + metrics rows).
 *
 * All writes are atomic (tmp + rename) and newer-wins: an existing record with
 * a later finishedAt is never overwritten. An I/O problem is reported as
 * `written: false` instead of thrown, because this is called from an
 * engagement's finally path - capture must never mask a halt or fail a run.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TrajectoryRecord } from "./contract.js";
import { SPEC5_FILE_NAME, type Spec5Rows } from "./spec5.js";

export interface WriteTrajectoryOptions {
  /** Section-5 rows persisted as run.json; omitted => run.json is not written. */
  readonly spec5?: Spec5Rows;
}

export interface WriteTrajectoryResult {
  readonly written: boolean;
  readonly trajectoryPath: string;
  readonly metricsPath: string;
  readonly runPath: string;
  /** Why nothing was written; absent on success. */
  readonly reason?: string;
}

/** finishedAt of an existing record, if it parses (trajectory.json or metrics.json). */
function finishedAtOf(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { finishedAt?: unknown; metrics?: { finishedAt?: unknown } };
    const value = typeof raw.metrics?.finishedAt === "string" ? raw.metrics.finishedAt : raw.finishedAt;
    const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Write a tmp file then rename; Windows rename cannot replace, so unlink first. */
function atomicWrite(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(tmp, body);
    try {
      renameSync(tmp, path);
    } catch {
      rmSync(path, { force: true });
      renameSync(tmp, path);
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

/**
 * Write trajectory.json + metrics.json (+ run.json when section-5 rows are
 * supplied) into the engagement directory. Atomic (tmp + rename, no partial
 * file is ever visible), additively creating the directory, and never
 * overwriting a newer record.
 */
export function writeTrajectory(
  engagementDir: string,
  record: TrajectoryRecord,
  options: WriteTrajectoryOptions = {},
): WriteTrajectoryResult {
  const trajectoryPath = join(engagementDir, "trajectory.json");
  const metricsPath = join(engagementDir, "metrics.json");
  const runPath = join(engagementDir, SPEC5_FILE_NAME);
  try {
    mkdirSync(engagementDir, { recursive: true });
    const existing = finishedAtOf(trajectoryPath) ?? finishedAtOf(metricsPath);
    const incoming = Date.parse(record.metrics.finishedAt);
    if (existing !== undefined && Number.isFinite(incoming) && existing > incoming) {
      return { written: false, trajectoryPath, metricsPath, runPath, reason: "existing record is newer" };
    }
    atomicWrite(trajectoryPath, JSON.stringify(record, null, 2));
    atomicWrite(metricsPath, JSON.stringify(record.metrics, null, 2));
    if (options.spec5 !== undefined) atomicWrite(runPath, JSON.stringify(options.spec5, null, 2));
    return { written: true, trajectoryPath, metricsPath, runPath };
  } catch (err) {
    return { written: false, trajectoryPath, metricsPath, runPath, reason: (err as Error).message };
  }
}
