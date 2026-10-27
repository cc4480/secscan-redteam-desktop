/**
 * Parallel tool-call batches (PentAGI alignment A2).
 *
 * A model response can carry several tool calls. The agent loop used to
 * execute them strictly one at a time, so a recon response with three
 * independent probes cost the sum of the three round trips. PentAGI's
 * performer runs a chain's calls with concurrency where the work allows
 * it; this module is the runner's version, kept conservative:
 *
 * - Only target-traffic calls (the ones carrying a target host at
 *   dispatch — the rate-limited family) may run in parallel. Anything
 *   else (bookkeeping, registry, MCP: calls whose result depends on
 *   engagement state, or that write it) is a sequential barrier.
 * - Parallelism is confined to the recon phase. Exploit-phase calls in
 *   one response are dependent by construction: the autonomy tier's
 *   per-target chain budget is consumed by each validated step
 *   (recordExploitStep runs after dispatch), so a second step's tier
 *   check must observe the first step's consumption — running them
 *   concurrently would fire both before either is recorded. Recon
 *   probes carry no chain budget, and their dispatch-side bookkeeping
 *   (item attempts) is append-only, so concurrent recon probes do not
 *   change each other's dispatch outcomes.
 * - An exact duplicate inside one response never joins a parallel
 *   group: it runs sequentially after its twin, where the A1 duplicate
 *   guard at dispatch refuses it with the twin's digest.
 * - A parallel group holds at most MAX_PARALLEL_CALLS calls. Per-host
 *   pacing is unchanged — the dispatcher's rate limiter still acquires
 *   per call, so parallelism never raises the per-host request rate;
 *   it overlaps work across different calls, not traffic at one host.
 *
 * Execution settles every call in the group (Promise.all semantics):
 * a thrown dispatch is captured per call and re-thrown by the agent
 * loop's bookkeeping pass, in the original call order. Sibling traffic
 * may already have fired when one call halts the engagement — the kill
 * switch aborts in-flight executions through the shared controllers,
 * and the loop still unwinds to halted on the first error in order.
 */
import { type ActorRole, type EngagementPhase } from "../types.js";
import { type Ctx } from "../context.js";
import { type ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
import { dispatchTool } from "./router.js";
import { toolCallKey } from "./duplicate-guard.js";

export const MAX_PARALLEL_CALLS = 4;

export interface ToolCallGroup {
  parallel: boolean;
  calls: ToolCallRequest[];
}

export type SettledCall =
  | { call: ToolCallRequest; d: DispatchResult; error?: undefined }
  | { call: ToolCallRequest; d?: undefined; error: Error };

type DispatchImpl = (
  ctx: Ctx,
  role: ActorRole,
  phase: EngagementPhase,
  call: ToolCallRequest,
) => Promise<DispatchResult>;

/**
 * Partition one response's calls into sequential groups. Consecutive
 * independent traffic calls accumulate into a parallel group; any other
 * call flushes the group and runs alone, in the original order. When
 * `eligible` is false (any phase but recon), every call is its own
 * sequential group — the pre-A2 behavior, exactly.
 */
export function partitionToolCalls(
  calls: ToolCallRequest[],
  hostOf: (call: ToolCallRequest) => string | undefined,
  eligible: boolean,
): ToolCallGroup[] {
  if (!eligible) return calls.map((call) => ({ parallel: false, calls: [call] }));
  const groups: ToolCallGroup[] = [];
  let run: ToolCallRequest[] = [];
  // Twins are tracked across a size-flush: a duplicate of a call in an
  // earlier parallel group of the same run must not join a later one —
  // it would dispatch before its twin's outcome is recorded. A
  // sequential barrier resets the run (and the guard at dispatch has
  // the earlier outcome by then).
  const seen = new Set<string>();
  const flush = () => {
    if (run.length) groups.push({ parallel: run.length > 1, calls: run });
    run = [];
  };
  for (const call of calls) {
    const key = toolCallKey(call);
    if (hostOf(call) !== undefined && !seen.has(key)) {
      seen.add(key);
      run.push(call);
      if (run.length >= MAX_PARALLEL_CALLS) flush();
    } else {
      flush();
      groups.push({ parallel: false, calls: [call] });
      seen.clear();
    }
  }
  flush();
  return groups;
}

/**
 * Execute one group and settle every call, in call order. Parallel
 * groups dispatch concurrently; a singleton group is a plain await —
 * same settle shape either way.
 */
export async function executeToolGroup(
  ctx: Ctx,
  role: ActorRole,
  phase: EngagementPhase,
  group: ToolCallGroup,
  dispatchImpl: DispatchImpl = dispatchTool,
): Promise<SettledCall[]> {
  const run = async (call: ToolCallRequest): Promise<SettledCall> => {
    try {
      return { call, d: await dispatchImpl(ctx, role, phase, call) };
    } catch (err) {
      return { call, error: err as Error };
    }
  };
  if (!group.parallel) return [await run(group.calls[0] as ToolCallRequest)];
  return Promise.all(group.calls.map(run));
}
