/**
 * Runner integrity (2026-10-23): progress-aware round caps + deliverable
 * contracts in agentLoop, ported from ZimZilla's agent loop.
 *
 * The integrity property under test: a turn stopped for being stuck (soft
 * cap) or for running away (hard cap) is NEVER indistinguishable from a
 * completed turn in events.jsonl, and a turn with a declared deliverable is
 * not done until the file exists — with the outcome stated as a fact read
 * off the disk in a final `deliverable` event.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../src/agents.js";
import { EventLog } from "../src/events.js";
import type { Ctx } from "../src/context.js";
import type { EngagementEvent } from "../src/types.js";

type CompleteFn = (role: string, messages: unknown, opts: unknown) => Promise<unknown>;

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Minimal ctx in the harness2-trajectory loopCtx shape, extended with the
 *  fields a bookkeeping dispatch (update_target_map) needs. */
function loopCtx(dir: string, completeForRole: CompleteFn): Ctx {
  return {
    actions: 0,
    consecutive5xx: 0,
    deniedStreak: 0,
    redirects: 0,
    startedAt: Date.now(),
    config: { maxActions: 1000, maxDurationMs: 60_000 },
    input: { roe: { blackoutWindows: [], scope: ["shop.example.test"] } },
    deps: { completeForRole },
    events: new EventLog(dir, "eng-integrity", { target: "shop.example.test", mode: "red", objective: "test" }),
    hostKill: { aborted: false, controllers: new Set<AbortController>() },
    safety: { killSwitchAborts: 0 },
    tier: { current: 0, chainSteps: new Map<string, number>() },
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
  } as unknown as Ctx;
}

