/**
 * Bridge tool offering gate (Q-BRIDGE-TOOLS, Builder B — revised
 * design, Carlos's order 2026-10-31 ~18:00 CDT).
 *
 * The allowlist is removed and the localHost-only restriction is
 * lifted: the FULL bridge toolset is offered, and the one gate is
 * bridge availability. Bridge live on this machine → the full set is
 * offered in local AND remote engagements alike (the tools act on the
 * operator's own machine, which can be the launch point). Bridge down
 * or unpaired → the tools are absent entirely, in both. When the gate
 * opens, exactly one honest `bridge_tools_active` event is recorded
 * per engagement. Fakes only — nothing touches a network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";
import type { Ctx } from "../src/context.js";
import type { EngagementEvent } from "../src/types.js";
import { bridgeToolsForEngagement, withBridgeTools } from "../src/dispatch/bridge-gate.js";
import type { BridgeClientLike, BridgeToolInfo } from "../src/dispatch/bridge-client.js";

/** A representative slice of the bridge's full registry — browser, job,
 * eyes, AND the direct-control families (shell, files, input, power). */
const REGISTRY_OPS = [
  "cdp_launch", "cdp_connect", "cdp_targets", "cdp_navigate", "cdp_snapshot",
  "cdp_click", "cdp_type", "cdp_evaluate", "cdp_readback", "cdp_close",
  "submit_job", "job_status", "job_result", "job_cancel",
  "screenshot", "uia_find",
  "shell_exec", "shell_pwsh", "fs_read", "fs_write", "fs_delete",
  "input_type", "input_click", "list_windows", "proc_list", "power",
] as const;

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
      return REGISTRY_OPS.map(toolInfo);
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
      objective: "test",
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

describe("bridge offering gate — availability is the only gate", () => {
  it("a down bridge means no bridge tools in ANY engagement type, and no event", async () => {
    for (const localHost of [undefined, false, true]) {
      const events: EngagementEvent[] = [];
      const client = fakeClient({ available: false });
      const offered = await withBridgeTools(gateCtx(localHost, events), "recon", BASE, client);
      assert.deepEqual(offered.map((t) => t.name), ["http_probe"], `localHost=${String(localHost)}: nothing offered`);
      assert.equal(events.filter((e) => e.action === "bridge_tools_active").length, 0);
    }
  });

  it("a live bridge offers the FULL registry in local and remote engagements alike", async () => {
    for (const localHost of [undefined, true]) {
      const events: EngagementEvent[] = [];
      const client = fakeClient({ available: true });
      const offered = await withBridgeTools(gateCtx(localHost, events), "exploit", BASE, client);
      const bridgeTools = offered.filter((t) => t.name.startsWith("bridge_"));
      assert.deepEqual(
        bridgeTools.map((t) => t.name),
        REGISTRY_OPS.map((op) => `bridge_${op}`),
        `localHost=${String(localHost)}: every bridge tool offered, unfiltered`,
      );
      for (const t of bridgeTools) {
        assert.match(t.description, /OPERATOR'S OWN machine/u, `${t.name} teaches whose machine it is`);
        assert.match(t.description, /never an action against a remote target directly/u);
        assert.deepEqual(t.parameters, toolInfo("x").inputSchema, `${t.name} forwards the bridge schema`);
      }
      const byName = new Map(bridgeTools.map((t) => [t.name, t.description]));
      assert.match(byName.get("bridge_shell_exec")!, /Direct control of the operator's own machine/u);
      assert.match(byName.get("bridge_cdp_type")!, /readback/u, "cdp teaching names the readback discipline");
      assert.match(byName.get("bridge_submit_job")!, /job_status/u, "job teaching names the polling loop");
      assert.match(byName.get("bridge_screenshot")!, /actually on the operator's machine/u);
    }
  });

  it("exactly one bridge_tools_active event is recorded per engagement when the gate opens", async () => {
    const events: EngagementEvent[] = [];
    const client = fakeClient({ available: true });
    const ctx = gateCtx(undefined, events);
    await withBridgeTools(ctx, "recon", BASE, client);
    await withBridgeTools(ctx, "exploit", BASE, client);
    await bridgeToolsForEngagement(ctx, "exploit", client);
    const active = events.filter((e) => e.action === "bridge_tools_active");
    assert.equal(active.length, 1);
    assert.match(active[0]!.result, /full toolset/u);
    assert.match(active[0]!.result, /operator's OWN machine/u);
  });

  it("a live probe whose tools/list fails offers nothing and records no active event", async () => {
    const events: EngagementEvent[] = [];
    const client = fakeClient({ available: true, listError: new Error("initialize failed") });
    const offered = await withBridgeTools(gateCtx(true, events), "recon", BASE, client);
    assert.deepEqual(offered.map((t) => t.name), ["http_probe"]);
    assert.equal(events.filter((e) => e.action === "bridge_tools_active").length, 0);
  });
});
