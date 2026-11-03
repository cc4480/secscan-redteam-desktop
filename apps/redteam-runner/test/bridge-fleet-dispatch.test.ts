/**
 * Bridge dispatch (Q-BRIDGE-TOOLS, Builder B — revised design,
 * Carlos's order 2026-10-31 ~18:00 CDT).
 *
 * No allowlist, no localHost restriction: any bridge_* call routes to
 * the client whenever the bridge is live — including in a remote
 * engagement, because the tools act on the operator's own machine.
 * The handler re-checks availability LIVE on every call, so a bridge
 * that stops answering closes the gate for the next call, including a
 * re-dispatch through dispatchTool. A bridge-side consent denial is a
 * clean typed result (ok:false, never repairable, never a hang or a
 * crash). The loop-level test proves the house invariant: a bridge
 * call's result lands in the engagement's event log.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { agentLoop } from "../src/agents.js";
import type { Ctx } from "../src/context.js";
import { EventLog } from "../src/events.js";
import type { EngagementEvent } from "../src/types.js";
import { BridgeCallError, wrapBridgeClient, type BridgeClientLike, type BridgeToolInfo } from "../src/dispatch/bridge-client.js";
import { withBridgeTools } from "../src/dispatch/bridge-gate.js";
import { handleBridgeTools } from "../src/dispatch/bridge.js";
import { dispatchTool } from "../src/dispatch/router.js";

/** The live bridge's full registry (supervisor ground truth, ~/workspace/alterego @ 92ab12d): 63 ALL_TOOLS wire names + 4 job ops = 67. Re-ground-truthed 2026-11-01 (once-over sweep): the arbitration op's wire name is `arbitrate_tool` — it already was at 92ab12d; the fixture's `arbitrate` never matched the registry. */
const REGISTRY_OPS = [
  "active_window", "arbitrate_tool", "batch", "browser_click", "browser_eval", "browser_fill",
  "browser_navigate", "browser_snapshot", "clipboard_get", "clipboard_set", "close_window", "copy_file",
  "create_dir", "delete_file", "dns_query", "doctor", "edit_file", "exec_background",
  "exec_cancel", "exec_status", "file_info", "focus_window", "hotkey", "http_headers",
  "idle_seconds", "kill_process", "list_dir", "list_processes", "list_windows", "maximize_window",
  "memory_recall", "minimize_window", "mouse_click", "mouse_move", "mouse_scroll", "move_file",
  "notify", "paste_text", "power", "query_events", "read_file", "read_file_range",
  "replay_session", "screenshot", "search_filenames", "search_files", "set_volume", "shell_exec",
  "shell_pwsh", "speak", "system_info", "task_checkpoint", "task_create", "task_status",
  "tcp_check", "tls_info", "type_text", "uia_click", "uia_find", "uia_set_text",
  "web_fetch", "web_search", "write_file", "submit_job", "job_status", "job_result",
  "job_cancel",
] as const;

/** The cdp_* family: wire names copied exactly from AlterEgo's seams
 * definitions (~/workspace/alterego pc-agent/seams/definitions/browser.py
 * — CDP_LAUNCH … CDP_CLOSE), registered bridge-side on 2026-10-31. The
 * full registry is then 67 + 10 = 77; the fleet passes through whatever
 * a bridge offers, so all 77 must route — proven below. */
const CDP_OPS = [
  "cdp_launch", "cdp_connect", "cdp_targets", "cdp_navigate", "cdp_snapshot",
  "cdp_click", "cdp_type", "cdp_evaluate", "cdp_readback", "cdp_close",
] as const;

/** The full registry once the bridge serves the CDP family: 67 + 10 = 77. */
const REGISTRY_OPS_77 = [...REGISTRY_OPS, ...CDP_OPS] as const;

interface FakeClient extends BridgeClientLike {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  setAvailable(v: boolean): void;
}

function fakeClient(opts?: { available?: boolean; callError?: Error; ops?: readonly string[] }): FakeClient {
  let available = opts?.available ?? true;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    setAvailable(v: boolean) {
      available = v;
    },
    async available() {
      return available;
    },
    async listTools(): Promise<BridgeToolInfo[]> {
      return (opts?.ops ?? REGISTRY_OPS).map((name) => ({ name, description: `bridge description for ${name}`, inputSchema: { type: "object", properties: {} } }));
    },
    async call(name, args) {
      calls.push({ name, args });
      if (opts?.callError) throw opts.callError;
      return `result of ${name}`;
    },
  };
}

const call = (name: string, args: Record<string, unknown> = {}): ToolCallRequest =>
  ({ id: "c-1", name, arguments: args }) as unknown as ToolCallRequest;

