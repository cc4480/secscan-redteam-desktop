/**
 * Work-graph executor: the resumable driver. Walks the graph in
 * dependency + priority order, runs each pending subtask through the
 * injected runner, persists after EVERY transition, and calls the
 * refiner after every completed subtask (A4 Deeper). This is the
 * kill/resume guarantee in executable form:
 *
 *  - a subtask marked done is never re-run — the runner is only ever
 *    invoked for pending subtasks;
 *  - shouldStop is consulted between subtasks, so a stop (operator stop,
 *    process kill, test) always leaves the persisted graph at a settled
 *    boundary;
 *  - resuming is just calling executeFlow again over the loaded graph.
 *
 * The live phases keep their own loops (recon/exploit) and use the
 * same graph/store/refiner primitives through wiring.ts; this executor
 * is the driver for graph-first runs and the acceptance proof.
 */
import { type WorkFlow } from "./graph.js";
import { type RefineFn } from "./refiner.js";
export interface ExecuteOptions {
    /** Run one subtask; returns its result summary. Throws = failed. */
    runSubtask: (subtaskId: string, title: string) => Promise<string>;
    /** Refiner pass after every completed subtask (optional). */
    refine?: RefineFn;
    /** Persist after every transition (optional). */
    save?: (flow: WorkFlow) => void;
    /** Consulted between subtasks; true stops at a settled boundary. */
    shouldStop?: () => boolean;
    /** Notified on each transition (events/logging). */
    onEvent?: (action: string, detail: string) => void;
}
export interface ExecuteSummary {
    ran: string[];
    failed: string[];
    stoppedEarly: boolean;
    complete: boolean;
}
export declare function executeFlow(flow: WorkFlow, opts: ExecuteOptions): Promise<ExecuteSummary>;
