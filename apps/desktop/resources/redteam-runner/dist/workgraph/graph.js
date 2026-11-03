/**
 * Work-graph (PentAGI alignment A4 Deeper — Carlos, 2026-10-27: the full
 * hierarchy, persisted and resumable, not the shallow graph).
 *
 * Flow → Task → Subtask → Action, mirroring PentAGI's Flow/Task/Subtask/
 * Action chain onto this runner's own units:
 *  - Flow    = one engagement's graph (workgraph.json in its dir)
 *  - Task    = one coordinator plan step (phase-tagged, ATT&CK-keyed)
 *  - Subtask = one specialist assignment executed under a task
 *              (a TaskDef run through runTask); a task holds at most
 *              MAX_SUBTASKS_PER_TASK subtasks — PentAGI's Generator cap
 *  - Action  = one dispatched tool call inside a subtask (counted)
 *
 * Ids are idempotency keys: derived from content hashes, so rebuilding
 * the same plan yields the same task ids and a resumed run recognizes
 * work it already finished instead of repeating it. Dependencies are
 * structural: every exploit task depends on every recon task, so the
 * scheduler can never start exploitation before recon completes.
 *
 * This module is pure graph logic — no I/O, no model calls. Persistence
 * lives in store.ts, the refiner in refiner.ts, the driver in
 * executor.ts, and the phase wiring in wiring.ts.
 */
import { createHash } from 'node:crypto';
import { MAX_SUBTASKS_PER_TASK, MAX_TASKS_PER_FLOW } from './types.js';
import { compareReadyTasks } from './ready.js';
export { MAX_SUBTASKS_PER_TASK, MAX_TASKS_PER_FLOW } from './types.js';
export { compareReadyTasks } from './ready.js';
function key(parts) {
    return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 12);
}
const now = () => new Date().toISOString();
/** The Generator: decompose a coordinator plan into the task hierarchy. */
export function buildFlowFromPlan(input) {
    if (input.steps.length > MAX_TASKS_PER_FLOW) {
        throw new Error(`coordinator plan has ${input.steps.length} steps, over the work-graph budget of ${MAX_TASKS_PER_FLOW} tasks/subtasks`);
    }
    const tasks = input.steps.map((step, i) => ({
        id: `task-${key([input.engagementId, String(i), step.phase, step.attackId ?? '', step.description])}`,
        title: step.description.slice(0, 200),
        phase: step.phase,
        attackId: step.attackId,
        priority: i,
        // Plan-carried estimate fields pass through verbatim. They are NOT
        // part of the task id inputs above: ids stay a function of the
        // step's identity, so editing an estimate on resume never mints a
        // new task or repeats settled work.
        deadline: step.deadline,
        cost: step.cost,
        dependsOn: [],
        status: 'pending',
        subtasks: [],
    }));
    const reconIds = tasks.filter(t => t.phase === 'recon').map(t => t.id);
    for (const task of tasks) {
        if (task.phase === 'exploit')
            task.dependsOn = [...reconIds];
    }
    const ts = now();
    return {
        version: 1,
        engagementId: input.engagementId,
        objective: input.objective,
        target: input.target,
        revision: 0,
        refinements: 0,
        createdAt: ts,
        updatedAt: ts,
        tasks,
    };
}
/**
 * Find or create the phase catch-all task that owns ad-hoc subtasks.
 * Deliberately outside the MAX_TASKS_PER_FLOW admission check: it
 * creates at most one task per phase, so the node count can exceed the
 * budget by at most the number of distinct phases, via catch-all
 * creation only — its subtasks are still refused at the budget by
 * addSubtask.
 */
export function adhocTask(flow, phase) {
    const id = `task-${key([flow.engagementId, 'adhoc', phase])}`;
    let task = flow.tasks.find(t => t.id === id);
    if (!task) {
        task = {
            id,
            title: `${phase} — coordinator-assigned work`,
            phase,
            priority: 1_000,
            dependsOn: [],
            status: 'pending',
            subtasks: [],
        };
        flow.tasks.push(task);
        touch(flow);
    }
    return task;
}
/**
 * Add a subtask under a task. Adding the same subtask twice (same task,
 * kind, and title) returns the existing one — the idempotency rule that
 * makes resume safe. The per-task cap is PentAGI's Generator limit.
 */
