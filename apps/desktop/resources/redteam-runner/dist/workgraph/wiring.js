import { promptCtx } from "../agents.js";
import { createCharteredComplete } from "../charter-completion.js";
import { buildFleetPrompt } from "../prompts/fleet-assembly.js";
import { extractJsonBlock } from "../util.js";
import { addSubtask, adhocTask, buildFlowFromPlan, completeSubtask, failSubtask, flowProgress, recordAction, startSubtask, } from "./graph.js";
import { refineAfterSubtask } from "./refiner.js";
import { attachFlow, flowFor, loadFlow, saveFlow } from "./store.js";
/** Build the graph from the plan, or resume the persisted one. */
export function ensureWorkGraph(ctx) {
    try {
        const attached = flowFor(ctx);
        if (attached)
            return attached;
        const dir = ctx.events.dir;
        const existing = loadFlow(dir);
        if (existing && existing.engagementId === ctx.events.engagementId) {
            attachFlow(ctx, existing);
            const p = flowProgress(existing);
            ctx.events.append({
                phase: "plan",
                actor: "runner",
                action: "workgraph_resumed",
                result: `Work-graph resumed at revision ${existing.revision}: ${p.subtasksDone}/${p.subtasks} subtask(s) already settled — settled work will not be re-run.`,
            });
            return existing;
        }
        if (!ctx.plan)
            return null;
        const flow = buildFlowFromPlan({
            engagementId: ctx.events.engagementId,
            objective: ctx.input.objective,
            target: ctx.input.target,
            steps: ctx.plan.steps,
        });
        attachFlow(ctx, flow);
        saveFlow(dir, flow);
        ctx.events.append({
            phase: "plan",
            actor: "runner",
            action: "workgraph_built",
            result: `Work-graph built from the coordinator plan: ${flow.tasks.length} task(s) (${flow.tasks.filter((t) => t.phase === "recon").length} recon, ${flow.tasks.filter((t) => t.phase === "exploit").length} exploit), persisted to workgraph.json.`,
        });
        return flow;
    }
    catch (err) {
        ctx.events.append({ phase: "plan", actor: "runner", action: "workgraph_failed", result: `Work-graph build failed (failure-isolated): ${err.message}` });
        return null;
    }
}
/** The graph subtask for one specialist assignment (idempotent). */
export function graphSubtaskFor(ctx, assignment) {
    try {
        const flow = flowFor(ctx) ?? ensureWorkGraph(ctx);
        if (!flow)
            return null;
        const parent = flow.tasks.find((t) => assignment.attackId && t.attackId === assignment.attackId && t.status !== "done") ?? adhocTask(flow, "exploit");
        const result = addSubtask(flow, parent.id, { title: assignment.brief, kind: assignment.kind });
        if (!result.ok) {
            ctx.events.append({ phase: "exploit", actor: "runner", action: "workgraph_subtask_rejected", result: result.reason });
            return null;
        }
        saveFlow(ctx.events.dir, flow);
        return result.subtask;
    }
    catch {
        return null;
    }
}
export function startGraphSubtask(ctx, subtaskId) {
    try {
        const flow = flowFor(ctx);
        if (flow && startSubtask(flow, subtaskId))
            saveFlow(ctx.events.dir, flow);
    }
    catch { /* failure-isolated */ }
}
export function failGraphSubtask(ctx, subtaskId, reason) {
    try {
        const flow = flowFor(ctx);
        if (flow && failSubtask(flow, subtaskId, reason))
            saveFlow(ctx.events.dir, flow);
    }
    catch { /* failure-isolated */ }
}
/**
 * Settle a subtask, count its Actions, persist, then run the Refiner
 * (coordinator completion → validated ops). Returns the refiner's
 * applied operations for the caller's log, or [] when nothing changed.
 */
