/**
 * Work-graph types and budgets — extracted from graph.ts to keep the graph
 * module under the 300-line budget. Pure declarations.
 */
export const MAX_SUBTASKS_PER_TASK = 15;
/**
 * Whole-flow node budget: tasks + subtasks across the flow. The refiner
 * grows the graph after every completed subtask, so without a flow-level
 * bound a long engagement's graph (and its persisted workgraph.json)
 * grows without limit. At the budget, creation refuses through the same
 * result channel as the per-task cap and the engagement continues on
 * the work it already has — it degrades, it does not halt.
 */
export const MAX_TASKS_PER_FLOW = 4096;
//# sourceMappingURL=types.js.map