/** A REMOTE engagement context (web target, no localHost) — bridge tools work here too when the bridge is live. */
function handlerCtx(): Ctx {
  return {
    input: { target: "https://shop.example.test", mode: "red", objective: "test", roe: { scope: ["shop.example.test"] } },
    events: { dir: "/tmp/bridge-fleet-dispatch-no-dir", append: () => {} },
    deps: {},
  } as unknown as Ctx;
}

/** A LOCAL-host engagement context — the same calls must work here too (the gate is availability only). */
function handlerCtxLocal(): Ctx {
  return {
    input: { target: "operator-pc", mode: "red", objective: "test", localHost: true, roe: { scope: ["operator-pc"] } },
    events: { dir: "/tmp/bridge-fleet-dispatch-no-dir", append: () => {} },
    deps: {},
  } as unknown as Ctx;
}

describe("bridge handler — availability re-check and full routing", () => {
  it("does not claim other families' tools", async () => {
    const client = fakeClient();
    const r = await handleBridgeTools(handlerCtx(), "recon", "recon", call("http_probe"), {}, client);
    assert.equal(r, null);
    assert.equal(client.calls.length, 0);
  });

  it("refuses when the bridge does not answer, and routes the full registry when it does", async () => {
    const down = fakeClient({ available: false });
    const refused = await handleBridgeTools(handlerCtx(), "recon", "recon", call("bridge_screenshot"), {}, down);
    assert.equal(refused?.ok, false);
    assert.match(refused?.result ?? "", /not available on this machine/u);
    assert.equal(refused?.repairable, undefined);
    assert.equal(down.calls.length, 0);

    const up = fakeClient({ available: true });
    for (const op of REGISTRY_OPS) {
      const r = await handleBridgeTools(handlerCtx(), "exploiter", "exploit", call(`bridge_${op}`, { probe: op }), { probe: op }, up);
      assert.equal(r?.ok, true, `bridge_${op} routes in a remote engagement`);
      assert.equal(r?.result, `result of ${op}`);
    }
    assert.deepEqual(
      up.calls.map((c) => c.name),
      [...REGISTRY_OPS],
      "every one of the 67 ops forwarded unprefixed and unfiltered — shell_pwsh, type_text, power, delete_file included",
    );
  });

  it("the supervisor's named ops are callable in a LOCAL engagement too (shell_pwsh, type_text, power, delete_file)", async () => {
    const up = fakeClient({ available: true });
    for (const op of ["shell_pwsh", "type_text", "power", "delete_file"]) {
      const r = await handleBridgeTools(handlerCtxLocal(), "exploiter", "exploit", call(`bridge_${op}`, { probe: op }), { probe: op }, up);
      assert.equal(r?.ok, true, `bridge_${op} callable in a local engagement`);
      assert.equal(r?.result, `result of ${op}`);
    }
    assert.deepEqual(up.calls.map((c) => c.name), ["shell_pwsh", "type_text", "power", "delete_file"]);
  });

  it("a bridge-side consent denial is a clean typed result — never a hang, crash, or silent drop", async () => {
    const consent = fakeClient({ callError: new BridgeCallError("bridge-denied", "denied by local approval") });
    const r = await handleBridgeTools(handlerCtx(), "exploiter", "exploit", call("bridge_write_file", { path: "x" }), { path: "x" }, consent);
    assert.equal(r?.ok, false);
    assert.match(r?.result ?? "", /operator consent denied/u);
    assert.equal(r?.repairable, undefined);
    assert.equal(consent.calls.length, 1, "the call reached the bridge and its no came back as a result");
  });

  it("bridge failures relay as honest results", async () => {
    const broken = fakeClient({ callError: new BridgeCallError("bridge-error", "target crashed") });
    const failed = await handleBridgeTools(handlerCtx(), "recon", "recon", call("bridge_cdp_snapshot"), {}, broken);
    assert.equal(failed?.ok, false);
    assert.equal(failed?.result, "bridge error: target crashed");

    const gone = fakeClient({ callError: new BridgeCallError("unavailable", "connection reset") });
    const unavailable = await handleBridgeTools(handlerCtx(), "recon", "recon", call("bridge_screenshot"), {}, gone);
    assert.equal(unavailable?.ok, false);
    assert.match(unavailable?.result ?? "", /became unavailable/u);
  });

  it("the wrapper passes the full registry through and normalizes A's result shape", async () => {
    const rawCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const raw = {
      async available() {
        return true;
      },
      async listTools(): Promise<BridgeToolInfo[]> {
        return REGISTRY_OPS.map((name) => ({ name, description: `d ${name}`, inputSchema: { type: "object", properties: {} } }));
      },
      async call(name: string, args: Record<string, unknown>) {
        rawCalls.push({ name, args });
        return { content: [{ type: "text", text: `raw result of ${name}` }], text: `raw result of ${name}` };
      },
    };
    const wrapped = wrapBridgeClient(raw);
    const listed = await wrapped.listTools();
    assert.deepEqual(listed.map((t) => t.name), [...REGISTRY_OPS], "no name is filtered out of the listing");
    const r = await handleBridgeTools(handlerCtx(), "exploiter", "exploit", call("bridge_shell_exec", { command: "whoami" }), { command: "whoami" }, wrapped);
    assert.equal(r?.ok, true);
    assert.equal(r?.result, "raw result of shell_exec");
    assert.deepEqual(rawCalls, [{ name: "shell_exec", args: { command: "whoami" } }]);
  });
});

