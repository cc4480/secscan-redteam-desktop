/**
 * Work-graph executor: the resumable driver. Walks the graph in
 * dependency + priority order, runs each pending subtask through the
 * injected runner, persists after EVERY transition, and calls the
 * refiner after every completed subtask (A4 Deeper). This is the
 * kill/resume guarantee in executable form:
 *
 *  - a subtask marked done is never re-run — the runner is only ever
 *    invoked for pending subtasks;
 *  - shouldStop is consulted between subtasks, so a stop (kill switch,
 *    process kill, test) always leaves the persisted graph at a settled
 *    boundary;
 *  - resuming is just calling executeFlow again over the loaded graph.
 *
 * The live phases keep their own loops (recon/exploit) and use the
 * same graph/store/refiner primitives through wiring.ts; this executor
 * is the driver for graph-first runs and the acceptance proof.
 */
import {
  completeSubtask,
  failSubtask,
  findSubtask,
  flowProgress,
  startSubtask,
  type WorkFlow,
} from "./graph.js";
import { refineAfterSubtask, type RefineFn } from "./refiner.js";

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

export async function executeFlow(flow: WorkFlow, opts: ExecuteOptions): Promise<ExecuteSummary> {
  const summary: ExecuteSummary = { ran: [], failed: [], stoppedEarly: false, complete: false };
  const persist = (): void => opts.save?.(flow);
  for (;;) {
    // Collect pending subtasks in task order (deps + priority). Tasks
    // with no subtasks are plan markers, not executable units.
    const pending: Array<{ taskId: string; subtaskId: string; title: string }> = [];
    const settledIds = new Set(
      flow.tasks
        .filter((t) => t.status === "done" || t.status === "skipped" || t.subtasks.length === 0)
        .map((t) => t.id),
    );
    const readyTasks = flow.tasks
      .filter((t) => t.status === "pending" || t.status === "running")
      .filter((t) => t.dependsOn.every((d) => settledIds.has(d)))
      .sort((a, b) => a.priority - b.priority);
    for (const task of readyTasks) {
      for (const s of task.subtasks) {
        if (s.status === "pending") pending.push({ taskId: task.id, subtaskId: s.id, title: s.title });
      }
    }
    if (pending.length === 0) break;
    if (opts.shouldStop?.()) {
      summary.stoppedEarly = true;
      break;
    }
    const next = pending[0]!;
    if (!startSubtask(flow, next.subtaskId)) continue; // settled by a refiner op in the meantime
    persist();
    opts.onEvent?.("subtask_start", `${next.subtaskId} (${next.title})`);
    try {
      const result = await opts.runSubtask(next.subtaskId, next.title);
      completeSubtask(flow, next.subtaskId, result);
      summary.ran.push(next.subtaskId);
      persist();
      opts.onEvent?.("subtask_done", next.subtaskId);
      if (opts.refine) {
        const outcome = await refineAfterSubtask(
          flow,
          { completedSubtaskId: next.subtaskId, resultSummary: result },
          opts.refine,
        );
        if (outcome.changed) {
          persist();
          opts.onEvent?.("refined", outcome.applied.join("; "));
        }
      }
    } catch (err) {
      failSubtask(flow, next.subtaskId, (err as Error).message);
      summary.failed.push(next.subtaskId);
      persist();
      opts.onEvent?.("subtask_failed", `${next.subtaskId}: ${(err as Error).message}`);
    }
    // A task whose subtasks are all settled may unblock dependents;
    // loop re-evaluates readiness (and the refiner's changes) each pass.
    if (!findSubtask(flow, next.subtaskId)) break; // graph replaced — stop rather than guess
  }
  summary.complete = flowProgress(flow).complete;
  return summary;
}
