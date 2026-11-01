/**
 * Kill-switch removal — no-effect controls (operator order, 2026-11-01:
 * "remove the kill switch as well... I'm trying to build a real tool,
 * not a toy").
 *
 * The stop-signal class is gone: the ESTOP fleet pause sentinel, the
 * abort.json cross-process signal, the coordinator/operator
 * abort_engagement tools, the per-target auto-halt / distress breaker,
 * and every executor killSwitch binding. These tests prove the removal
 * is real by engaging the old stop state exactly as the old code read
 * it and showing that work still executes:
 *
 *  1. A full engagement runs to completion with the ESTOP sentinel
 *     present at every path the old launch gate read (the
 *     REDTEAM_ESTOP_PATH override AND <dirname(registryPath)>/ESTOP)
 *     and an abort.json sitting in its own engagement directory.
 *  2. A distress storm — six consecutive HTTP 500 probe outcomes, past
 *     the old auto-halt threshold of five — never refuses the next
 *     call: every dispatch executes, no HALTED result, no
 *     target_auto_halt event.
 *  3. Operator-mode calls (no engagement) execute with the ESTOP
 *     sentinel engaged.
 *
 * Fixtures/fakes only — no real target is touched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEngagement } from "../src/phases.js";
import { readEvents } from "../src/events.js";
import type { EngagementInput } from "../src/types.js";
import { dispatchTool } from "../src/dispatch/router.js";
import { TargetRateLimiter } from "../src/safety/ratelimit.js";
import { CredentialAttemptGuard } from "../src/safety/lockout.js";
import type { Ctx } from "../src/context.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { EXEC_TOOLS_BY_NAME } from "../src/ui/mcp-exec.js";
import { createOperatorDispatcher, installOperatorDispatcher } from "../src/operator.js";

const savedEstopPath = process.env["REDTEAM_ESTOP_PATH"];
const savedHome = process.env["REDTEAM_HOME"];

function restoreEnv(): void {
  if (savedEstopPath === undefined) delete process.env["REDTEAM_ESTOP_PATH"];
  else process.env["REDTEAM_ESTOP_PATH"] = savedEstopPath;
  if (savedHome === undefined) delete process.env["REDTEAM_HOME"];
  else process.env["REDTEAM_HOME"] = savedHome;
}

describe("kill switch removed — engagement completion under engaged stop state", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-noks-"));
  });
  afterEach(() => {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a dry-run engagement completes with ESTOP engaged at every old path and abort.json in its dir", async () => {
    // The old launch gate (requireEstopClear) read, in order: the
    // REDTEAM_ESTOP_PATH override (the ONLY path when set) and, without
    // an override, <dirname(registryPath)>/ESTOP. Engage both shapes:
    // the sentinel beside the registry for the no-override read, and
    // the override variable pointing at its own sentinel file.
    writeFileSync(join(dir, "ESTOP"), "fleet maintenance");
    const overridePath = join(dir, "estop-override");
    writeFileSync(overridePath, "operator stop");
    process.env["REDTEAM_ESTOP_PATH"] = overridePath;

    const engagementId = "eng-noks-1";
    // abort.json in the engagement's own directory — the old dispatcher
    // polled for exactly this file on every dispatch cycle.
    const engDir = join(dir, engagementId);
    mkdirSync(engDir, { recursive: true });
    writeFileSync(join(engDir, "abort.json"), JSON.stringify({ requestedAt: new Date().toISOString(), by: "ui-operator", reason: "stop" }));

    const input: EngagementInput = {
      target: "secscan.us",
      mode: "red",
      objective: "kill-switch removal control",
      roe: { scope: ["secscan.us"] },
    };
    const res = await runEngagement(input, {
      mcpToken: "test",
      deepseekApiKey: "test",
      qwenApiKey: "test",
      engagementsDir: dir,
      registryPath: join(dir, "registry.json"),
      engagementId,
      dryRunAgents: true,
      deps: { verify: async () => true },
    });
    assert.equal(res.status, "complete", "the engagement must run to completion — no stop signal may halt it");
    // The stop files were never consumed or acted on.
    assert.ok(existsSync(join(dir, "ESTOP")), "ESTOP sentinel left untouched");
    assert.ok(existsSync(join(engDir, "abort.json")), "abort.json left untouched");
    const events = readEvents(engDir);
    assert.equal(events.some((e) => e.action === "abort_engagement"), false, "no abort was recorded");
    assert.equal(events.some((e) => e.action === "target_auto_halt"), false, "no auto-halt was recorded");
  });
});

describe("kill switch removed — distress storm never refuses", () => {
  it("six consecutive 500 outcomes: every http_probe still executes", async () => {
    const host = "app.example.com";
    const appended: Array<{ action: string; result: string }> = [];
    let probes = 0;
    const ctx = {
      input: { mode: "red", roe: { scope: [host] }, fullBattery: false },
      hosts: [host],
      verifiedScope: [host],
      domain: host,
      events: {
        dir: "/tmp/noks-test-no-such-dir",
        engagementId: "eng-noks",
        append: (e: { action: string; result: string }) => appended.push(e),
        updateState: () => {},
      },
      tier: { current: 2, declared: 2, chainSteps: new Map<string, number>() },
      safety: {
        limiter: new TargetRateLimiter({ rpsPerHost: 1000, burst: 1000 }, () => 0),
        lockout: new CredentialAttemptGuard(),
        rpsPerHost: 5,
      },
      itemLedger: new Map(),
      opsecCooldown: new Set<string>(),
      coverage: new Set<string>(),
      targetCoverage: new Map(),
      probesUsed: 0,
      consecutive5xx: 0,
      prober: {
        probe: async () => {
          probes++;
          return { status: 500, ms: 3, headers: {}, bodySnippet: "internal error", bodyBytes: 14 };
        },
      },
    } as unknown as Ctx;

    for (let i = 0; i < 6; i++) {
      const call: ToolCallRequest = {
        id: `call-storm-${i}`,
        name: "http_probe",
        arguments: { method: "GET", url: `http://${host}/p${i}` },
      };
      const r = await dispatchTool(ctx, "exploiter", "exploit", call);
      assert.ok(!r.result.startsWith("HALTED"), `call ${i} must not be auto-halt refused: ${r.result.slice(0, 120)}`);
    }
    assert.equal(probes, 6, "every probe reached the target — the old tracker halted the host at five");
    assert.equal(appended.some((e) => e.action === "target_auto_halt"), false);
    assert.equal(appended.some((e) => e.action === "distress_escalation"), false);
  });
});

describe("kill switch removed — operator mode under engaged ESTOP", () => {
  afterEach(() => {
    installOperatorDispatcher(undefined);
    restoreEnv();
  });

  it("http_probe executes through the MCP exec surface with the ESTOP sentinel engaged", async () => {
    const home = mkdtempSync(join(tmpdir(), "rt-noks-op-"));
    try {
      const sentinel = join(home, "ESTOP");
      writeFileSync(sentinel, "operator stop");
      process.env["REDTEAM_ESTOP_PATH"] = sentinel;
      process.env["REDTEAM_HOME"] = home;
      let probes = 0;
      const dispatcher = createOperatorDispatcher({
        deps: {
          prober: {
            probe: async (req: { url: string }) => {
              probes++;
              return { status: 200, ms: 1, headers: {}, bodySnippet: `OK ${req.url}`, bodyBytes: 42 };
            },
          } as never,
        },
      });
      installOperatorDispatcher(dispatcher);
      const tool = EXEC_TOOLS_BY_NAME.get("http_probe");
      assert.ok(tool, "http_probe is on the executor surface");
      const text = await tool.run({ method: "GET", url: "http://op.example.com/" });
      assert.match(text, /HTTP 200/);
      assert.equal(probes, 1, "the probe executed — ESTOP state has no effect");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
