/**
 * Q-TOOLTIMEOUT: the typed TOOL_TIMEOUT contract.
 *
 * The defect this contract fixed: a timeout of OUR OWN tool surfaced as
 * free text ("ABORTED: ... timed out ...") that downstream consumers
 * could mistake for a TARGET response. The fix is the machine-readable
 * code: a result carrying errorCode TOOL_TIMEOUT is the runner saying
 * "our tool ran out of time — not a target response", and the dispatch
 * layer treats it accordingly (a coded timeout executed nothing: it
 * marks no battery item attempted and advances no variant). What we
 * prove here:
 *  1. the TOOL_TIMEOUT code is a single exported source and
 *     toolTimeoutResult carries the typed shape;
 *  2. the nuclei handler's executor-timeout path returns the typed
 *     result (adoption), not the old ABORTED free text.
 *
 * (The distress classification this file originally also covered fed
 * the per-target auto-halt tracker; that stop-signal class was removed
 * on the operator's order, 2026-11-01, and its tests went with it.)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TOOL_TIMEOUT, toolTimeoutResult } from "../src/dispatch/timeout.js";
import { handleNucleiTools } from "../src/dispatch/nuclei.js";
import { NucleiExecutor, resolveNucleiTimeoutS, type SpawnFn } from "../src/nuclei/index.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";

const HOST = "10.9.0.12";

describe("TOOL_TIMEOUT contract", () => {
  it("the code is the dispatch module's exported constant (single source)", () => {
    assert.equal(TOOL_TIMEOUT, "TOOL_TIMEOUT");
  });

  it("toolTimeoutResult carries the typed shape", () => {
    const r = toolTimeoutResult({ toolName: "nuclei_exec", timeoutMs: 50, target: HOST });
    assert.equal(r.errorCode, TOOL_TIMEOUT);
    assert.equal(r.ok, false);
    assert.equal(r.target, HOST);
    assert.ok(r.result.startsWith("TIMEOUT: "));
    assert.ok(r.result.includes("tool call timed out after 50ms"));
    assert.ok(r.result.includes("nuclei_exec"));
    assert.ok(r.result.includes("not a target response"));
  });
});

describe("nuclei adoption — the executor-timeout path is typed", () => {
  const timedOutSpawn = (async () => ({
    stdout: "",
    stderr: "",
    exitCode: null,
    killed: true,
    timedOut: true,
  })) as unknown as SpawnFn;

  function fakeCtx(): never {
    return {
      probesUsed: 0,
      coverage: new Set<string>(),
      targetCoverage: new Map(),
      input: { mode: "red", fullBattery: false, roe: {} },
      events: { updateState: () => {} },
      hosts: [HOST],
      safety: { rpsPerHost: 2 },
      nucleiExecutor: new NucleiExecutor({
        env: { REDTEAM_NUCLEI_BIN: "/usr/bin/nuclei" },
        spawn: timedOutSpawn,
        probeBinary: async () => true,
      }),
      nuclei: { templateExecutions: 0, templatesRun: 0, findings: 0 },
    } as never;
  }

  it("a timed-out run returns errorCode TOOL_TIMEOUT, not the old ABORTED free text", async () => {
    const call: ToolCallRequest = {
      id: "call-nuclei-timeout",
      name: "nuclei_exec",
      arguments: { action: "run", host: HOST, category: "functionality", targetProfile: "windows", attackId: "T1595.002" },
    };
    const r = await handleNucleiTools(fakeCtx(), "exploiter", "exploit", call, call.arguments as Record<string, unknown>);
    assert.ok(r);
    assert.equal(r.errorCode, TOOL_TIMEOUT);
    assert.equal(r.ok, false);
    assert.ok(r.result.startsWith("TIMEOUT: "));
    assert.ok(!r.result.startsWith("ABORTED"));
    assert.ok(r.result.includes(`tool call timed out after ${resolveNucleiTimeoutS() * 1000 + 15000}ms`));
  });
});
