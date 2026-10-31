/**
 * Q-TOOLTIMEOUT: the typed TOOL_TIMEOUT contract and the distress fix.
 *
 * The defect: a timeout of OUR OWN tool was recorded as TARGET distress —
 * isTargetDistress string-matched /timed out|timeout/ in the result text,
 * so five consecutive tool timeouts auto-halted a healthy target (the
 * nuclei executor's ABORTED timeout text tripped it live). The fix keys
 * on the machine-readable code: a result carrying errorCode TOOL_TIMEOUT
 * is never distress, whatever its text says. What we prove:
 *  1. five (and a full window of twenty) consecutive tool timeouts never
 *     halt the target and never increment the halt count;
 *  2. timeout TEXT with the code does not count — and only that code
 *     suppresses: uncoded timeout text and other codes classify as before;
 *  3. genuine distress (5xx, 429/lockout charter §6 signals) still trips
 *     the halt exactly as before;
 *  4. mixed streams count per the spec: a timeout records a non-distress
 *     outcome — it resets the consecutive streak and dilutes the window
 *     rate, adding no distress of its own;
 *  5. the nuclei handler's executor-timeout path returns the typed
 *     result (adoption), not the old ABORTED free text.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TargetAutoHalt, isTargetDistress } from "../src/safety/index.js";
import { TOOL_TIMEOUT, toolTimeoutResult } from "../src/dispatch/timeout.js";
import { handleNucleiTools } from "../src/dispatch/nuclei.js";
import { NucleiExecutor, resolveNucleiTimeoutS, type SpawnFn } from "../src/nuclei/index.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";

const HOST = "10.9.0.12";

/** The exact composition the router performs for every dispatch result. */
function feed(halt: TargetAutoHalt, r: { result: string; errorCode?: string }): string | null {
  return halt.recordOutcome(HOST, isTargetDistress(r.result, r.errorCode));
}

describe("TOOL_TIMEOUT contract", () => {
  it("the classifier honors the dispatch module's exported code (single source)", () => {
    assert.equal(TOOL_TIMEOUT, "TOOL_TIMEOUT");
    assert.equal(isTargetDistress("tool call timed out", TOOL_TIMEOUT), false);
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

describe("class 2 — coded timeout text is not distress", () => {
  it("timeout wording with the TOOL_TIMEOUT code classifies clean", () => {
    assert.equal(isTargetDistress("ssh_exec timed out after 30s", TOOL_TIMEOUT), false);
    assert.equal(isTargetDistress("ABORTED: nuclei run timed out at the runner timeout — target h", TOOL_TIMEOUT), false);
    const t = toolTimeoutResult({ toolName: "nuclei_exec", timeoutMs: 135000, target: HOST });
    assert.equal(isTargetDistress(t.result, t.errorCode), false);
  });

  it("only TOOL_TIMEOUT suppresses: uncoded text and other codes classify as before", () => {
    assert.equal(isTargetDistress("ssh_exec timed out after 30s"), true);
    assert.equal(isTargetDistress("timed out", "UNRELATED_CODE"), true);
    assert.equal(isTargetDistress("HTTP 503 from target", "UNRELATED_CODE"), true);
    assert.equal(isTargetDistress("HTTP 404 not found", TOOL_TIMEOUT), false);
  });
});

describe("class 1 — consecutive tool timeouts never halt a healthy target", () => {
  it("five consecutive TOOL_TIMEOUT results: no halt, no escalation count", () => {
    const halt = new TargetAutoHalt();
    const t = toolTimeoutResult({ toolName: "nuclei_exec", timeoutMs: 50, target: HOST });
    for (let i = 0; i < 5; i++) assert.equal(feed(halt, t), null);
    assert.equal(halt.isHalted(HOST), false);
    assert.equal(halt.halts, 0);
  });

  it("a full window of twenty timeouts still does not halt (rate stays 0)", () => {
    const halt = new TargetAutoHalt();
    const t = toolTimeoutResult({ toolName: "host_exec", timeoutMs: 300000, target: HOST });
    for (let i = 0; i < 20; i++) assert.equal(feed(halt, t), null);
    assert.equal(halt.isHalted(HOST), false);
    assert.equal(halt.halts, 0);
  });
});

describe("class 3 — genuine distress still trips exactly as before", () => {
  it("five consecutive 5xx outcomes halt with the consecutive reason", () => {
    const halt = new TargetAutoHalt();
    for (let i = 0; i < 4; i++) assert.equal(feed(halt, { result: "HTTP 503 from target" }), null);
    const reason = feed(halt, { result: "HTTP 503 from target" });
    assert.match(reason ?? "", /5 consecutive target-distress outcomes/);
    assert.equal(halt.isHalted(HOST), true);
    assert.equal(halt.halts, 1);
  });

  it("the charter §6 throttling signal halts through the tracker", () => {
    const halt = new TargetAutoHalt();
    for (let i = 0; i < 4; i++) assert.equal(feed(halt, { result: "HTTP 429 from target" }), null);
    assert.ok(feed(halt, { result: "HTTP 429 from target" }));
    assert.equal(halt.isHalted(HOST), true);
  });
});

describe("class 4 — mixed streams count per the spec", () => {
  it("a timeout resets the consecutive streak instead of extending it", () => {
    const halt = new TargetAutoHalt();
    const t = toolTimeoutResult({ toolName: "web_probe", timeoutMs: 120000, target: HOST });
    for (let i = 0; i < 4; i++) assert.equal(feed(halt, { result: "HTTP 503 from target" }), null);
    assert.equal(feed(halt, t), null); // streak 4 → 0, not 5
    assert.equal(halt.isHalted(HOST), false);
    for (let i = 0; i < 4; i++) assert.equal(feed(halt, { result: "HTTP 503 from target" }), null);
    assert.ok(feed(halt, { result: "HTTP 503 from target" })); // fresh streak of 5 halts
    assert.equal(halt.isHalted(HOST), true);
  });

  it("timeouts dilute the window rate without adding distress", () => {
    const halt = new TargetAutoHalt();
    const t = toolTimeoutResult({ toolName: "web_probe", timeoutMs: 120000, target: HOST });
    // 9 distress + 11 timeouts fill the 20-outcome window: rate 9/20 < 50%,
    // and alternation prevents any consecutive streak — no halt.
    for (let i = 0; i < 9; i++) {
      assert.equal(feed(halt, { result: "HTTP 503 from target" }), null);
      assert.equal(feed(halt, t), null);
    }
    assert.equal(feed(halt, t), null);
    assert.equal(feed(halt, t), null);
    assert.equal(halt.isHalted(HOST), false);
    assert.equal(halt.halts, 0);
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
      hostKill: { aborted: false, controllers: new Set() },
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

  it("a timed-out run returns errorCode TOOL_TIMEOUT and no longer reads as distress", async () => {
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
    assert.equal(isTargetDistress(r.result, r.errorCode), false);
  });
});