export async function completeGraphSubtask(ctx, subtaskId, resultSummary, actionsDelta) {
    try {
        const flow = flowFor(ctx);
        if (!flow)
            return [];
        for (let i = 0; i < Math.max(0, actionsDelta); i++)
            recordAction(flow, subtaskId);
        if (!completeSubtask(flow, subtaskId, resultSummary))
            return [];
        saveFlow(ctx.events.dir, flow);
        const outcome = await refineAfterSubtask(flow, { completedSubtaskId: subtaskId, resultSummary }, async (live, refineCtx) => coordinatorRefine(ctx, live, refineCtx.resultSummary));
        if (outcome.changed || outcome.dropped.length > 0) {
            saveFlow(ctx.events.dir, flow);
            ctx.events.append({
                phase: "exploit",
                actor: "coordinator",
                action: "workgraph_refined",
                result: `Refiner after ${subtaskId}: ${outcome.applied.join("; ") || "no changes applied"}` +
                    (outcome.dropped.length > 0
                        ? ` Dropped: ${outcome.dropped.map((d) => `${d.op} (${d.reason})`).join("; ")}`
                        : "") +
                    `. Graph revision ${flow.revision}.`,
            });
        }
        return outcome.applied;
    }
    catch (err) {
        ctx.events.append({ phase: "exploit", actor: "runner", action: "workgraph_failed", result: `Subtask settle/refine failed (failure-isolated): ${err.message}` });
        return [];
    }
}
/**
 * The wire-level form of the RefineOps contract (Q-STRUCT A2): the same
 * fields the prompt below declares in prose, as a json_schema constraint
 * on the call itself. The prose stays (it also serves ladder-era
 * fallback); the schema is the constraint now. All fields optional —
 * an empty object is a valid, common answer.
 */
export const REFINE_FORMAT = {
    type: "json_schema",
    name: "refine_ops",
    schema: {
        type: "object",
        properties: {
            addSubtasks: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        taskId: { type: "string" },
                        title: { type: "string" },
                        kind: { type: "string", enum: ["probe", "recon"] },
                    },
                    required: ["taskId", "title", "kind"],
                    additionalProperties: false,
                },
            },
            skipSubtaskIds: { type: "array", items: { type: "string" } },
            reprioritize: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        taskId: { type: "string" },
                        priority: { type: "number" },
                    },
                    required: ["taskId", "priority"],
                    additionalProperties: false,
                },
            },
        },
        additionalProperties: false,
    },
};
/**
 * The production RefineFn: one coordinator completion over the graph.
 *
 * The system prompt is fleet-assembled for the coordinator seat (L2):
 * the refine instructions below are the seat delta, wrapped by
 * buildFleetPrompt in the master charter, the MORPHEUS soul, and the
 * verified engagement record — the same assembly every other seat's
 * steering call runs under — because the returned JSON applies
 * addSubtasks / skipSubtaskIds / reprioritize to the live graph.
 * The assembly is gated on the same stamp promptCtx itself checks:
 * a context authorize never stamped (unit fixtures, pre-authorize
 * calls) gets the delta unchanged, byte for byte. The JSON output
 * contract and its parsing are unchanged.
 */
async function coordinatorRefine(ctx, flow, resultSummary) {
    const complete = ctx.deps.completeForRole ?? createCharteredComplete(ctx, "exploit");
    const pending = flow.tasks.flatMap((t) => t.subtasks.filter((s) => s.status === "pending").map((s) => `${s.id} [task ${t.id}, ${t.phase}] ${s.title}`));
    const taskList = flow.tasks
        .map((t) => `${t.id} [${t.phase}${t.attackId ? ` ${t.attackId}` : ""}, ${t.status}, priority ${t.priority}] ${t.title}`)
        .join("\n");
    const seatText = "You are the coordinator refining a penetration-test work-graph after a subtask completed. " +
        "Answer with JSON only: {\"addSubtasks\":[{\"taskId\":\"...\",\"title\":\"...\",\"kind\":\"probe|recon\"}]," +
        "\"skipSubtaskIds\":[\"...\"],\"reprioritize\":[{\"taskId\":\"...\",\"priority\":0}]}. " +
        "Propose only changes the new result actually justifies; an empty object is a valid, common answer.";
    const system = ctx.verificationProof && ctx.verifiedAt
        ? buildFleetPrompt("coordinator", seatText, promptCtx(ctx))
        : seatText;
    const messages = [
        {
            role: "system",
            content: system,
        },
        {
            role: "user",
            content: `Subtask result:\n${resultSummary.slice(0, 1500)}\n\nTasks:\n${taskList}\n\nPending subtasks:\n${pending.join("\n") || "(none)"}`,
        },
    ];
    const res = await complete("coordinator", messages, { tools: [], responseFormat: REFINE_FORMAT });
    const parsed = extractJsonBlock(res.text);
    return parsed ?? null;
}
//# sourceMappingURL=wiring.js.map