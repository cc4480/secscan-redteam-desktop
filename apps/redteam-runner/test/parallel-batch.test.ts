/**
 * Parallel tool-call batch tests (PentAGI alignment A2).
 *
 * partitionToolCalls decides which calls in one model response may run
 * concurrently; executeToolGroup runs a group through an injected
 * dispatch so concurrency and error settling are proven without an
 * engagement or a network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PARALLEL_CALLS,
  executeToolGroup,
  partitionToolCalls,
  type ToolCallGroup,
} from "../src/dispatch/parallel-batch.js";
import { type Ctx } from "../src/context.js";
import { type ActorRole, type EngagementPhase } from "../src/types.js";
import { type ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "../src/dispatch/types.js";

const ROLE = "recon" as ActorRole;
const PHASE = "recon" as EngagementPhase;
const CTX = {} as Ctx;

function probe(url: string): ToolCallRequest {
  return { id: `c-${url}`, name: "http_probe", arguments: { url } };
}
function bookkeep(): ToolCallRequest {
  return { id: "c-book", name: "record_finding", arguments: { title: "x" } };
}
/** Host resolver stand-in: probes carry a host, bookkeeping does not. */
function hostOf(call: ToolCallRequest): string | undefined {
  return call.name === "http_probe" ? "lab.local" : undefined;
}
function shapes(groups: ToolCallGroup[]): Array<{ parallel: boolean; n: number }> {
  return groups.map((g) => ({ parallel: g.parallel, n: g.calls.length }));
}

describe("partitionToolCalls", () => {
  it("groups consecutive independent probes into one parallel group", () => {
    const groups = partitionToolCalls([probe("http://h/a"), probe("http://h/b"), probe("http://h/c")], hostOf, true);
    assert.deepEqual(shapes(groups), [{ parallel: true, n: 3 }]);
  });

  it("a state-dependent call is a barrier that splits the run", () => {
    const groups = partitionToolCalls(
      [probe("http://h/a"), probe("http://h/b"), bookkeep(), probe("http://h/c"), probe("http://h/d")],
      hostOf,
      true,
    );
    assert.deepEqual(shapes(groups), [
      { parallel: true, n: 2 },
      { parallel: false, n: 1 },
      { parallel: true, n: 2 },
    ]);
  });

  it("an exact duplicate inside one response runs sequentially after its twin", () => {
    const groups = partitionToolCalls([probe("http://h/a"), probe("http://h/a")], hostOf, true);
    assert.deepEqual(shapes(groups), [
      { parallel: false, n: 1 },
      { parallel: false, n: 1 },
    ]);
  });

  it("an ineligible phase gets one sequential group per call, exactly the old behavior", () => {
    const groups = partitionToolCalls([probe("http://h/a"), probe("http://h/b")], hostOf, false);
    assert.deepEqual(shapes(groups), [
      { parallel: false, n: 1 },
      { parallel: false, n: 1 },
    ]);
  });

  it("caps a parallel group at MAX_PARALLEL_CALLS", () => {
    const calls = ["a", "b", "c", "d", "e"].map((p) => probe(`http://h/${p}`));
    const groups = partitionToolCalls(calls, hostOf, true);
    assert.deepEqual(shapes(groups), [
      { parallel: true, n: MAX_PARALLEL_CALLS },
      { parallel: false, n: 1 },
    ]);
  });

  it("a duplicate of a call in an earlier size-flushed group still runs sequentially", () => {
    const calls = ["a", "b", "c", "d", "a"].map((p) => probe(`http://h/${p}`));
    const groups = partitionToolCalls(calls, hostOf, true);
    assert.deepEqual(shapes(groups), [
      { parallel: true, n: MAX_PARALLEL_CALLS },
      { parallel: false, n: 1 },
    ]);
    assert.equal(groups[1]?.calls[0]?.arguments["url"], "http://h/a");
  });
});

describe("executeToolGroup", () => {
  it("runs a parallel group's calls concurrently, not in sum time", async () => {
    let active = 0;
    let maxActive = 0;
    const stub = async (): Promise<DispatchResult> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 40));
      active--;
      return { result: "ok", ok: true };
    };
    const group: ToolCallGroup = {
      parallel: true,
      calls: [probe("http://h/a"), probe("http://h/b"), probe("http://h/c")],
    };
    const t0 = Date.now();
    const settled = await executeToolGroup(CTX, ROLE, PHASE, group, stub);
    const elapsed = Date.now() - t0;
    assert.equal(settled.length, 3);
    assert.ok(settled.every((s) => s.d?.result === "ok"));
    assert.equal(maxActive, 3);
    assert.ok(elapsed < 110, `3 x 40ms concurrent should land well under the 120ms sequential floor, took ${elapsed}ms`);
  });

  it("a singleton group runs its one call without concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const stub = async (): Promise<DispatchResult> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { result: "ok", ok: true };
    };
    const settled = await executeToolGroup(CTX, ROLE, PHASE, { parallel: false, calls: [probe("http://h/a")] }, stub);
    assert.equal(settled.length, 1);
    assert.equal(maxActive, 1);
  });

  it("settles a thrown dispatch as a per-call error and keeps sibling results", async () => {
    const stub = async (_ctx: Ctx, _r: ActorRole, _p: EngagementPhase, call: ToolCallRequest): Promise<DispatchResult> => {
      if (call.arguments["url"] === "http://h/bad") throw new Error("boom");
      return { result: "ok", ok: true };
    };
    const group: ToolCallGroup = {
      parallel: true,
      calls: [probe("http://h/a"), probe("http://h/bad"), probe("http://h/c")],
    };
    const settled = await executeToolGroup(CTX, ROLE, PHASE, group, stub);
    assert.equal(settled[0]?.d?.result, "ok");
    assert.equal(settled[1]?.error?.message, "boom");
    assert.equal(settled[2]?.d?.result, "ok");
  });
});