function readEvents(dir: string): EngagementEvent[] {
  return readFileSync(join(dir, "events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EngagementEvent);
}

const toolTurn = (name: string, args: Record<string, unknown> = {}) => ({
  text: "",
  toolCalls: [{ id: `c-${Math.random()}`, name, arguments: args }],
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});
const idleTurn = { text: "done", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };

/** Scripted model: returns the given responses in order, then idles. */
function scripted(responses: unknown[]): CompleteFn {
  let i = 0;
  return async () => responses[i++] ?? idleTurn;
}

describe("progress-aware round caps", () => {
  it("soft cap CONTINUES when the previous round made progress, and the turn can still finish", async () => {
    const dir = tempDir("ri-soft-cont-");
    try {
      const ctx = loopCtx(
        dir,
        scripted([
          toolTurn("update_target_map", { entries: [{ area: "/a", method: "GET" }] }),
          toolTurn("update_target_map", { entries: [{ area: "/b", method: "GET" }] }),
          toolTurn("update_target_map", { entries: [{ area: "/c", method: "GET" }] }),
          idleTurn,
        ]),
      );
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 10, { roundCaps: { softCapRounds: 2 } });
      const evs = readEvents(dir);
      const cont = evs.filter((e) => e.action === "continuing");
      assert.equal(cont.length, 1, "one soft-cap checkpoint passed with progress");
      assert.match(cont[0]!.result, /continuing/);
      assert.equal(evs.some((e) => e.action === "iteration_cap"), false, "no cap stop on a progressing turn");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("soft cap STOPS a stuck turn (every tool in the round failed) and marks it capped, not completed", async () => {
    const dir = tempDir("ri-soft-stop-");
    try {
      // Unknown tools come back DENIED — a round of nothing but failures.
      const ctx = loopCtx(
        dir,
        scripted([toolTurn("no_such_tool"), toolTurn("no_such_tool"), toolTurn("no_such_tool"), toolTurn("no_such_tool")]),
      );
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 10, { roundCaps: { softCapRounds: 2 } });
      const evs = readEvents(dir);
      const caps = evs.filter((e) => e.action === "iteration_cap");
      assert.equal(caps.length, 1);
      assert.match(caps[0]!.result, /\(soft\)/);
      assert.match(caps[0]!.result, /CAPPED, not completed/);
      assert.equal(evs.some((e) => e.action === "continuing"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hard cap stops a runaway turn and announces iteration_cap (hard)", async () => {
    const dir = tempDir("ri-hard-");
    try {
      const ctx = loopCtx(
        dir,
        scripted([
          toolTurn("update_target_map", { entries: [{ area: "/a", method: "GET" }] }),
          toolTurn("update_target_map", { entries: [{ area: "/b", method: "GET" }] }),
          toolTurn("update_target_map", { entries: [{ area: "/c", method: "GET" }] }),
          toolTurn("update_target_map", { entries: [{ area: "/d", method: "GET" }] }),
          toolTurn("update_target_map", { entries: [{ area: "/e", method: "GET" }] }),
        ]),
      );
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 10, { roundCaps: { softCapRounds: 100, hardCapRounds: 3 } });
      const evs = readEvents(dir);
      const caps = evs.filter((e) => e.action === "iteration_cap");
      assert.equal(caps.length, 1);
      assert.match(caps[0]!.result, /\(hard\)/);
      assert.match(caps[0]!.result, /CAPPED, not completed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exhausting maxTurns with the model still working is announced as a hard cap, never silent", async () => {
    const dir = tempDir("ri-exhaust-");
    try {
      const ctx = loopCtx(
        dir,
        scripted([
          toolTurn("update_target_map", { entries: [{ area: "/a", method: "GET" }] }),
          toolTurn("update_target_map", { entries: [{ area: "/b", method: "GET" }] }),
        ]),
      );
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 2, {});
      const caps = readEvents(dir).filter((e) => e.action === "iteration_cap");
      assert.equal(caps.length, 1);
      assert.match(caps[0]!.result, /\(hard\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a turn that finishes normally emits neither continuing nor iteration_cap", async () => {
    const dir = tempDir("ri-clean-");
    try {
      const ctx = loopCtx(dir, scripted([idleTurn]));
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 5, {});
      const evs = readEvents(dir);
      assert.equal(evs.some((e) => e.action === "iteration_cap" || e.action === "continuing"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("deliverable contracts", () => {
  it("file already written when the model stops: deliverable event written:true, no nudges", async () => {
    const dir = tempDir("ri-deliv-ok-");
    try {
      const path = join(dir, "report.md");
      writeFileSync(path, "# report\n");
      const ctx = loopCtx(dir, scripted([idleTurn]));
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 5, { deliverable: { path } });
      const evs = readEvents(dir);
      const d = evs.filter((e) => e.action === "deliverable");
      assert.equal(d.length, 1);
      assert.deepEqual(JSON.parse(d[0]!.result), { path, written: true, nudges: 0 });
      assert.equal(evs.some((e) => e.action === "deliverable_nudge"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("model narrates instead of writing: nudged, then writes, deliverable written:true with nudges counted", async () => {
    const dir = tempDir("ri-deliv-nudge-");
    try {
      const path = join(dir, "report.md");
      let calls = 0;
      const model: CompleteFn = async (_role, messages) => {
        calls++;
        if (calls === 1) return idleTurn; // stops without writing
        // Second call must carry the nudge; the "model" now writes the file.
        const msgs = messages as Array<{ role: string; content: string }>;
        const last = msgs[msgs.length - 1]!;
        assert.equal(last.role, "user");
        assert.match(last.content, /You stopped before writing report\.md/);
        writeFileSync(path, "# report\n");
        return idleTurn;
      };
      const ctx = loopCtx(dir, model);
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 5, { deliverable: { path } });
      const evs = readEvents(dir);
      assert.equal(evs.filter((e) => e.action === "deliverable_nudge").length, 1);
      const d = evs.filter((e) => e.action === "deliverable");
      assert.equal(d.length, 1);
      assert.deepEqual(JSON.parse(d[0]!.result), { path, written: true, nudges: 1 });
      assert.ok(existsSync(path));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("nudges exhausted and the file never appears: deliverable event written:false", async () => {
    const dir = tempDir("ri-deliv-miss-");
    try {
      const path = join(dir, "report.md");
      const ctx = loopCtx(dir, scripted([idleTurn, idleTurn, idleTurn, idleTurn]));
      await agentLoop(ctx, "recon", "recon", "s", "u", [], 10, { deliverable: { path, maxNudges: 2 } });
      const evs = readEvents(dir);
      assert.equal(evs.filter((e) => e.action === "deliverable_nudge").length, 2, "exactly maxNudges nudges");
      const d = evs.filter((e) => e.action === "deliverable");
      assert.equal(d.length, 1);
      assert.deepEqual(JSON.parse(d[0]!.result), { path, written: false, nudges: 2 });
      assert.equal(existsSync(path), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