// ---------------------------------------------------------------------------
// dispatchTool level: the full wrapper, gate flipped between attempts
// ---------------------------------------------------------------------------

function dispatchCtx(client: BridgeClientLike): Ctx {
  return {
    actions: 0,
    input: { target: "https://shop.example.test", mode: "red", objective: "test", roe: { scope: ["shop.example.test"], blackoutWindows: [] } },
    hosts: ["shop.example.test"],
    domain: "shop.example.test",
    events: { dir: "/tmp/bridge-fleet-dispatch-no-dir", append: () => {} },
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    tier: { current: 2, declared: 2, chainSteps: new Map<string, number>() },
    safety: {
      limiter: { acquire: async () => {} },
      autoHalt: { isHalted: () => false, haltReason: () => undefined, recordOutcome: () => undefined },
      killSwitchAborts: 0,
      rpsPerHost: 5,
    },
    itemLedger: new Map(),
    opsecCooldown: new Set<string>(),
    coverage: new Set<string>(),
    targetCoverage: new Map(),
    probesUsed: 0,
    consecutive5xx: 0,
    deps: { bridgeClient: client },
  } as unknown as Ctx;
}

describe("bridge dispatch through dispatchTool", () => {
  it("round-trips a call through the full wrapper via the deps seam", async () => {
    const client = fakeClient({ available: true });
    const ctx = dispatchCtx(client);
    const r = await dispatchTool(ctx, "recon", "recon", call("bridge_screenshot"));
    assert.equal(r.ok, true);
    assert.equal(r.result, "result of screenshot");
    assert.deepEqual(client.calls, [{ name: "screenshot", args: {} }]);
  });

  it("re-checks the gate on every dispatch: an availability flip closes it for the next call", async () => {
    const client = fakeClient({ available: true });
    const ctx = dispatchCtx(client);
    const first = await dispatchTool(ctx, "recon", "recon", call("bridge_screenshot"));
    assert.equal(first.ok, true);
    client.setAvailable(false);
    const second = await dispatchTool(ctx, "recon", "recon", call("bridge_screenshot"));
    assert.equal(second.ok, false);
    assert.match(second.result, /not available on this machine/u);
    assert.equal(second.repairable, undefined);
    assert.equal(client.calls.length, 1, "the flipped call never reached the bridge");
  });

  it("round-trips a cdp_* call through the full wrapper via the deps seam", async () => {
    const client = fakeClient({ available: true, ops: REGISTRY_OPS_77 });
    const ctx = dispatchCtx(client);
    const r = await dispatchTool(ctx, "exploiter", "exploit", call("bridge_cdp_snapshot"));
    assert.equal(r.ok, true);
    assert.equal(r.result, "result of cdp_snapshot");
    assert.deepEqual(client.calls, [{ name: "cdp_snapshot", args: {} }]);
  });
});

describe("bridge handler — the CDP family (77-tool registry)", () => {
  it("routes every cdp_* op in a REMOTE engagement", async () => {
    const up = fakeClient({ available: true, ops: REGISTRY_OPS_77 });
    for (const op of CDP_OPS) {
      const r = await handleBridgeTools(handlerCtx(), "exploiter", "exploit", call(`bridge_${op}`, { probe: op }), { probe: op }, up);
      assert.equal(r?.ok, true, `bridge_${op} routes in a remote engagement`);
      assert.equal(r?.result, `result of ${op}`);
    }
    assert.deepEqual(
      up.calls.map((c) => c.name),
      [...CDP_OPS],
      "every cdp_* op forwarded unprefixed and unfiltered in a remote engagement",
    );
  });

  it("routes every cdp_* op in a LOCAL engagement", async () => {
    const up = fakeClient({ available: true, ops: REGISTRY_OPS_77 });
    for (const op of CDP_OPS) {
      const r = await handleBridgeTools(handlerCtxLocal(), "exploiter", "exploit", call(`bridge_${op}`, { probe: op }), { probe: op }, up);
      assert.equal(r?.ok, true, `bridge_${op} routes in a local engagement`);
      assert.equal(r?.result, `result of ${op}`);
    }
    assert.deepEqual(
      up.calls.map((c) => c.name),
      [...CDP_OPS],
      "every cdp_* op forwarded unprefixed and unfiltered in a local engagement",
    );
  });

  it("the wrapper passes the full 77-name registry through unfiltered", async () => {
    const raw = {
      async available() {
        return true;
      },
      async listTools(): Promise<BridgeToolInfo[]> {
        return REGISTRY_OPS_77.map((name) => ({ name, description: `d ${name}`, inputSchema: { type: "object", properties: {} } }));
      },
      async call(name: string, _args: Record<string, unknown>) {
        return { content: [{ type: "text", text: `raw result of ${name}` }], text: `raw result of ${name}` };
      },
    };
    const wrapped = wrapBridgeClient(raw);
    const listed = await wrapped.listTools();
    assert.deepEqual(listed.map((t) => t.name), [...REGISTRY_OPS_77], "all 77 names pass through — cdp_* included, nothing filtered");
    const r = await handleBridgeTools(handlerCtx(), "exploiter", "exploit", call("bridge_cdp_navigate", { url: "https://shop.example.test" }), { url: "https://shop.example.test" }, wrapped);
    assert.equal(r?.ok, true);
    assert.equal(r?.result, "raw result of cdp_navigate");
  });
});

