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

/** The live bridge's full registry, ground-truthed by the supervisor
 * against ~/workspace/alterego @ 92ab12d: 63 ALL_TOOLS wire names + the
 * 4 job-layer ops = 67 tools. No cdp_* names — the live bridge does not
 * serve them today (supervisor note D-3); the gate passes through
 * whatever a bridge offers, so the fixture is the real list. */
const REGISTRY_OPS = [
  "active_window", "arbitrate", "batch", "browser_click", "browser_eval", "browser_fill",
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
 * — CDP_LAUNCH … CDP_CLOSE). The bridge-side fix (2026-10-31) registers
 * them in AlterEgo's server, taking the real registry to 77. The gate
 * passes through whatever a bridge offers, so a bridge offering all 77
 * must surface all 77 — with the CDP teaching text — proven below. */
const CDP_OPS = [
  "cdp_launch", "cdp_connect", "cdp_targets", "cdp_navigate", "cdp_snapshot",
  "cdp_click", "cdp_type", "cdp_evaluate", "cdp_readback", "cdp_close",
] as const;

/** The full registry once the bridge serves the CDP family: 67 + 10 = 77. */
const REGISTRY_OPS_77 = [...REGISTRY_OPS, ...CDP_OPS] as const;

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

function fakeClient(opts?: { available?: boolean; listError?: Error; ops?: readonly string[] }): FakeClient {
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
      return (opts?.ops ?? REGISTRY_OPS).map(toolInfo);
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
      assert.match(byName.get("bridge_shell_pwsh")!, /Direct control of the operator's own machine/u);
      assert.match(byName.get("bridge_power")!, /Direct control of the operator's own machine/u);
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
    assert.match(active[0]!.result, /full toolset \(67 tools\)/u);
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

describe("bridge offering gate — the CDP family (77-tool registry)", () => {
  it("a bridge offering all 77 surfaces all 77 in local and remote engagements alike", async () => {
    for (const localHost of [undefined, true]) {
      const events: EngagementEvent[] = [];
      const client = fakeClient({ available: true, ops: REGISTRY_OPS_77 });
      const offered = await withBridgeTools(gateCtx(localHost, events), "exploit", BASE, client);
      const bridgeTools = offered.filter((t) => t.name.startsWith("bridge_"));
      assert.deepEqual(
        bridgeTools.map((t) => t.name),
        REGISTRY_OPS_77.map((op) => `bridge_${op}`),
        `localHost=${String(localHost)}: the full 77 offered, unfiltered`,
      );
      const active = events.filter((e) => e.action === "bridge_tools_active");
      assert.equal(active.length, 1);
      assert.match(active[0]!.result, /full toolset \(77 tools\)/u);
    }
  });

  it("cdp_* tools carry the CDP teaching text; a 67-only offering carries none of it", async () => {
    const events77: EngagementEvent[] = [];
    const offered77 = await withBridgeTools(
      gateCtx(undefined, events77), "exploit", BASE, fakeClient({ available: true, ops: REGISTRY_OPS_77 }),
    );
    const byName = new Map(offered77.map((t) => [t.name, t.description]));
    for (const op of CDP_OPS) {
      const d = byName.get(`bridge_${op}`)!;
      assert.match(d, /Authenticated browser work in a real Chrome/u, `${op}: CDP teaching present`);
      assert.match(d, /OPERATOR'S OWN machine/u, `${op}: own-machine truth still carried`);
    }
    assert.match(byName.get("bridge_cdp_snapshot")!, /Address elements from cdp_snapshot output, never by coordinates/u);
    assert.match(byName.get("bridge_cdp_type")!, /verifies by readback/u);
    assert.doesNotMatch(byName.get("bridge_shell_exec")!, /Authenticated browser work/u, "non-CDP tools do not carry the CDP teaching");

    const events67: EngagementEvent[] = [];
    const offered67 = await withBridgeTools(
      gateCtx(undefined, events67), "exploit", BASE, fakeClient({ available: true }),
    );
    assert.equal(offered67.filter((t) => t.name.startsWith("bridge_cdp_")).length, 0, "no cdp tools in a 67-only offering");
    for (const t of offered67) {
      assert.doesNotMatch(t.description, /Authenticated browser work/u, `${t.name}: no CDP teaching when no cdp_* is offered`);
    }
  });
});
