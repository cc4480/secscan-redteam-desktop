import type { TrajectoryRecord } from "./contract.js";
import { type Spec5Rows } from "./spec5.js";
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
/**
 * Write trajectory.json + metrics.json (+ run.json when section-5 rows are
 * supplied) into the engagement directory. Atomic (tmp + rename, no partial
 * file is ever visible), additively creating the directory, and never
 * overwriting a newer record.
 */
export declare function writeTrajectory(engagementDir: string, record: TrajectoryRecord, options?: WriteTrajectoryOptions): WriteTrajectoryResult;
