/**
 * Harness2 trajectory writer (H2-P1a).
 *
 * Writes trajectory.json (TrajectoryRecord) and metrics.json (RunMetrics alone)
 * atomically into an engagement directory. Fail-soft and newer-wins: an
 * existing record with a later finishedAt is never overwritten, and an I/O
 * problem is reported as `written: false` instead of thrown, because this is
 * called from an engagement's finally path.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TrajectoryRecord } from "./contract.js";

export interface WriteTrajectoryResult {
  readonly written: boolean;
  readonly trajectoryPath: string;
  readonly metricsPath: string;
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
 * Write trajectory.json + metrics.json into the engagement directory.
 * Atomic (tmp + rename, no partial file is ever visible), additively creating
 * the directory, and never overwriting a newer record.
 */
export function writeTrajectory(engagementDir: string, record: TrajectoryRecord): WriteTrajectoryResult {
  const trajectoryPath = join(engagementDir, "trajectory.json");
  const metricsPath = join(engagementDir, "metrics.json");
  try {
    mkdirSync(engagementDir, { recursive: true });
    const existing = finishedAtOf(trajectoryPath) ?? finishedAtOf(metricsPath);
    const incoming = Date.parse(record.metrics.finishedAt);
    if (existing !== undefined && Number.isFinite(incoming) && existing > incoming) {
      return { written: false, trajectoryPath, metricsPath, reason: "existing record is newer" };
    }
    atomicWrite(trajectoryPath, JSON.stringify(record, null, 2));
    atomicWrite(metricsPath, JSON.stringify(record.metrics, null, 2));
    return { written: true, trajectoryPath, metricsPath };
  } catch (err) {
    return { written: false, trajectoryPath, metricsPath, reason: (err as Error).message };
  }
}
