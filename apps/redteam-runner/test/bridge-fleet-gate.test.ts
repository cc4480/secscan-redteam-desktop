/**
 * Bridge tool offering gate (Q-BRIDGE-TOOLS, Builder B).
 *
 * The gate is the surface's security boundary: bridge_* tools are
 * offered ONLY when the engagement is a local-host engagement AND the
 * bridge answers on this machine. Otherwise they are absent from the
 * tool list entirely (the Seclayer-key doctrine) — remote engagements
 * never even probe the bridge, and a local engagement with no bridge
 * records exactly one honest event and proceeds without the tools.
 * Fakes only: the bridge client is injected, nothing touches a network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
import type { Ctx } from "../src/context.js";
import type { EngagementEvent } from "../src/types.js";
import { bridgeToolsForEngagement, withBridgeTools } from "../src/dispatch/bridge-gate.js";
import type { BridgeClientLike, BridgeToolInfo } from "../src/dispatch/bridge-client.js";

/** The allowlist A's client filters to (cdp_* ×10, job layer ×4, eyes ×2). */
const ALLOWLISTED_OPS = [
  "cdp_launch", "cdp_connect", "cdp_targets", "cdp_navigate", "cdp_snapshot",
  "cdp_click", "cdp_type", "cdp_evaluate", "cdp_readback", "cdp_close",
  "submit_job", "job_status", "job_result", "job_cancel",
  "screenshot", "uia_find",
] as const;

/** Ops the bridge offers that this surface must NEVER expose. */
const FORBIDDEN_OPS = [
  "shell_exec", "shell_pwsh", "input_type", "input_click", "fs_write", "fs_delete",
  "proc_kill", "power", "doctor", "exec_background",
];

function toolInfo(name: string): BridgeToolInfo {
  return {
    name,
    description: `bridge description for ${name}`,
    inputSchema: { type: "object", properties: { probe: { type: "string" } } },
  };
}

interface FakeClient extends BridgeClientLike {
  probes: number;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fakeClient(opts?: { available?: boolean; listError?: Error }): FakeClient {
  const state = { probes: 0, calls: [] as Array<{ name: string; args: Record<string, unknown> }> };
  return {
    probes: state.probes,
    calls: state.calls,
    async available() {
      state.probes++;
      return opts?.available ?? true;
    },
    async listTools() {
      if (opts?.listError) throw opts.listError;
      // The bridge offers its FULL registry (A's client does not filter);
      // the gate must offer only the allowlist out of it.
      return [...ALLOWLISTED_OPS, ...FORBIDDEN_OPS].map(toolInfo);
    },
    async call(name, args) {
      state.calls.push({ name, args });
      return `result of ${name}`;
    },
  };
}

const BASE: JsonSchemaTool[] = [{ name: "http_probe", description: "base tool", parameters: { type: "object" } }];

function gateCtx(localHost: boolean | undefined, events: EngagementEvent[]): Ctx {
  return {
    input: {
      target: "operator-pc",
      mode: "red",
      objective: "test the local machine",
      localHost,
      roe: { scope: ["operator-pc"], blackoutWindows: [] },
    },
    events: {
      dir: "/tmp/bridge-fleet-gate-no-dir",
      append: (e: EngagementEvent) => {
        events.push(e);
      },
    },
    deps: {},
  } as unknown as Ctx;
}

describe("bridge offering gate", () => {
  it("a remote engagement is offered nothing and the bridge is never probed", async () => {
    for (const localHost of [undefined, false]) {
      const events: EngagementEvent[] = [];
      const client = fakeClient({ available: true });
      const offered = await withBridgeTools(gateCtx(localHost, events), "recon", BASE, client);
      assert.deepEqual(offered.map((t) => t.name), ["http_probe"]);
      assert.equal(client.probes, 0, "remote engagements must not probe the bridge");
      assert.equal(events.length, 0, "no bridge event is recorded for a remote engagement");
    }
  });

  it("a local engagement with no bridge answering is offered nothing, with exactly one honest event", async () => {
    const events: EngagementEvent[] = [];
    const client = fakeClient({ available: false });
    const ctx = gateCtx(true, events);
    const offered = await withBridgeTools(ctx, "recon", BASE, client);
    assert.deepEqual(offered.map((t) => t.name), ["http_probe"]);
    // A second seam asking in the same engagement must not re-record.
    const again = await bridgeToolsForEngagement(ctx, "exploit", client);
    assert.deepEqual(again, []);
    const unavailable = events.filter((e) => e.action === "bridge_tools_unavailable");
    assert.equal(unavailable.length, 1);
    assert.match(unavailable[0]!.result, /did not answer/u);
    assert.match(unavailable[0]!.result, /proceeds without them/u);
  });

  it("a local engagement whose tools/list fails degrades to the same honest absence", async () => {
    const events: EngagementEvent[] = [];
    const client = fakeClient({ available: true, listError: new Error("initialize failed") });
    const offered = await withBridgeTools(gateCtx(true, events), "recon", BASE, client);
    assert.deepEqual(offered.map((t) => t.name), ["http_probe"]);
    assert.equal(events.filter((e) => e.action === "bridge_tools_unavailable").length, 1);
  });

  it("a local engagement with a live bridge is offered exactly the allowlist, prefixed and taught", async () => {
    const events: EngagementEvent[] = [];
    const client = fakeClient({ available: true });
    const offered = await withBridgeTools(gateCtx(true, events), "exploit", BASE, client);
    const bridgeTools = offered.filter((t) => t.name.startsWith("bridge_"));
    assert.deepEqual(
      bridgeTools.map((t) => t.name),
      ALLOWLISTED_OPS.map((op) => `bridge_${op}`),
    );
    for (const op of FORBIDDEN_OPS) {
      assert.ok(!offered.some((t) => t.name === `bridge_${op}`), `bridge_${op} must never be offered`);
    }
    assert.equal(events.length, 0, "no unavailable event when the gate opens");
    for (const t of bridgeTools) {
      assert.match(t.description, /OPERATOR'S OWN machine/u, `${t.name} carries the doctrine`);
      assert.match(t.description, /never a surface against remote targets/u);
      assert.deepEqual(t.parameters, toolInfo("x").inputSchema, `${t.name} forwards the bridge schema`);
    }
    const byName = new Map(bridgeTools.map((t) => [t.name, t.description]));
    assert.match(byName.get("bridge_cdp_type")!, /readback/u, "cdp teaching names the readback discipline");
    assert.match(byName.get("bridge_cdp_navigate")!, /second account/u, "cdp teaching names authenticated testing");
    assert.match(byName.get("bridge_submit_job")!, /job_status/u, "job teaching names the polling loop");
    assert.match(byName.get("bridge_screenshot")!, /actually on the operator's machine/u, "eyes teaching names verification");
  });
});
