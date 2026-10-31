/**
 * Bridge dispatch (Q-BRIDGE-TOOLS, Builder B).
 *
 * The handler re-checks the offering gate LIVE on every call: a
 * bridge_* call in a remote engagement is refused before any client
 * resolution, and a bridge that stops answering mid-engagement closes
 * the gate for the next call — including a re-dispatch through
 * dispatchTool, which treats bridge calls like any other dispatch
 * (no bypass, and gate denials are never tagged repairable). The
 * loop-level test proves the house invariant end to end: a bridge
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

const ALLOWLISTED_OPS = [
  "cdp_launch", "cdp_connect", "cdp_targets", "cdp_navigate", "cdp_snapshot",
  "cdp_click", "cdp_type", "cdp_evaluate", "cdp_readback", "cdp_close",
  "submit_job", "job_status", "job_result", "job_cancel",
  "screenshot", "uia_find",
] as const;

interface FakeClient extends BridgeClientLike {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  setAvailable(v: boolean): void;
}

function fakeClient(opts?: { available?: boolean; callError?: Error }): FakeClient {
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
      return ALLOWLISTED_OPS.map((name) => ({ name, description: `bridge description for ${name}`, inputSchema: { type: "object", properties: {} } }));
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

function handlerCtx(localHost: boolean | undefined): Ctx {
  return {
    input: { target: "operator-pc", mode: "red", objective: "test", localHost, roe: { scope: ["operator-pc"] } },
    events: { dir: "/tmp/bridge-fleet-dispatch-no-dir", append: () => {} },
    deps: {},
  } as unknown as Ctx;
}

describe("bridge handler — gate re-check and routing", () => {
  it("does not claim other families' tools", async () => {
    const client = fakeClient();
    const r = await handleBridgeTools(handlerCtx(true), "recon", "recon", call("http_probe"), {}, client);
    assert.equal(r, null);
    assert.equal(client.calls.length, 0);
  });

  it("refuses a bridge call in a remote engagement before touching the client", async () => {
    const client = fakeClient({ available: true });
    const r = await handleBridgeTools(handlerCtx(undefined), "exploiter", "exploit", call("bridge_cdp_navigate", { url: "http://127.0.0.1:3000" }), { url: "http://127.0.0.1:3000" }, client);
    assert.equal(r?.ok, false);
    assert.match(r?.result ?? "", /only inside a local-host engagement/u);
    assert.equal(r?.repairable, undefined, "a gate denial is never a repair candidate");
    assert.equal(client.calls.length, 0);
  });

  it("refuses when the bridge does not answer, and routes when it does", async () => {
    const down = fakeClient({ available: false });
    const refused = await handleBridgeTools(handlerCtx(true), "recon", "recon", call("bridge_screenshot"), {}, down);
    assert.equal(refused?.ok, false);
    assert.match(refused?.result ?? "", /not available on this machine/u);
    assert.equal(down.calls.length, 0);

    const up = fakeClient({ available: true });
    const args = { url: "http://127.0.0.1:3000/login" };
    const routed = await handleBridgeTools(handlerCtx(true), "exploiter", "exploit", call("bridge_cdp_navigate", args), args, up);
    assert.equal(routed?.ok, true);
    assert.equal(routed?.result, "result of cdp_navigate");
    assert.deepEqual(up.calls, [{ name: "cdp_navigate", args }], "the prefix is stripped and args forwarded unchanged");
  });

  it("routes every allowlisted op and relays allowlist and bridge failures as honest results", async () => {
    const client = fakeClient({ available: true });
    for (const op of ALLOWLISTED_OPS) {
      const r = await handleBridgeTools(handlerCtx(true), "recon", "recon", call(`bridge_${op}`), {}, client);
      assert.equal(r?.ok, true, `bridge_${op} routes`);
    }
    assert.equal(client.calls.length, ALLOWLISTED_OPS.length);

    const notAllowed = fakeClient({ callError: new BridgeCallError("not-allowlisted", "shell_exec is not in the allowlist") });
    const denied = await handleBridgeTools(handlerCtx(true), "recon", "recon", call("bridge_shell_exec"), {}, notAllowed);
    assert.equal(denied?.ok, false);
    assert.match(denied?.result ?? "", /not in the bridge allowlist/u);
    assert.equal(denied?.repairable, undefined);

    const broken = fakeClient({ callError: new BridgeCallError("bridge-error", "target crashed") });
    const failed = await handleBridgeTools(handlerCtx(true), "recon", "recon", call("bridge_cdp_snapshot"), {}, broken);
    assert.equal(failed?.ok, false);
    assert.equal(failed?.result, "bridge error: target crashed");

    const consent = fakeClient({ callError: new BridgeCallError("bridge-denied", "denied by local approval") });
    const deniedByOperator = await handleBridgeTools(handlerCtx(true), "recon", "recon", call("bridge_cdp_click"), {}, consent);
    assert.equal(deniedByOperator?.ok, false);
    assert.match(deniedByOperator?.result ?? "", /operator consent denied/u);
    assert.equal(deniedByOperator?.repairable, undefined);
  });

  it("the allowlist wrapper rejects a forbidden op locally — the raw client is never touched", async () => {
    const rawCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const raw = {
      async available() {
        return true;
      },
      async listTools(): Promise<BridgeToolInfo[]> {
        return [...ALLOWLISTED_OPS, "shell_exec", "fs_write", "power"].map((name) => ({ name, description: `d ${name}`, inputSchema: { type: "object", properties: {} } }));
      },
      async call(name: string, args: Record<string, unknown>) {
        rawCalls.push({ name, args });
        return { content: [{ type: "text", text: `raw result of ${name}` }], text: `raw result of ${name}` };
      },
    };
    const wrapped = wrapBridgeClient(raw);
    for (const forbidden of ["bridge_shell_exec", "bridge_fs_write", "bridge_power"]) {
      const r = await handleBridgeTools(handlerCtx(true), "exploiter", "exploit", call(forbidden, { command: "whoami" }), { command: "whoami" }, wrapped);
      assert.equal(r?.ok, false, `${forbidden} is refused`);
      assert.match(r?.result ?? "", /not in the bridge allowlist/u);
    }
    assert.equal(rawCalls.length, 0, "a forbidden op never reaches the bridge client");
    const listed = await wrapped.listTools();
    assert.deepEqual(listed.map((t) => t.name), [...ALLOWLISTED_OPS], "the wrapper filters the full registry to the allowlist");
    const ok = await handleBridgeTools(handlerCtx(true), "recon", "recon", call("bridge_uia_find", { name: "OK" }), { name: "OK" }, wrapped);
    assert.equal(ok?.ok, true);
    assert.equal(ok?.result, "raw result of uia_find", "A's {text} result shape is normalized to text");
  });
});

// ---------------------------------------------------------------------------
// dispatchTool level: the full wrapper, gate flipped between attempts
// ---------------------------------------------------------------------------

function dispatchCtx(client: BridgeClientLike): Ctx {
  return {
    actions: 0,
    input: { target: "operator-pc", mode: "red", objective: "test", localHost: true, roe: { scope: ["operator-pc"], blackoutWindows: [] } },
    hosts: ["operator-pc"],
    domain: "operator-pc",
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
    redirects: 0,
    startedAt: Date.now(),
    config: { maxActions: 100, maxDurationMs: 60_000 },
    input: {
      mode: "red",
      objective: "test",
      target: "operator-pc",
      localHost: true,
      roe: { blackoutWindows: [], scope: ["operator-pc"] },
    },
    deps: { completeForRole, bridgeClient: client },
    events: new EventLog(dir, "eng-bridge-fleet", { target: "operator-pc", mode: "red", objective: "test" }),
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    safety: {
      killSwitchAborts: 0,
      limiter: { acquire: async () => {} },
      autoHalt: { isHalted: () => false, haltReason: () => undefined, recordOutcome: () => undefined },
      rpsPerHost: 5,
    },
    tier: { current: 2, declared: 2, chainSteps: new Map<string, number>() },
    hosts: ["operator-pc"],
    domain: "operator-pc",
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
