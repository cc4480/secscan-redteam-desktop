/**
 * The Refiner (PentAGI alignment A4 Deeper): after EVERY completed
 * subtask, the remaining graph is re-planned. The refiner is a function
 * seam — production wires the coordinator's completion (wiring.ts),
 * tests inject scripted refiners. Its output is a list of operations,
 * never a new graph: every operation is validated against the live
 * graph before it lands (only pending subtasks can be skipped, adds
 * respect the per-task cap, priorities are numbers), and an invalid
 * operation is dropped with its reason recorded, never applied
 * silently. A pass that changes nothing is still counted only when it
 * changes something — revision moves only on real change.
 */
import { type WorkFlow } from "./graph.js";
export interface RefineOps {
    addSubtasks?: Array<{
        taskId: string;
        title: string;
        kind: string;
    }>;
    skipSubtaskIds?: string[];
    reprioritize?: Array<{
        taskId: string;
        priority: number;
    }>;
}
export interface RefineContext {
    /** The subtask whose completion triggered this pass. */
    readonly completedSubtaskId: string;
    readonly resultSummary: string;
}
/** Given the live graph and the just-finished subtask, propose changes. */
export type RefineFn = (flow: WorkFlow, ctx: RefineContext) => Promise<RefineOps | null>;
export interface RefineOutcome {
    applied: string[];
    dropped: Array<{
        op: string;
        reason: string;
    }>;
    changed: boolean;
}
/** Apply one refiner pass to the graph, validating every operation. */
export declare function refineAfterSubtask(flow: WorkFlow, ctx: RefineContext, refine: RefineFn): Promise<RefineOutcome>;
