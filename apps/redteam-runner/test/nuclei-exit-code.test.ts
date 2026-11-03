/**
 * S4-H4 — a nuclei process failure must not read as a "0 findings" success.
 *
 * The defect: NucleiExecutor.run used only stdout/timedOut/killed from the
 * spawn result and never inspected exitCode or stderr. A run that exited
 * non-zero with empty stdout (dead templates dir, template-load failure)
 * returned a clean "0 findings" success, dispatch counted it as a success,
 * and the router marked the battery item attempted — a scan that never
 * ran was recorded as a scan that ran and found nothing.
 *
 * What we prove, through the executor's injectable spawn seam:
 *  - exitCode 1 + empty stdout + stderr naming the cause → the refused-style
 *    failure result, carrying the stderr text — not a success;
 *  - exitCode null when NOT timed out and NOT killed → the same failure;
 *  - through the real dispatch handler the failure is DENIED-prefixed (the
 *    router's attempted-marking gate in dispatch/router.ts skips
 *    DENIED/HALTED/ABORTED/REFUSED-prefixed results), the honest counters
 *    do not move, and through the real dispatchTool the battery item is
 *    NOT marked attempted — while a clean run through the same path IS;
 *  - controls unchanged: exit 0 with findings, exit 0 with no findings,
 *    a non-zero exit WITH parsed findings (findings preserved), and the
 *    timedOut / killed result shapes, byte-identical to base.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NucleiExecutor, type SpawnFn } from "../src/nuclei/index.js";
import { handleNucleiTools } from "../src/dispatch/nuclei.js";
import { dispatchTool } from "../src/dispatch/router.js";
import { TargetRateLimiter } from "../src/safety/ratelimit.js";
import type { ItemVerdict } from "../src/coverage/items.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";

const HOST = "10.9.0.12";
const SCOPE = [HOST];
const TEST_ENV: NodeJS.ProcessEnv = { REDTEAM_NUCLEI_BIN: "/usr/bin/nuclei" };

const FINDING_LINE = JSON.stringify({
  "template-id": "CVE-2021-44228",
  info: { name: "Log4Shell RCE", severity: "critical", tags: ["cve", "rce"] },
  host: "https://10.9.0.12",
  "matched-at": "https://10.9.0.12/login",
});

interface Canned {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  killed?: boolean;
  timedOut?: boolean;
}

function cannedSpawn(c: Canned): SpawnFn {
  return async () => ({
    stdout: c.stdout ?? "",
    stderr: c.stderr ?? "",
    exitCode: c.exitCode === undefined ? 0 : c.exitCode,
    killed: c.killed ?? false,
    timedOut: c.timedOut ?? false,
  });
}

function testExecutor(spawn: SpawnFn): NucleiExecutor {
  return new NucleiExecutor({ env: TEST_ENV, spawn, probeBinary: async () => true });
}

const runArgs = { host: HOST, scopeHosts: SCOPE, rateLimit: 2 };

// ---------------------------------------------------------------------------
// Executor: process-level failures are failures
// ---------------------------------------------------------------------------

describe("nuclei executor — process failure is not a clean empty success (S4-H4)", () => {
  it("exitCode 1 + empty stdout + stderr naming the cause → refused failure carrying the stderr text", async () => {
    const exec = testExecutor(cannedSpawn({
      exitCode: 1,
      stdout: "",
      stderr: "[ERR] could not load template /missing/templates/http/cves.yaml: no such file or directory\n[INF] templates loaded: 0",
    }));
    const res = await exec.run(runArgs);
    assert.ok(res.refused, "a non-zero exit with no parsed findings must be a refused-style failure");
    assert.ok(res.refused.includes("could not load template /missing/templates/http/cves.yaml"), "the failure carries the first lines of stderr");
    assert.equal(res.findings.length, 0);
    assert.ok(!res.summary.includes("0 findings"), "the failure must not read as a clean 0-findings success");
  });

  it("exitCode null + not timed out + not killed → failure (a vanished process is not a success)", async () => {
    const exec = testExecutor(cannedSpawn({
      exitCode: null,
      stdout: "",
      stderr: "spawn /usr/bin/nuclei ENOENT",
    }));
    const res = await exec.run(runArgs);
    assert.ok(res.refused, "exitCode null outside the timedOut/killed paths must be a failure");
    assert.ok(res.refused.includes("ENOENT"), "the failure carries the stderr text");
    assert.equal(res.findings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Executor: controls — pre-existing shapes unchanged
// ---------------------------------------------------------------------------

describe("nuclei executor — controls unchanged (S4-H4)", () => {
  it("exitCode 0 with findings → the same success as base", async () => {
    const exec = testExecutor(cannedSpawn({ exitCode: 0, stdout: FINDING_LINE }));
    const res = await exec.run(runArgs);
    assert.ok(!res.refused);
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0]?.cve, "CVE-2021-44228");
    assert.ok(res.summary.includes("1 findings"));
  });

  it("exitCode 0 with no findings → still a clean 0-findings success", async () => {
    const exec = testExecutor(cannedSpawn({ exitCode: 0, stdout: "" }));
    const res = await exec.run(runArgs);
    assert.ok(!res.refused);
    assert.equal(res.findings.length, 0);
    assert.ok(res.summary.includes("0 findings"));
  });

  it("non-zero exit WITH parsed findings → findings preserved, not refused", async () => {
    const exec = testExecutor(cannedSpawn({ exitCode: 1, stdout: FINDING_LINE, stderr: "some templates failed to compile" }));
    const res = await exec.run(runArgs);
    assert.ok(!res.refused, "parsed findings must not be discarded over a non-zero exit");
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0]?.templateId, "CVE-2021-44228");
    assert.ok(res.summary.includes("1 findings"));
  });

  it("timedOut result shape → pre-existing behavior byte-identical", async () => {
    const exec = testExecutor(cannedSpawn({ exitCode: null, killed: true, timedOut: true, stdout: FINDING_LINE }));
    const res = await exec.run(runArgs);
    assert.ok(!res.refused);
    assert.equal(res.timedOut, true);
    assert.equal(res.findings.length, 1);
    assert.equal(
      res.summary,
      "Nuclei run against https://10.9.0.12: 1 findings (top severity: critical; 1 output lines, 0 parse errors) — TIMED OUT at the runner timeout",
    );
  });

  it("killed result shape → pre-existing behavior byte-identical (killed + no findings is not reclassified)", async () => {
    const exec = testExecutor(cannedSpawn({ exitCode: null, killed: true, timedOut: false, stdout: "" }));
    const res = await exec.run(runArgs);
    assert.ok(!res.refused);
    assert.ok(!res.timedOut);
    assert.equal(
      res.summary,
      "Nuclei run against https://10.9.0.12: 0 findings (top severity: none; 0 output lines, 0 parse errors) — KILLED by call signal",
    );
  });
});

// ---------------------------------------------------------------------------
// Dispatch boundary: the failure is DENIED, counters do not move
// ---------------------------------------------------------------------------

function handlerCtx(exec: NucleiExecutor): never {
  return {
    probesUsed: 0,
    coverage: new Set<string>(),
    targetCoverage: new Map(),
    input: { mode: "red", fullBattery: false, roe: {} },
    events: { updateState: () => {} },
    hosts: SCOPE,
    safety: { rpsPerHost: 2 },
    nucleiExecutor: exec,
    nuclei: { templateExecutions: 0, templatesRun: 0, findings: 0 },
  } as never;
}

const runCall = (): ToolCallRequest => ({
  id: "call-nuclei-exit",
  name: "nuclei_exec",
  arguments: { action: "run", host: HOST, category: "functionality", targetProfile: "windows", attackId: "T1595.002" },
});

describe("nuclei dispatch — a process failure surfaces as a failure (S4-H4)", () => {
  it("exitCode 1 run → DENIED-prefixed result carrying the stderr text; honest counters do not move", async () => {
    const exec = testExecutor(cannedSpawn({
      exitCode: 1,
      stdout: "",
      stderr: "[ERR] could not load template /missing/templates/x.yaml: no such file or directory",
    }));
    const ctx = handlerCtx(exec);
    const call = runCall();
    const r = await handleNucleiTools(ctx, "exploiter", "exploit", call, call.arguments as Record<string, unknown>);
    assert.ok(r);
    // DENIED is one of the prefixes dispatch/router.ts's attempted-marking
    // gate (/^(DENIED|HALTED|ABORTED|REFUSED)/i) excludes — this result can
    // never mark a battery item attempted.
    assert.ok(r.result.startsWith("DENIED"), `expected a DENIED-prefixed failure, got: ${r.result.slice(0, 80)}`);
    assert.ok(r.result.includes("could not load template /missing/templates/x.yaml"));
    const n = (ctx as { nuclei: { templateExecutions: number; findings: number } }).nuclei;
    assert.equal(n.templateExecutions, 0);
    assert.equal(n.findings, 0);
  });
});

// ---------------------------------------------------------------------------
// Router boundary: battery attempted-marking does not fire on the failure
// ---------------------------------------------------------------------------

function routerCtx(exec: NucleiExecutor, ledger: Map<string, ItemVerdict>): never {
  return {
    actions: 0,
    probesUsed: 0,
    coverage: new Set<string>(),
    targetCoverage: new Map(),
    input: { mode: "red", fullBattery: true, roe: { scope: SCOPE } },
    hosts: SCOPE,
    events: {
      dir: "/tmp/nuclei-exit-code-test-no-such-dir",
      engagementId: "eng-nuclei-exit-code-test",
      append: () => {},
      updateState: () => {},
    },
    tier: { current: 2, declared: 2, chainSteps: new Map<string, number>() },
    safety: { limiter: new TargetRateLimiter({ rpsPerHost: 1000, burst: 1000 }, () => 0), rpsPerHost: 2 },
    itemLedger: ledger,
    nucleiExecutor: exec,
    nuclei: { templateExecutions: 0, templatesRun: 0, findings: 0 },
  } as never;
}

function pendingLedger(): Map<string, ItemVerdict> {
  // One pending windows item, hand-built so its disposition is not gated
  // on the nuclei-binary prerequisite the real WS-108 entry carries —
  // attempted-marking only flips a pending entry, which is the behavior
  // under test here.
  return new Map<string, ItemVerdict>([
    ["windows:WS-108", {
      key: "windows:WS-108",
      target: "windows",
      itemId: "WS-108",
      category: "functionality",
      name: "Template-based checks via Nuclei",
      disposition: "pending",
    }],
  ]);
}

const routerCall = (): ToolCallRequest => ({
  id: "call-nuclei-router",
  name: "nuclei_exec",
  arguments: {
    action: "run", host: HOST, category: "functionality", targetProfile: "windows",
    attackId: "T1595.002", batteryItem: "WS-108",
  },
});

describe("nuclei router — attempted-marking (S4-H4)", () => {
  it("a process-failed run does NOT mark the battery item attempted", async () => {
    const ledger = pendingLedger();
    const exec = testExecutor(cannedSpawn({
      exitCode: 1,
      stdout: "",
      stderr: "[ERR] could not load template /missing/templates/x.yaml: no such file or directory",
    }));
    const r = await dispatchTool(routerCtx(exec, ledger), "exploiter", "exploit", routerCall());
    assert.ok(r.result.startsWith("DENIED"), `expected a DENIED-prefixed failure, got: ${r.result.slice(0, 80)}`);
    assert.equal(ledger.get("windows:WS-108")?.disposition, "pending", "a scan that never ran must not be recorded as attempted");
  });

  it("control: a clean run through the same path DOES mark the item attempted", async () => {
    const ledger = pendingLedger();
    const exec = testExecutor(cannedSpawn({ exitCode: 0, stdout: FINDING_LINE }));
    const r = await dispatchTool(routerCtx(exec, ledger), "exploiter", "exploit", routerCall());
    assert.ok(!r.result.startsWith("DENIED"));
    assert.equal(ledger.get("windows:WS-108")?.disposition, "executed-clean");
  });
});
