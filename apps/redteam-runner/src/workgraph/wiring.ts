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
import type { ChatMessage, ResponseFormat } from "@secscan/redteam-llm-router";
import { createCharteredComplete } from "../charter-completion.js";
import type { Ctx } from "../context.js";
import { extractJsonBlock } from "../util.js";
import {
  addSubtask,
  adhocTask,
  buildFlowFromPlan,
  completeSubtask,
  failSubtask,
  flowProgress,
  recordAction,
  startSubtask,
  type GraphSubtask,
  type WorkFlow,
} from "./graph.js";
import { refineAfterSubtask, type RefineOps } from "./refiner.js";
import { attachFlow, flowFor, loadFlow, saveFlow } from "./store.js";

/** Build the graph from the plan, or resume the persisted one. */
export function ensureWorkGraph(ctx: Ctx): WorkFlow | null {
  try {
    const attached = flowFor(ctx);
    if (attached) return attached;
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
    if (!ctx.plan) return null;
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
  } catch (err) {
    ctx.events.append({ phase: "plan", actor: "runner", action: "workgraph_failed", result: `Work-graph build failed (failure-isolated): ${(err as Error).message}` });
    return null;
  }
}

/** The graph subtask for one specialist assignment (idempotent). */
export function graphSubtaskFor(
  ctx: Ctx,
  assignment: { kind: string; brief: string; attackId?: string },
): GraphSubtask | null {
  try {
    const flow = flowFor(ctx) ?? ensureWorkGraph(ctx);
    if (!flow) return null;
    const parent =
      flow.tasks.find(
        (t) => assignment.attackId && t.attackId === assignment.attackId && t.status !== "done",
      ) ?? adhocTask(flow, "exploit");
    const result = addSubtask(flow, parent.id, { title: assignment.brief, kind: assignment.kind });
    if (!result.ok) {
      ctx.events.append({ phase: "exploit", actor: "runner", action: "workgraph_subtask_rejected", result: result.reason });
      return null;
    }
    saveFlow(ctx.events.dir, flow);
    return result.subtask;
  } catch {
    return null;
  }
}

export function startGraphSubtask(ctx: Ctx, subtaskId: string): void {
  try {
    const flow = flowFor(ctx);
    if (flow && startSubtask(flow, subtaskId)) saveFlow(ctx.events.dir, flow);
  } catch { /* failure-isolated */ }
}

export function failGraphSubtask(ctx: Ctx, subtaskId: string, reason: string): void {
  try {
    const flow = flowFor(ctx);
    if (flow && failSubtask(flow, subtaskId, reason)) saveFlow(ctx.events.dir, flow);
  } catch { /* failure-isolated */ }
}

/**
 * Settle a subtask, count its Actions, persist, then run the Refiner
 * (coordinator completion → validated ops). Returns the refiner's
 * applied operations for the caller's log, or [] when nothing changed.
 */
export async function completeGraphSubtask(
  ctx: Ctx,
  subtaskId: string,
  resultSummary: string,
  actionsDelta: number,
): Promise<string[]> {
  try {
    const flow = flowFor(ctx);
    if (!flow) return [];
    for (let i = 0; i < Math.max(0, actionsDelta); i++) recordAction(flow, subtaskId);
    if (!completeSubtask(flow, subtaskId, resultSummary)) return [];
    saveFlow(ctx.events.dir, flow);
    const outcome = await refineAfterSubtask(
      flow,
      { completedSubtaskId: subtaskId, resultSummary },
      async (live, refineCtx) => coordinatorRefine(ctx, live, refineCtx.resultSummary),
    );
    if (outcome.changed || outcome.dropped.length > 0) {
      saveFlow(ctx.events.dir, flow);
      ctx.events.append({
        phase: "exploit",
        actor: "coordinator",
        action: "workgraph_refined",
        result:
          `Refiner after ${subtaskId}: ${outcome.applied.join("; ") || "no changes applied"}` +
          (outcome.dropped.length > 0
            ? ` Dropped: ${outcome.dropped.map((d) => `${d.op} (${d.reason})`).join("; ")}`
            : "") +
          `. Graph revision ${flow.revision}.`,
      });
    }
    return outcome.applied;
  } catch (err) {
    ctx.events.append({ phase: "exploit", actor: "runner", action: "workgraph_failed", result: `Subtask settle/refine failed (failure-isolated): ${(err as Error).message}` });
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
export const REFINE_FORMAT: ResponseFormat = {
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

/** The production RefineFn: one coordinator completion over the graph. */
async function coordinatorRefine(ctx: Ctx, flow: WorkFlow, resultSummary: string): Promise<RefineOps | null> {
  const complete = ctx.deps.completeForRole ?? createCharteredComplete(ctx, "exploit");
  const pending = flow.tasks.flatMap((t) =>
    t.subtasks.filter((s) => s.status === "pending").map((s) => `${s.id} [task ${t.id}, ${t.phase}] ${s.title}`),
  );
  const taskList = flow.tasks
    .map((t) => `${t.id} [${t.phase}${t.attackId ? ` ${t.attackId}` : ""}, ${t.status}, priority ${t.priority}] ${t.title}`)
    .join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are the coordinator refining a penetration-test work-graph after a subtask completed. " +
        "Answer with JSON only: {\"addSubtasks\":[{\"taskId\":\"...\",\"title\":\"...\",\"kind\":\"probe|recon\"}]," +
        "\"skipSubtaskIds\":[\"...\"],\"reprioritize\":[{\"taskId\":\"...\",\"priority\":0}]}. " +
        "Propose only changes the new result actually justifies; an empty object is a valid, common answer.",
    },
    {
      role: "user",
      content:
        `Subtask result:\n${resultSummary.slice(0, 1500)}\n\nTasks:\n${taskList}\n\nPending subtasks:\n${pending.join("\n") || "(none)"}`,
    },
  ];
  const res = await complete("coordinator", messages, { tools: [], responseFormat: REFINE_FORMAT });
  const parsed = extractJsonBlock(res.text) as RefineOps | null;
  return parsed ?? null;
}
