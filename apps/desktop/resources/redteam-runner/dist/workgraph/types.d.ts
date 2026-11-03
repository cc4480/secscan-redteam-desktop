/**
 * Work-graph types and budgets — extracted from graph.ts to keep the graph
 * module under the 300-line budget. Pure declarations.
 */
export declare const MAX_SUBTASKS_PER_TASK = 15;
/**
 * Whole-flow node budget: tasks + subtasks across the flow. The refiner
 * grows the graph after every completed subtask, so without a flow-level
 * bound a long engagement's graph (and its persisted workgraph.json)
 * grows without limit. At the budget, creation refuses through the same
 * result channel as the per-task cap and the engagement continues on
 * the work it already has — it degrades, it does not halt.
 */
export declare const MAX_TASKS_PER_FLOW = 4096;
export type GraphStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface GraphSubtask {
    readonly id: string;
    title: string;
    kind: string;
    status: GraphStatus;
    /** Dispatched tool calls recorded under this subtask. */
    actions: number;
    resultSummary?: string;
    startedAt?: string;
    finishedAt?: string;
}
export interface GraphTask {
    readonly id: string;
    title: string;
    phase: string;
    attackId?: string;
    priority: number;
    /** ISO 8601 time the task should be settled by (same convention as
     * GraphSubtask.startedAt). Absent = never overdue. Reporting and
     * ready-order only — a past deadline never gates or fails a task. */
    deadline?: string;
    /** Estimated cost in dispatched-action units — the same unit as
     * GraphSubtask.actions, so estimates and actuals compare directly.
     * Absent = contributes 0 to estimate roll-ups. Never reorders, never gates. */
    cost?: number;
    dependsOn: string[];
    status: GraphStatus;
    subtasks: GraphSubtask[];
}
export interface WorkFlow {
    version: 1;
    readonly engagementId: string;
    objective: string;
    target: string;
    /** Bumped on every refiner pass that changes the graph. */
    revision: number;
    /** Refiner passes applied, one per completed subtask at most. */
    refinements: number;
    createdAt: string;
    updatedAt: string;
    tasks: GraphTask[];
}