export function addSubtask(flow, taskId, input) {
    const task = flow.tasks.find(t => t.id === taskId);
    if (!task)
        return { ok: false, reason: `unknown task ${taskId}` };
    const id = `sub-${key([taskId, input.kind, input.title])}`;
    const existing = task.subtasks.find(s => s.id === id);
    if (existing)
        return { ok: true, subtask: existing };
    if (task.subtasks.length >= MAX_SUBTASKS_PER_TASK) {
        return { ok: false, reason: `task ${taskId} already holds the ${MAX_SUBTASKS_PER_TASK}-subtask cap` };
    }
    if (flowNodeCount(flow) >= MAX_TASKS_PER_FLOW) {
        return { ok: false, reason: `flow task budget exhausted (${MAX_TASKS_PER_FLOW} tasks/subtasks)` };
    }
    const subtask = {
        id,
        title: input.title.slice(0, 300),
        kind: input.kind,
        status: 'pending',
        actions: 0,
    };
    task.subtasks.push(subtask);
    touch(flow);
    return { ok: true, subtask };
}
export function findSubtask(flow, subtaskId) {
    for (const task of flow.tasks) {
        const subtask = task.subtasks.find(s => s.id === subtaskId);
        if (subtask)
            return { task, subtask };
    }
    return null;
}
/** Tasks whose dependencies are all done/skipped, in ready order. */
export function nextReady(flow) {
    const settled = (id) => {
        const t = flow.tasks.find(x => x.id === id);
        return t !== undefined && (t.status === 'done' || t.status === 'skipped');
    };
    return flow.tasks
        .filter(t => t.status === 'pending' && t.dependsOn.every(settled))
        .sort(compareReadyTasks);
}
function touch(flow) {
    flow.updatedAt = now();
}
function rollUpTask(task) {
    if (task.subtasks.length === 0)
        return;
    if (task.subtasks.every(s => s.status === 'done' || s.status === 'skipped'))
        task.status = 'done';
    else if (task.subtasks.some(s => s.status === 'failed') && task.subtasks.every(s => s.status !== 'pending' && s.status !== 'running'))
        task.status = 'failed';
    else if (task.subtasks.some(s => s.status === 'running'))
        task.status = 'running';
}
export function startSubtask(flow, subtaskId) {
    const found = findSubtask(flow, subtaskId);
    if (!found || found.subtask.status !== 'pending')
        return false;
    found.subtask.status = 'running';
    found.subtask.startedAt = now();
    if (found.task.status === 'pending')
        found.task.status = 'running';
    touch(flow);
    return true;
}
export function completeSubtask(flow, subtaskId, resultSummary) {
    const found = findSubtask(flow, subtaskId);
    if (!found || found.subtask.status !== 'running')
        return false;
    found.subtask.status = 'done';
    found.subtask.resultSummary = resultSummary.slice(0, 600);
    found.subtask.finishedAt = now();
    rollUpTask(found.task);
    touch(flow);
    return true;
}
export function failSubtask(flow, subtaskId, reason) {
    const found = findSubtask(flow, subtaskId);
    if (!found || found.subtask.status !== 'running')
        return false;
    found.subtask.status = 'failed';
    found.subtask.resultSummary = reason.slice(0, 600);
    found.subtask.finishedAt = now();
    rollUpTask(found.task);
    touch(flow);
    return true;
}
/** Skip is a refiner/operator decision — only pending work can be skipped. */
export function skipSubtask(flow, subtaskId) {
    const found = findSubtask(flow, subtaskId);
    if (!found || found.subtask.status !== 'pending')
        return false;
    found.subtask.status = 'skipped';
    found.subtask.finishedAt = now();
    rollUpTask(found.task);
    touch(flow);
    return true;
}
export function recordAction(flow, subtaskId) {
    const found = findSubtask(flow, subtaskId);
    if (found) {
        found.subtask.actions++;
        touch(flow);
    }
}
export function setTaskPriority(flow, taskId, priority) {
    const task = flow.tasks.find(t => t.id === taskId);
    if (!task)
        return false;
    task.priority = priority;
    touch(flow);
    return true;
}
/**
 * Total graph nodes: tasks + every task's subtasks, counted with the
 * same iteration flowProgress uses. Nodes are never removed from a
 * flow, so this equals the lifetime creation count — the quantity
 * MAX_TASKS_PER_FLOW caps. No separate counter is persisted.
 */
export function flowNodeCount(flow) {
    let nodes = flow.tasks.length;
    for (const task of flow.tasks)
        nodes += task.subtasks.length;
    return nodes;
}
/** Whole-flow roll-up for reports and the resume check. */
export function flowProgress(flow) {
    let subtasks = 0;
    let subtasksDone = 0;
    let actions = 0;
    let overdue = 0;
    let estimatedCost = 0;
    const nowIso = now();
    for (const task of flow.tasks) {
        if (task.cost !== undefined)
            estimatedCost += task.cost;
        if (task.deadline !== undefined &&
            task.deadline < nowIso &&
            (task.status === 'pending' || task.status === 'running')) {
            overdue++;
        }
        for (const s of task.subtasks) {
            subtasks++;
            if (s.status === 'done' || s.status === 'skipped')
                subtasksDone++;
            actions += s.actions;
        }
    }
    const tasksDone = flow.tasks.filter(t => t.status === 'done' || t.status === 'skipped' || (t.subtasks.length === 0 && t.status !== 'running')).length;
    return {
        tasks: flow.tasks.length,
        tasksDone,
        subtasks,
        subtasksDone,
        actions,
        overdue,
        estimatedCost,
        complete: flow.tasks.length > 0 && subtasks === subtasksDone && flow.tasks.every(t => t.status !== 'running'),
    };
}
//# sourceMappingURL=graph.js.map