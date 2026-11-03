/**
 * Operator dispatch — executor tools with NO live engagement (v0.31.0).
 *
 * Carlos's order (2026-11-01): the executor bridges must not be gated on a
 * running engagement. These tests pin the ungated contract:
 *
 *   1. With ZERO engagements live, http_probe / msf_exec / nmap_exec calls
 *      made without an engagementId EXECUTE (against fixture transports —
 *      never a real target) and return the tool's own result.
 *   2. A no-id call never binds to a live engagement: with one registered,
 *      an id-less call still runs in the operator context, and an
 *      id-bearing call still runs in the engagement's context.
 *   3. A non-live id fails honestly ("not running") with ZERO execution —
 *      no silent fallback to operator mode.
 *   4. The ESTOP sentinel's presence does not touch operator dispatch.
 *   5. What is kept is kept: calls are paced by the per-host rate limiter
 *      and written to the operator event log (audit).
 *
 * All transports are fakes with call counters; the counters are the proof
 * of which context executed (and that a refused call executed nothing).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXEC_TOOLS_BY_NAME, LIST_LIVE_TOOL } from "../src/ui/mcp-exec.js";
import { createOperatorDispatcher, installOperatorDispatcher } from "../src/operator.js";
import { registerLive, unregisterLive } from "../src/live.js";
import type { RunnerDeps } from "../src/context.js";

const PROBE_URL = "http://127.0.0.1:8080/operator-fixture";

function fakeDeps(marker: string, counters: { probe: number; msf: number; nmap: number }): RunnerDeps {
  return {
    prober: {
      probe: async () => {
        counters.probe++;
        return { status: 200, headers: {}, bodySnippet: marker, ms: 1 };
      },
    } as unknown as RunnerDeps["prober"],
    msfExecutor: {
      search: async () => {
        counters.msf++;
        return { summary: `${marker} msf search: 1 module matched`, ok: true, output: "exploit/fake/module" };
      },
      run: async () => {
        counters.msf++;
        return { summary: `${marker} msf run: module executed, marker echoed`, ok: true, output: "marker echoed" };
      },
    } as unknown as RunnerDeps["msfExecutor"],
    nmapExecutor: {
      scan: async () => {
        counters.nmap++;
        return {
          ok: true,
          action: "scan",
          message: `${marker} nmap scan complete`,
          run: {
            hosts: [
              {
                address: "127.0.0.1",
                hostnames: [],
                ports: [
                  { port: 80, protocol: "tcp", state: "open", service: "http", product: "", version: "", scripts: {} },
                ],
                osMatches: [],
              },
            ],
          },
        };
      },
      profiles: async () => ({ message: "profiles" }),
    } as unknown as RunnerDeps["nmapExecutor"],
  };
}

function testEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, REDTEAM_HOME: home, ...extra };
  delete env["REDTEAM_TEST_MODE"];
  delete env["REDTEAM_VERIFY_VIA_SERVICE"];
  return env;
}

function makeDispatcher(marker: string, extraEnv: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "operator-dispatch-"));
  const counters = { probe: 0, msf: 0, nmap: 0 };
  const dispatcher = createOperatorDispatcher({
    deps: fakeDeps(marker, counters),
    env: testEnv(home, extraEnv),
  });
  return { home, counters, dispatcher };
}

afterEach(() => {
  installOperatorDispatcher(undefined);
  unregisterLive("eng-op-fixture");
});

describe("operator dispatch (no engagementId)", () => {
  it("executes http_probe with zero engagements live", async () => {
    const { counters, dispatcher } = makeDispatcher("OPERATOR-CTX");
    installOperatorDispatcher(dispatcher);
    const out = await EXEC_TOOLS_BY_NAME.get("http_probe")!.run({ url: PROBE_URL });
    assert.equal(counters.probe, 1, "the operator prober executed");
    assert.match(out, /200/);
    assert.match(out, /OPERATOR-CTX/);
  });

  it("executes msf_exec search and run with zero engagements live", async () => {
    const { counters, dispatcher } = makeDispatcher("OPERATOR-CTX");
    installOperatorDispatcher(dispatcher);
    const search = await EXEC_TOOLS_BY_NAME.get("msf_exec")!.run({
      action: "search",
      targetProfile: "linux",
      host: "127.0.0.1",
      query: "fake",
    });
    assert.match(search, /msf search: 1 module matched/);
    // `run` is the action the engagement design phase-gates to exploit and
    // tier-gates hardest; the operator posture (exploit phase, Tier 2)
    // executes it with no engagement at all.
    const run = await EXEC_TOOLS_BY_NAME.get("msf_exec")!.run({
      action: "run",
      targetProfile: "linux",
      host: "127.0.0.1",
      module: "exploit/fake/module",
    });
    assert.match(run, /msf run: module executed/);
    assert.equal(counters.msf, 2);
  });

  it("executes nmap_exec scan with zero engagements live", async () => {
    const { counters, dispatcher } = makeDispatcher("OPERATOR-CTX");
    installOperatorDispatcher(dispatcher);
    // The dispatch scan path presence-gates the resolved nmap binary
    // (S4-H2); this test's subject is engagement-less execution, so name a
    // binary that exists (the test runner's own node) and restore the env.
    const savedBin = process.env["REDTEAM_NMAP_BIN"];
    process.env["REDTEAM_NMAP_BIN"] = process.execPath;
    try {
      const out = await EXEC_TOOLS_BY_NAME.get("nmap_exec")!.run({
        action: "scan",
        targetProfile: "linux",
        host: "127.0.0.1",
        profile: "quick",
      });
      assert.equal(counters.nmap, 1);
      assert.match(out, /nmap scan complete/);
      assert.match(out, /80\/tcp open/);
    } finally {
      if (savedBin === undefined) delete process.env["REDTEAM_NMAP_BIN"];
      else process.env["REDTEAM_NMAP_BIN"] = savedBin;
    }
  });

  it("executes with the ESTOP sentinel present (operator path never reads it)", async () => {
    const home = mkdtempSync(join(tmpdir(), "operator-estop-"));
    const estopPath = join(home, "ESTOP");
    writeFileSync(estopPath, "STOP\n");
    const { counters, dispatcher } = makeDispatcher("OPERATOR-CTX", { REDTEAM_ESTOP_PATH: estopPath });
    installOperatorDispatcher(dispatcher);
    const out = await EXEC_TOOLS_BY_NAME.get("http_probe")!.run({ url: PROBE_URL });
    assert.equal(counters.probe, 1);
    assert.match(out, /OPERATOR-CTX/);
  });

  it("audits every call to the operator event log and paces via the rate limiter", async () => {
    const { home, dispatcher } = makeDispatcher("OPERATOR-CTX");
    installOperatorDispatcher(dispatcher);
    await EXEC_TOOLS_BY_NAME.get("http_probe")!.run({ url: PROBE_URL });
    await EXEC_TOOLS_BY_NAME.get("http_probe")!.run({ url: PROBE_URL });
    const logPath = join(home, "engagements", "operator", "events.jsonl");
    assert.ok(existsSync(logPath), "operator events.jsonl exists beside the engagements root");
    const log = readFileSync(logPath, "utf8");
    assert.equal(log.match(/operator_tool_call/g)?.length, 2, "both calls on record");
    assert.equal(log.match(/operator_tool_result/g)?.length, 2, "both results on record");
    assert.ok(dispatcher.ctx.safety.limiter.acquires >= 2, "the rate limiter paced both calls");
  });

  it("never binds a no-id call to a live engagement, and still honors a named one", async () => {
    const op = makeDispatcher("OPERATOR-CTX");
    installOperatorDispatcher(op.dispatcher);
    const live = makeDispatcher("LIVE-CTX");
    // Seat the live context the way a running engagement's would be.
    live.dispatcher.ctx.hosts = ["127.0.0.1"];
    live.dispatcher.ctx.domain = "127.0.0.1";
    live.dispatcher.ctx.verifiedScope = ["127.0.0.1"];
    registerLive("eng-op-fixture", live.dispatcher.ctx);

    const noId = await EXEC_TOOLS_BY_NAME.get("http_probe")!.run({ url: PROBE_URL });
    assert.match(noId, /OPERATOR-CTX/, "id-less call ran in the operator context");
    assert.equal(live.counters.probe, 0, "the live engagement's prober was not touched");
    assert.equal(op.counters.probe, 1);

    const withId = await EXEC_TOOLS_BY_NAME.get("http_probe")!.run({
      engagementId: "eng-op-fixture",
      url: PROBE_URL,
    });
    assert.match(withId, /LIVE-CTX/, "id-bearing call ran in the engagement's context");
    assert.equal(live.counters.probe, 1);
    assert.equal(op.counters.probe, 1, "operator context untouched by the engagement call");
  });

  it("refuses a non-live id honestly and executes nothing", async () => {
    const { counters, dispatcher } = makeDispatcher("OPERATOR-CTX");
    installOperatorDispatcher(dispatcher);
    await assert.rejects(
      () => EXEC_TOOLS_BY_NAME.get("http_probe")!.run({ engagementId: "eng-not-running", url: PROBE_URL }),
      /is not running in this process/,
    );
    assert.equal(counters.probe, 0, "no fallback: the operator prober never ran");
  });

  it("list_live_engagements stays pure discovery and reports tools as available", async () => {
    const out = await LIST_LIVE_TOOL.run({});
    assert.match(out, /No engagements are running/);
    assert.match(out, /without engagementId/);
    assert.ok(!/become available while it runs/.test(out), "the old gating text is gone");
  });
});
