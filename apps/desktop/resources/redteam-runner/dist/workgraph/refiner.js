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
import { addSubtask, setTaskPriority, skipSubtask, } from "./graph.js";
/** Apply one refiner pass to the graph, validating every operation. */
export async function refineAfterSubtask(flow, ctx, refine) {
    const outcome = { applied: [], dropped: [], changed: false };
    const ops = await refine(flow, ctx);
    if (!ops)
        return outcome;
    for (const add of ops.addSubtasks ?? []) {
        const result = addSubtask(flow, add.taskId, { title: add.title, kind: add.kind });
        if (result.ok)
            outcome.applied.push(`add ${result.subtask.id} under ${add.taskId}`);
        else
            outcome.dropped.push({ op: `add under ${add.taskId}: ${add.title}`, reason: result.reason });
    }
    for (const subtaskId of ops.skipSubtaskIds ?? []) {
        if (skipSubtask(flow, subtaskId))
            outcome.applied.push(`skip ${subtaskId}`);
        else
            outcome.dropped.push({ op: `skip ${subtaskId}`, reason: "not pending (already settled or unknown)" });
    }
    for (const rep of ops.reprioritize ?? []) {
        if (Number.isFinite(rep.priority) && setTaskPriority(flow, rep.taskId, rep.priority)) {
            outcome.applied.push(`reprioritize ${rep.taskId} → ${rep.priority}`);
        }
        else {
            outcome.dropped.push({ op: `reprioritize ${rep.taskId}`, reason: "unknown task or invalid priority" });
        }
    }
    if (outcome.applied.length > 0) {
        flow.revision++;
        flow.refinements++;
        outcome.changed = true;
    }
    return outcome;
}
//# sourceMappingURL=refiner.js.map