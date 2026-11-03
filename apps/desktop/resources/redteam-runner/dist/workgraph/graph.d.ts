import type { PlanStep } from '../types.js';
import { type GraphSubtask, type GraphTask, type WorkFlow } from './types.js';
export { MAX_SUBTASKS_PER_TASK, MAX_TASKS_PER_FLOW } from './types.js';
export { compareReadyTasks } from './ready.js';
export type { GraphStatus, GraphSubtask, GraphTask, WorkFlow } from './types.js';
/** The Generator: decompose a coordinator plan into the task hierarchy. */
export declare function buildFlowFromPlan(input: {
    engagementId: string;
    objective: string;
    target: string;
    steps: readonly PlanStep[];
}): WorkFlow;
/**
 * Find or create the phase catch-all task that owns ad-hoc subtasks.
 * Deliberately outside the MAX_TASKS_PER_FLOW admission check: it
 * creates at most one task per phase, so the node count can exceed the
 * budget by at most the number of distinct phases, via catch-all
 * creation only — its subtasks are still refused at the budget by
 * addSubtask.
 */
export declare function adhocTask(flow: WorkFlow, phase: string): GraphTask;
export type AddSubtaskResult = {
    ok: true;
    subtask: GraphSubtask;
} | {
    ok: false;
    reason: string;
};
/**
 * Add a subtask under a task. Adding the same subtask twice (same task,
 * kind, and title) returns the existing one — the idempotency rule that
 * makes resume safe. The per-task cap is PentAGI's Generator limit.
 */
export declare function addSubtask(flow: WorkFlow, taskId: string, input: {
    title: string;
    kind: string;
}): AddSubtaskResult;
export declare function findSubtask(flow: WorkFlow, subtaskId: string): {
    task: GraphTask;
    subtask: GraphSubtask;
} | null;
/** Tasks whose dependencies are all done/skipped, in ready order. */
export declare function nextReady(flow: WorkFlow): GraphTask[];
export declare function startSubtask(flow: WorkFlow, subtaskId: string): boolean;
export declare function completeSubtask(flow: WorkFlow, subtaskId: string, resultSummary: string): boolean;
export declare function failSubtask(flow: WorkFlow, subtaskId: string, reason: string): boolean;
/** Skip is a refiner/operator decision — only pending work can be skipped. */
export declare function skipSubtask(flow: WorkFlow, subtaskId: string): boolean;
export declare function recordAction(flow: WorkFlow, subtaskId: string): void;
export declare function setTaskPriority(flow: WorkFlow, taskId: string, priority: number): boolean;
/**
 * Total graph nodes: tasks + every task's subtasks, counted with the
 * same iteration flowProgress uses. Nodes are never removed from a
 * flow, so this equals the lifetime creation count — the quantity
 * MAX_TASKS_PER_FLOW caps. No separate counter is persisted.
 */
export declare function flowNodeCount(flow: WorkFlow): number;
/** Whole-flow roll-up for reports and the resume check. */
export declare function flowProgress(flow: WorkFlow): {
    tasks: number;
    tasksDone: number;
    subtasks: number;
    subtasksDone: number;
    actions: number;
    /** Pending/running tasks whose deadline is past — surfaced, never auto-failed. */
    overdue: number;
    /** Sum of set task costs, beside the actual `actions` for estimate-vs-actual reporting. */
    estimatedCost: number;
    complete: boolean;
};