// ---------------------------------------------------------------------------
// Loop level: the result lands in the engagement's event log
// ---------------------------------------------------------------------------

type CompleteFn = (role: string, messages: unknown, opts: unknown) => Promise<unknown>;

function loopCtx(dir: string, completeForRole: CompleteFn, client: BridgeClientLike): Ctx {
  return {
    actions: 0,
    consecutive5xx: 0,
    deniedStreak: 0,
    redirects: { 'plan→recon': 0, 'recon→exploit': 0, 'exploit→report': 0 },
    wallRedirects: 0,
    startedAt: Date.now(),
    config: { maxActions: 100, maxDurationMs: 60_000 },
    input: {
      mode: "red",
      objective: "test",
      target: "https://shop.example.test",
      roe: { blackoutWindows: [], scope: ["shop.example.test"] },
    },
    deps: { completeForRole, bridgeClient: client },
    events: new EventLog(dir, "eng-bridge-fleet", { target: "shop.example.test", mode: "red", objective: "test" }),
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    safety: {
      killSwitchAborts: 0,
      limiter: { acquire: async () => {} },
      autoHalt: { isHalted: () => false, haltReason: () => undefined, recordOutcome: () => undefined },
      rpsPerHost: 5,
    },
    tier: { current: 2, declared: 2, chainSteps: new Map<string, number>() },
    hosts: ["shop.example.test"],
    domain: "shop.example.test",
    plan: null,
    targetMap: [],
    liveFindings: [],
    killedLive: [],
    registryHits: [],
    fingerprint: { stack: [], appType: "unknown" },
    coverage: new Set(),
    targetCoverage: new Map(),
    itemLedger: new Map(),
    opsecCooldown: new Set<string>(),
    prober: { probe: async () => ({ status: 200, ms: 1, bodySnippet: "ok" }) },
  } as unknown as Ctx;
}

function readEvents(dir: string): EngagementEvent[] {
  return readFileSync(join(dir, "events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EngagementEvent);
}

const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

describe("bridge calls in agentLoop", () => {
  it("an offered bridge call executes and its result is written to the event log", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-fleet-"));
    try {
      const client = fakeClient({ available: true });
      let asked = false;
      const model: CompleteFn = async (_role, messages) => {
        const texts = (messages as Array<{ content?: unknown }>).map((m) => (typeof m.content === "string" ? m.content : ""));
        if (texts.some((t) => t.includes("result of screenshot"))) return { text: "done", usage: USAGE };
        if (!asked) {
          asked = true;
          return { text: "", toolCalls: [{ id: "c-1", name: "bridge_screenshot", arguments: {} }], usage: USAGE };
        }
        return { text: "done", usage: USAGE };
      };
      const ctx = loopCtx(dir, model, client);
      const tools = await withBridgeTools(ctx, "recon", []);
      assert.ok(tools.some((t) => t.name === "bridge_screenshot"), "the gate offered the tool to the loop");
      await agentLoop(ctx, "recon", "recon", "s", "u", tools, 6, {});
      assert.deepEqual(client.calls, [{ name: "screenshot", args: {} }]);
      const logged = readEvents(dir).filter((e) => e.action === "bridge_screenshot");
      assert.equal(logged.length, 1, "the bridge call is in the engagement's event log");
      assert.match(logged[0]!.result, /result of screenshot/u);
      const active = readEvents(dir).filter((e) => e.action === "bridge_tools_active");
      assert.equal(active.length, 1, "the engagement recorded that bridge tools were active");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
