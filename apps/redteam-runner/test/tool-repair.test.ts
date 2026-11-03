/**
 * Tool-call repair tests (runner corrections Item 6, 2026-10-31).
 *
 * A dispatch result tagged `repairable` (a typed field, never text
 * sniffing — the closed tag list lives on the handler returns) earns
 * its call ONE bounded repair exchange in agentLoop: a side-channel
 * completion naming the defect, the tool's schema, and the original
 * arguments. All gates re-run on the corrected call via dispatchTool.
 * Denials of policy (scope/tier/duplicate/verification) are never
 * tagged and never repaired. Fakes only: the prober is injected, the
 * model is scripted.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchTool } from "../src/dispatch/router.js";
import { duplicateRefusal, recordCallOutcome } from "../src/dispatch/duplicate-guard.js";
import { agentLoop } from "../src/agents.js";
import { EventLog } from "../src/events.js";
import type { Ctx } from "../src/context.js";
import type { EngagementEvent } from "../src/types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";

// ---------------------------------------------------------------------------
// Dispatch-level tagging
// ---------------------------------------------------------------------------

function dispatchCtx() {
  const probes: Array<{ url: string }> = [];
  const ctx = {
    input: { mode: "red", roe: { scope: ["shop.example.test"], blackoutWindows: [] }, fullBattery: false },
    hosts: ["shop.example.test"],
    domain: "shop.example.test",
    events: { dir: "/tmp/repair-test-no-such-dir", append: () => {} },
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
    prober: {
      probe: async (req: { url: string }) => {
        probes.push(req);
        return { status: 200, ms: 1, bodySnippet: "ok" };
      },
    },
  } as unknown as Ctx;
  return { ctx, probes };
}

const call = (name: string, args: Record<string, unknown>): ToolCallRequest =>
  ({ name, arguments: args }) as unknown as ToolCallRequest;

describe("repair tagging — the closed list", () => {
  it("an unknown-tool result carries the defect in `repairable`", async () => {
    const { ctx } = dispatchCtx();
    const r = await dispatchTool(ctx, "recon", "recon", call("http_probbe", { url: "https://shop.example.test/" }));
    assert.match(r.result, /DENIED: unknown tool/);
    assert.equal(r.repairable, 'unknown tool "http_probbe"');
  });

  it("an unparseable-URL result is tagged; a scope denial is NOT tagged and no probe is sent", async () => {
    const { ctx, probes } = dispatchCtx();
    const bad = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "not a url" }));
    assert.match(bad.result, /unparseable URL/);
    assert.ok(bad.repairable?.includes("unparseable URL"));

    const scoped = await dispatchTool(ctx, "recon", "recon", call("http_probe", { url: "https://evil.example/" }));
    assert.match(scoped.result, /DENIED by scope/);
    assert.equal(scoped.repairable, undefined);
    assert.equal(probes.length, 0);
  });

  it("duplicate refusals (exact and near) never carry the tag", () => {
    const { ctx } = dispatchCtx();
    const c = call("http_probe", { url: "http://shop.example.test/admin" });
    recordCallOutcome(ctx, "recon", "recon", c, "shop.example.test", { result: "200 OK", ok: true });
    const refusal = duplicateRefusal(ctx, "recon", "recon", c, "shop.example.test");
    assert.ok(refusal);
    assert.equal(refusal.repairable, undefined);
  });
});

// ---------------------------------------------------------------------------
// Loop-level repair (scripted model, real event log — reflector-test shape)
// ---------------------------------------------------------------------------

type CompleteFn = (role: string, messages: unknown, opts: unknown) => Promise<unknown>;

function loopCtx(dir: string, completeForRole: CompleteFn): { ctx: Ctx; probes: Array<{ url: string }> } {
  const probes: Array<{ url: string }> = [];
  const ctx = {
    actions: 0,
    consecutive5xx: 0,
    deniedStreak: 0,
    redirects: { 'plan→recon': 0, 'recon→exploit': 0, 'exploit→report': 0 },
    wallRedirects: 0,
    startedAt: Date.now(),
    config: { maxActions: 1000, maxDurationMs: 60_000 },
    input: {
      mode: "red",
      objective: "test",
      target: "shop.example.test",
      roe: { blackoutWindows: [], scope: ["shop.example.test"] },
    },
    deps: { completeForRole },
    events: new EventLog(dir, "eng-repair", { target: "shop.example.test", mode: "red", objective: "test" }),
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
    prober: {
      probe: async (req: { url: string }) => {
        probes.push(req);
        return { status: 200, ms: 1, bodySnippet: "ok" };
      },
    },
  } as unknown as Ctx;
  return { ctx, probes };
}

function readEvents(dir: string): EngagementEvent[] {
  return readFileSync(join(dir, "events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EngagementEvent);
}

const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const idleTurn = { text: "done", usage: USAGE };

function toolTurn(name: string, args: Record<string, unknown>) {
  return { text: "", toolCalls: [{ id: `c-${Date.now()}-${Math.random()}`, name, arguments: args }], usage: USAGE };
}

function messageTexts(messages: unknown): string[] {
  return (messages as Array<{ content?: unknown }>).map((m) => (typeof m.content === "string" ? m.content : ""));
}

function isRepairAsk(messages: unknown): boolean {
  return messageTexts(messages).some((t) => t.startsWith("TOOL-CALL REPAIR"));
}

describe("tool-call repair in agentLoop", () => {
  it("a repairable result triggers exactly one repair exchange; the corrected result is the observation the model sees", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repair-ok-"));
    try {
      let repairs = 0;
      let sawCorrectedObservation = false;
      const model: CompleteFn = async (_role, messages) => {
        if (isRepairAsk(messages)) {
          repairs++;
          return toolTurn("http_probe", { url: "https://shop.example.test/" });
        }
        const texts = messageTexts(messages);
        if (texts.some((t) => t.startsWith("HTTP 200"))) sawCorrectedObservation = true;
        if (sawCorrectedObservation) return idleTurn;
        return toolTurn("http_probe", { url: "not a url" });
      };
      const { ctx, probes } = loopCtx(dir, model);
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 6, {});
      assert.equal(repairs, 1, "exactly one repair exchange");
      assert.equal(probes.length, 1, "the corrected call executed through dispatch");
      assert.ok(sawCorrectedObservation, "the model worked from the corrected result, not the DENIED original");
      const repairsLogged = readEvents(dir).filter((e) => e.action === "tool_repair");
      assert.equal(repairsLogged.length, 1);
      assert.match(repairsLogged[0]!.result, /outcome=repaired/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unknown tool is repaired to the tool the model meant (name may change only in this class)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repair-typo-"));
    try {
      let repairs = 0;
      const model: CompleteFn = async (_role, messages) => {
        if (isRepairAsk(messages)) {
          repairs++;
          return toolTurn("http_probe", { url: "https://shop.example.test/" });
        }
        if (messageTexts(messages).some((t) => t.startsWith("HTTP 200"))) return idleTurn;
        return toolTurn("http_probbe", { url: "https://shop.example.test/" });
      };
      const { ctx, probes } = loopCtx(dir, model);
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 6, {});
      assert.equal(repairs, 1);
      assert.equal(probes.length, 1, "the meant tool executed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the budget is spent per loop: with the default cap of 3, a 4th repairable result passes through unrepaired", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repair-cap-"));
    try {
      let repairs = 0;
      let batch = 0;
      const model: CompleteFn = async (_role, messages) => {
        if (isRepairAsk(messages)) {
          repairs++;
          // A "correction" that is itself malformed: repair fails, original stands.
          return toolTurn("http_probe", { url: "still not a url" });
        }
        batch++;
        if (batch === 1) {
          return {
            text: "",
            toolCalls: [1, 2, 3, 4].map((i) => ({ id: `b-${i}`, name: "http_probe", arguments: { url: "not a url" } })),
            usage: USAGE,
          };
        }
        return idleTurn;
      };
      const { ctx } = loopCtx(dir, model);
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 6, {});
      assert.equal(repairs, 3, "three repairs spent, the fourth result left as-is");
      assert.equal(readEvents(dir).filter((e) => e.action === "tool_repair").length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("repairCap: 0 disables repair entirely", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repair-off-"));
    try {
      const model: CompleteFn = async (_role, messages) => {
        if (isRepairAsk(messages)) throw new Error("repair must not be attempted when disabled");
        return toolTurn("http_probe", { url: "not a url" });
      };
      const { ctx } = loopCtx(dir, model);
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 3, { repairCap: 0 });
      assert.equal(readEvents(dir).some((e) => e.action === "tool_repair"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a corrected call that leaves the scope is refused by the scope gate: no probe sent, original result stands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repair-scope-"));
    try {
      let sawOriginalAfterRepair = false;
      const model: CompleteFn = async (_role, messages) => {
        if (isRepairAsk(messages)) {
          return toolTurn("http_probe", { url: "https://evil.example/" });
        }
        const texts = messageTexts(messages);
        if (texts.some((t) => t.includes("unparseable URL"))) sawOriginalAfterRepair = true;
        if (sawOriginalAfterRepair) return idleTurn;
        return toolTurn("http_probe", { url: "not a url" });
      };
      const { ctx, probes } = loopCtx(dir, model);
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 6, {});
      assert.equal(probes.length, 0, "the out-of-scope corrected call never reached a handler");
      const logged = readEvents(dir).filter((e) => e.action === "tool_repair");
      assert.equal(logged.length, 1);
      assert.match(logged[0]!.result, /outcome=failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a malformed correction (no tool call) leaves the original result standing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repair-badfix-"));
    try {
      let repairs = 0;
      const model: CompleteFn = async (_role, messages) => {
        if (isRepairAsk(messages)) {
          repairs++;
          return { text: "sorry, here is prose instead of a call", usage: USAGE };
        }
        return toolTurn("http_probe", { url: "not a url" });
      };
      const { ctx, probes } = loopCtx(dir, model);
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 3, {});
      assert.equal(repairs, 1);
      assert.equal(probes.length, 0);
      const logged = readEvents(dir).filter((e) => e.action === "tool_repair");
      assert.equal(logged.length, 1);
      assert.match(logged[0]!.result, /outcome=no-correction/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
