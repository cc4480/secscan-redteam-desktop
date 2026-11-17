import { type Ctx } from '../context.js';
import { type TaskDef, type TaskResult } from './tasks-types.js';
export type { TaskDef, TaskResult } from './tasks-types.js';
/**
 * "Spawn a subagent": execute one discrete task as a bounded foundation loop
 * with a task-scoped specialist prompt. Fresh context, cyber task definition.
 */
export declare function runTask(ctx: Ctx, task: TaskDef): Promise<TaskResult>;
/**
 * Fan-out with a concurrency cap: red fans out independent tasks in parallel,
 * black runs strictly one at a time (stealth). HaltError always propagates.
 *
 * Parallel tasks share `ctx`, so each task before/after snapshot overlaps its
 * siblings work: task A "findings after" already includes what task B found.
 * Reporting those raw projections attributed every sibling probes and findings
 * to each task, and those numbers are what the coordinator re-plans from. A chunk
 * delta is therefore reconciled here and attributed ONCE - to the first task - with
 * the rest zeroed and every result marked `shared`, so nothing double-counts.
 */ export declare function runBatch(ctx: Ctx, tasks: TaskDef[], cap: number): Promise<TaskResult[]>;
/**
 * Attribute a parallel chunk true delta once instead of once per task.
 * @param fulfilled - The chunk results; mutated in place.
 */
export declare function reconcileChunkDeltas(fulfilled: TaskResult[]): void;
/**
 * Cyber-layer task validation: the coordinator proposes, the runner disposes.
 * Unknown/excluded ATT&CK IDs and invalid categories are rejected (with an
 * event) — the coordinator re-plans without them.
 */
export declare function validateTasks(ctx: Ctx, raw: Array<Record<string, unknown>>, cap: number): TaskDef[];
export interface CoordinatorDirective {
    tasks: TaskDef[];
    finish: boolean;
    note: string;
}
/**
 * One coordinator command turn: DECOMPOSE (initial) or RE-PLAN (after every
 * observation round). Returns validated tasks or a finish decision.
 */
