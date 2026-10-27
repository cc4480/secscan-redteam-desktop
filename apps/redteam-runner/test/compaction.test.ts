/**
 * A3 Deep — context compaction + summary cache (PentAGI csum pattern).
 *
 * The benchmark block is the no-recall-loss gate in miniature: a history
 * planted with load-bearing facts is compacted by an extractive
 * summarizer (one that keeps fact lines, drops filler — the behavior the
 * production summarizer is instructed to have), and every planted fact
 * must survive in the compacted chain while the chain shrinks. Live
 * model recall is proven separately on the lab battery; this gate
 * proves the mechanism never drops what the summarizer returns, never
 * touches the preserved head/tail, and never re-summarizes a slice it
 * has already paid for.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChatMessage } from "@secscan/redteam-llm-router";
import { SummaryCache, summaryKey } from "../src/compaction/summary-cache.js";
import {
  compactMessages,
  estimateChars,
  SUMMARY_MARKER,
} from "../src/compaction/compact.js";
import { agentLoop } from "../src/agents.js";
import { EventLog } from "../src/events.js";
import { readSteps } from "../src/harness2/steps.js";
import type { Ctx } from "../src/context.js";
import type { EngagementPhase } from "../src/types.js";

/** Extractive fake: keeps FACT lines, drops filler — the instructed behavior. */
function extractiveSummarizer(counter: { calls: number }) {
  return async (sliceText: string): Promise<string> => {
    counter.calls++;
    return sliceText
      .split("\n")
      .filter((line) => line.includes("FACT:"))
      .join("\n");
  };
}

function history(pairs: number, fillerChars = 2_000): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: "SYSTEM" },
    { role: "user", content: "OBJECTIVE: pentest FACT: target is shop.example.test" },
  ];
  for (let i = 0; i < pairs; i++) {
    messages.push({ role: "assistant", content: `turn ${i} reasoning ${"x".repeat(fillerChars)}\nFACT: finding F-${i} status confirmed` });
    messages.push({ role: "user", content: `observation ${i} ${"y".repeat(fillerChars)}` });
  }
  return messages;
}

describe("summary cache", () => {
  it("keys are stable per slice and differ across slices", () => {
    assert.equal(summaryKey("abc"), summaryKey("abc"));
    assert.notEqual(summaryKey("abc"), summaryKey("abd"));
  });

  it("is an LRU capped at 100 entries with hit/miss accounting", () => {
    const cache = new SummaryCache();
    for (let i = 0; i < 101; i++) cache.set(`k${i}`, `v${i}`);
    assert.equal(cache.size, 100);
    assert.equal(cache.get("k0"), null); // evicted as least recently used
    assert.equal(cache.get("k100"), "v100");
    assert.equal(cache.hits, 1);
    assert.equal(cache.misses, 1);
  });
});

describe("compactMessages", () => {
  it("is a no-op under budget and never calls the summarizer", async () => {
    const counter = { calls: 0 };
    const messages = history(2, 100);
    const result = await compactMessages(messages, extractiveSummarizer(counter), { budgetChars: 100_000 });
    assert.equal(result, null);
    assert.equal(counter.calls, 0);
  });

  it("compacts the middle, preserving system, objective, and the raw tail", async () => {
    const counter = { calls: 0 };
    const messages = history(20);
    const before = estimateChars(messages);
    const result = await compactMessages(messages, extractiveSummarizer(counter), {
      budgetChars: 20_000,
      preserveLast: 4,
    });
    assert.ok(result);
    assert.ok(result.afterChars < before);
    assert.equal(messages[0]?.content, "SYSTEM");
    assert.match(messages[1]?.content ?? "", /OBJECTIVE/);
    const summary = messages.find((m) => m.content.startsWith(SUMMARY_MARKER));
    assert.ok(summary, "a summary message replaced the middle");
    // The last 4 raw messages survive verbatim at the tail.
    assert.match(messages[messages.length - 1]?.content ?? "", /observation 19/);
  });

  it("never re-summarizes an identical slice (cache hit on the second run)", async () => {
    const counter = { calls: 0 };
    const cache = new SummaryCache();
    const summarize = extractiveSummarizer(counter);
    await compactMessages(history(20), summarize, { budgetChars: 20_000, preserveLast: 4, cache });
    assert.equal(counter.calls, 1);
    const second = await compactMessages(history(20), summarize, { budgetChars: 20_000, preserveLast: 4, cache });
    assert.equal(counter.calls, 1);
    assert.ok(second && second.cacheHits >= 1);
  });
});

describe("benchmark — planted-fact recall through compaction", () => {
  it("retains every planted fact while shrinking the chain by at least half", async () => {
    const counter = { calls: 0 };
    const messages = history(12, 3_000);
    const before = estimateChars(messages);
    const facts: string[] = ["target is shop.example.test"];
    for (let i = 0; i < 12; i++) facts.push(`finding F-${i} status confirmed`);
    const result = await compactMessages(messages, extractiveSummarizer(counter), {
      budgetChars: 15_000,
      preserveLast: 2,
    });
    assert.ok(result);
    const chain = messages.map((m) => m.content).join("\n");
    for (const fact of facts) {
      assert.ok(chain.includes(fact), `recall lost: ${fact}`);
    }
    assert.ok(result.afterChars <= before / 2, `expected ≥50% shrink, got ${before} → ${result.afterChars}`);
  });
});

describe("agentLoop compaction seam", () => {
  let dir = "";
  const savedBudget = process.env["REDTEAM_COMPACTION_BUDGET_CHARS"];
  beforeEach(() => {
    dir = join(tmpdir(), `compaction-loop-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    process.env["REDTEAM_COMPACTION_BUDGET_CHARS"] = "12000";
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedBudget === undefined) delete process.env["REDTEAM_COMPACTION_BUDGET_CHARS"];
    else process.env["REDTEAM_COMPACTION_BUDGET_CHARS"] = savedBudget;
  });

  it("compacts an over-budget history mid-loop and journals the compacted prompt", async () => {
    let summarizerCalls = 0;
    let mainCalls = 0;
    const completeForRole = async (_role: unknown, messages: ChatMessage[]) => {
      const first = messages[0]?.content ?? "";
      if (first.includes("compaction summarizer")) {
        summarizerCalls++;
        const slice = messages[1]?.content ?? "";
        return { text: slice.split("\n").filter((l) => l.includes("FACT:")).join("\n") };
      }
      // Main call: keep the history growing with big, distinct filler turns.
      mainCalls++;
      return { text: `working turn ${mainCalls} ${"z".repeat(3_000)} FACT: still on target shop.example.test` };
    };
    const ctx = {
      actions: 0,
      consecutive5xx: 0,
      startedAt: Date.now(),
      config: { maxActions: 60, maxDurationMs: 60_000 },
      input: { roe: { blackoutWindows: [] } },
      deps: { completeForRole },
      events: new EventLog(dir, "eng-compact", { target: "shop.example.test", mode: "red", objective: "test" }),
      hostKill: { aborted: false, controllers: new Set<AbortController>() },
      safety: { killSwitchAborts: 0 },
    } as unknown as Ctx;
    await agentLoop(ctx, "recon", "recon" as EngagementPhase, "SYS", "OBJ", [], 6, {
      onIdle: () => "keep going",
    });
    assert.ok(summarizerCalls >= 1, "summarizer ran at least once");
    const prompts = readSteps(dir).filter((r) => r.role === "prompt");
    assert.ok(
      prompts.some((r) => r.content.includes(SUMMARY_MARKER)),
      "a journaled prompt carries the compacted-history summary (model-visible = logged)",
    );
  });
});
