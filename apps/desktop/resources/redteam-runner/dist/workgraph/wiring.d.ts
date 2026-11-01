/**
 * Work-graph wiring into the live phases (A4 Deeper).
 *
 * planPhase calls ensureWorkGraph after the coordinator's plan lands:
 * the plan IS the Generator's decomposition — one Task per plan step —
 * persisted to workgraph.json immediately. When a graph already exists
 * in the engagement dir (a relaunch of the same engagement), it is
 * loaded and resumed instead of rebuilt: settled subtasks keep their
 * state and are never re-run.
 *
 * runTask calls the subtask hooks: the specialist assignment becomes a
 * Subtask under the plan task with the same ATT&CK id (or the phase
 * catch-all), its dispatched tool calls are counted as Actions, and on
 * completion the Refiner runs — a coordinator completion that sees the
 * graph and the subtask's result and answers with validated operations
 * (add / skip / reprioritize), or nothing.
 *
 * Every function here is failure-isolated: the work-graph is the plan's
 * record, never a reason to fail an engagement.
 */
import type { ResponseFormat } from "@secscan/redteam-llm-router";
import type { Ctx } from "../context.js";
import { type GraphSubtask, type WorkFlow } from "./graph.js";
/** Build the graph from the plan, or resume the persisted one. */
export declare function ensureWorkGraph(ctx: Ctx): WorkFlow | null;
/** The graph subtask for one specialist assignment (idempotent). */
export declare function graphSubtaskFor(ctx: Ctx, assignment: {
    kind: string;
    brief: string;
    attackId?: string;
}): GraphSubtask | null;
export declare function startGraphSubtask(ctx: Ctx, subtaskId: string): void;
export declare function failGraphSubtask(ctx: Ctx, subtaskId: string, reason: string): void;
/**
 * Settle a subtask, count its Actions, persist, then run the Refiner
 * (coordinator completion → validated ops). Returns the refiner's
 * applied operations for the caller's log, or [] when nothing changed.
 */
export declare function completeGraphSubtask(ctx: Ctx, subtaskId: string, resultSummary: string, actionsDelta: number): Promise<string[]>;
/**
 * The wire-level form of the RefineOps contract (Q-STRUCT A2): the same
 * fields the prompt below declares in prose, as a json_schema constraint
 * on the call itself. The prose stays (it also serves ladder-era
 * fallback); the schema is the constraint now. All fields optional —
 * an empty object is a valid, common answer.
 */
export declare const REFINE_FORMAT: ResponseFormat;
