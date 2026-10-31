/**
 * H2-P1: trajectory + metrics + section-5 full-text step capture.
 *
 * Covers: harness stamp shape (version, pinned guardrails, real component
 * hashes, layer override), the outcome mapping for success/partial/failure/
 * aborted, the targetClass rule, metered token capture, atomic + newer-wins
 * trajectory.json/metrics.json/run.json writes, event normalization, the
 * finish-path wiring helper being a guarded no-op on error, the full-text
 * steps.jsonl journal (roles, tool_name, per-response tokens, untruncated
 * content, redaction), the agentLoop instrumentation, and the documented
 * section-5 runs/metrics row + failure_mode rules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentLoop } from "../src/agents.js";
import { EventLog } from "../src/events.js";
import { EDITABLE_COMPONENTS, PINNED_COMPONENT, type RunMetrics, type TrajectoryRecord } from "../src/harness2/contract.js";
import {
  countStepErrors,
  createStepJournal,
  readSteps,
  responseTokens,
  stepJournalFor,
  stepsPath,
  sumStepTokens,
  TOOL_ERROR_PREFIX,
  type StepRecord,
} from "../src/harness2/steps.js";
import {
  SPEC5_FILE_NAME,
  buildSpec5Rows,
  deriveFailureMode,
  deriveTargetSubclass,
  isCrashed,
  type Spec5RunFacts,
} from "../src/harness2/spec5.js";
import {
  TOKEN_CAPTURE_STATUS,
  ZERO_TOKEN_TOTALS,
  buildHarnessStamp,
  captureEngagementTrajectory,
  captureRunMetrics,
  createTokenMeter,
  deriveOutcome,
  deriveTargetClass,
  isToolAction,
  toTrajectoryEvents,
  writeTrajectory,
} from "../src/harness2/trajectory.js";
import type { Ctx } from "../src/context.js";
import type { EngagementEvent, Finding } from "../src/types.js";

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8"),
) as { version: string };
const HEX64 = /^[0-9a-f]{64}$/;

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function confirmedFinding(): Finding {
  return {
    id: "F-1",
    severity: "high",
    title: "Reflected XSS in search",
    attackIds: ["T1190"],
    evidence: "payload reflected unencoded",
    fix: "encode",
    retest: "curl",
    status: "confirmed",
  };
}

function sampleMetrics(finishedAt: string): TrajectoryRecord["metrics"] {
  return captureRunMetrics({
    engagementId: "eng-1",
    target: "https://shop.example.test:443/path",
    status: "complete",
    vulnsFound: 1,
    falsePositives: 0,
    exploitsAttempted: 2,
    exploitsSucceeded: 1,
    steps: 3,
    startedAtMs: Date.parse("2026-10-18T00:00:00.000Z"),
    finishedAtMs: Date.parse(finishedAt),
    harness: { runnerVersion: "test", layerIds: [], componentHashes: {} },
  });
}

describe("buildHarnessStamp", () => {
  it("stamps the runner version, pinned guardrails and sha256 component hashes", () => {
    const stamp = buildHarnessStamp({ environment: {} });
    assert.equal(stamp.runnerVersion, packageJson.version);
    assert.deepEqual(stamp.layerIds, []);
    assert.deepEqual(stamp.pinnedComponents, [PINNED_COMPONENT]);
    assert.equal(EDITABLE_COMPONENTS.includes(PINNED_COMPONENT), false);
    const guardrails = stamp.componentHashes[PINNED_COMPONENT];
    assert.equal(typeof guardrails, "string");
    assert.match(guardrails!, HEX64);
    // The checkout has src/ so the documented component sets must resolve.
    for (const component of ["system-prompt", "subagents", "skills", "plugins"] as const) {
      assert.match(stamp.componentHashes[component] ?? "", HEX64, `missing hash for ${component}`);
    }
    assert.deepEqual(buildHarnessStamp({ environment: {} }), stamp, "stamp must be deterministic");
  });

  it("takes layer ids from DSH_HARNESS2_LAYERS, with an explicit override winning", () => {
    const fromEnv = buildHarnessStamp({ environment: { DSH_HARNESS2_LAYERS: " a, ,b " } });
    assert.deepEqual(fromEnv.layerIds, ["a", "b"]);
    const override = buildHarnessStamp({ environment: { DSH_HARNESS2_LAYERS: "a,b" }, layerIds: ["c"] });
    assert.deepEqual(override.layerIds, ["c"]);
  });

  it("reads the commit from the environment when one is supplied", () => {
    const stamp = buildHarnessStamp({ environment: { GIT_COMMIT: "deadbeef1234" } });
    assert.equal(stamp.commit, "deadbeef1234");
  });
});

describe("outcome and targetClass rules", () => {
  it("maps a completed run with evidence to success and a clean completion to partial", () => {
    assert.equal(deriveOutcome({ status: "complete", vulnsFound: 2, exploitsSucceeded: 2 }), "success");
    assert.equal(deriveOutcome({ status: "complete", vulnsFound: 0, exploitsSucceeded: 0 }), "partial");
  });

  it("maps halts, blocks and the kill switch mechanically", () => {
    assert.equal(deriveOutcome({ status: "halted", vulnsFound: 0, exploitsSucceeded: 0 }), "failure");
    assert.equal(deriveOutcome({ status: "halted", vulnsFound: 1, exploitsSucceeded: 1 }), "partial");
    assert.equal(deriveOutcome({ status: "blocked", vulnsFound: 0, exploitsSucceeded: 0 }), "failure");
    assert.equal(
      deriveOutcome({ status: "halted", blockedReason: "aborted by operator (kill switch)", vulnsFound: 1, exploitsSucceeded: 1 }),
      "aborted",
    );
    assert.equal(deriveOutcome({ status: "complete", aborted: true, vulnsFound: 1, exploitsSucceeded: 1 }), "aborted");
  });

  it("derives targetClass from appType, then target families, then the host", () => {
    assert.equal(deriveTargetClass({ target: "shop.example.test", appType: "WordPress" }), "wordpress");
    assert.equal(deriveTargetClass({ target: "shop.example.test", appType: "unknown", targetIds: ["windows"] }), "windows");
    assert.equal(
      deriveTargetClass({ target: "shop.example.test", appType: "unknown", targetIds: ["secscan", "seclayer"] }),
      "seclayer+secscan",
    );
    assert.equal(deriveTargetClass({ target: "https://user@Shop.Example.Test:8443/x?q=1" }), "shop.example.test");
    assert.equal(deriveTargetClass({ target: "10.1.2.3" }), "host");
    assert.equal(deriveTargetClass({ target: "   " }), "unknown");
  });
});

describe("captureRunMetrics", () => {
  it("maps every contract field for a successful run", () => {
    const metrics = captureRunMetrics({
      engagementId: "eng-42",
      target: "https://shop.example.test",
      status: "complete",
      vulnsFound: 3,
      falsePositives: 2,
      exploitsAttempted: 5,
      exploitsSucceeded: 3,
      steps: 11,
      tokensIn: 1200,
      tokensOut: 340,
      startedAtMs: Date.parse("2026-10-18T00:00:00.000Z"),
      finishedAtMs: Date.parse("2026-10-18T00:00:02.500Z"),
      harness: { runnerVersion: "0.0.0", layerIds: [], componentHashes: {} },
    });
    assert.equal(metrics.runId, "eng-42");
    assert.equal(metrics.engagementId, "eng-42");
    assert.equal(metrics.outcome, "success");
    assert.equal(metrics.vulnsFound, 3);
    assert.equal(metrics.falsePositives, 2);
    assert.equal(metrics.exploitsSucceeded, 3);
    assert.equal(metrics.exploitsAttempted, 5);
    assert.equal(metrics.steps, 11);
    assert.equal(metrics.tokensIn, 1200);
    assert.equal(metrics.tokensOut, 340);
    assert.equal(metrics.durationMs, 2500);
    assert.equal(metrics.targetClass, "shop.example.test");
    assert.equal(metrics.startedAt, "2026-10-18T00:00:00.000Z");
    assert.equal(metrics.finishedAt, "2026-10-18T00:00:02.500Z");
  });

  it("records explicit 0 tokens when no real totals are supplied (never estimates)", () => {
    const metrics = captureRunMetrics({
      engagementId: "eng-1",
      target: "shop.example.test",
      status: "halted",
      vulnsFound: 0,
      falsePositives: 0,
      exploitsAttempted: 0,
      exploitsSucceeded: 0,
      steps: 0,
    });
    assert.equal(metrics.outcome, "failure");
    assert.equal(metrics.tokensIn, ZERO_TOKEN_TOTALS.tokensIn);
    assert.equal(metrics.tokensOut, ZERO_TOKEN_TOTALS.tokensOut);
    assert.equal(ZERO_TOKEN_TOTALS.responses, 0);
    assert.match(TOKEN_CAPTURE_STATUS, /ChatResult\.usage/);
    assert.match(TOKEN_CAPTURE_STATUS, /agentLoop/);
    assert.equal(metrics.exploitsAttempted, 0);
  });

  it("sums real provider usage when a token meter is installed", () => {
    const meter = createTokenMeter();
    meter.record({ promptTokens: 100, completionTokens: 20 });
    meter.record(undefined);
    meter.record({ promptTokens: 50, completionTokens: 5, totalTokens: 55 });
    assert.deepEqual(meter.totals, { tokensIn: 150, tokensOut: 25, responses: 2 });
    const metrics = captureRunMetrics({
      engagementId: "eng-2",
      target: "shop.example.test",
      status: "complete",
      vulnsFound: 1,
      falsePositives: 0,
      exploitsAttempted: 1,
      exploitsSucceeded: 1,
      steps: 1,
      tokensIn: meter.totals.tokensIn,
      tokensOut: meter.totals.tokensOut,
    });
    assert.equal(metrics.tokensIn, 150);
    assert.equal(metrics.tokensOut, 25);
  });
});

describe("toTrajectoryEvents", () => {
  it("normalizes events and flags tool dispatches", () => {
    const events: EngagementEvent[] = [
      { ts: "t1", seq: 1, engagementId: "e", phase: "authorize", actor: "runner", action: "engagement_start", result: "started" },
      { ts: "t2", seq: 2, engagementId: "e", phase: "recon", actor: "recon", action: "reasoning", result: "thinking" },
      {
        ts: "t3",
        seq: 3,
        engagementId: "e",
        phase: "exploit",
        actor: "exploiter",
        action: "http_probe",
        attackId: "T1190",
        target: "shop.example.test",
        result: "200 OK",
      },
      { ts: "t4", seq: 4, engagementId: "e", phase: "exploit", actor: "exploiter", action: "record_finding", result: "recorded" },
    ];
    const normalized = toTrajectoryEvents(events);
    assert.equal(normalized.length, 4);
    assert.deepEqual(normalized[0], {
      ts: "t1",
      phase: "authorize",
      actor: "runner",
      action: "engagement_start",
      result: "started",
      isToolCall: false,
    });
    assert.equal(normalized[1]!.isToolCall, false);
    assert.equal(normalized[2]!.isToolCall, true);
    assert.equal(normalized[2]!.attackId, "T1190");
    assert.equal(normalized[2]!.target, "shop.example.test");
    assert.equal(normalized[3]!.isToolCall, true);
  });

  it("recognizes the tool families and bookkeeping tools, not lifecycle actions", () => {
    for (const action of ["http_probe", "nmap_exec", "scan_url", "ad_enum", "record_finding", "query_registry"]) {
      assert.equal(isToolAction(action), true, action);
    }
    for (const action of ["reasoning", "engagement_start", "phase_nudge", "halt"]) {
      assert.equal(isToolAction(action), false, action);
    }
    assert.equal(isToolAction("anything", "T1046"), true);
  });
});

describe("writeTrajectory", () => {
  it("writes trajectory.json and metrics.json atomically", () => {
    const dir = tempDir("h2-trajectory-");
    const record: TrajectoryRecord = {
      metrics: sampleMetrics("2026-10-18T00:00:05.000Z"),
      events: [{ ts: "t", phase: "recon", actor: "runner", action: "engagement_start", result: "ok", isToolCall: false }],
    };
    const result = writeTrajectory(dir, record);
    assert.equal(result.written, true);
    const trajectory = JSON.parse(readFileSync(join(dir, "trajectory.json"), "utf8")) as TrajectoryRecord;
    assert.equal(trajectory.metrics.runId, "eng-1");
    assert.equal(trajectory.events.length, 1);
    const metrics = JSON.parse(readFileSync(join(dir, "metrics.json"), "utf8")) as { runId: string; finishedAt: string };
    assert.equal(metrics.runId, "eng-1");
    assert.equal(metrics.finishedAt, "2026-10-18T00:00:05.000Z");
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.includes(".tmp-")),
      [],
      "no temp files may survive an atomic write",
    );
  });

  it("never overwrites a newer record", () => {
    const dir = tempDir("h2-trajectory-newer-");
    writeTrajectory(dir, { metrics: sampleMetrics("2026-10-18T00:00:09.000Z"), events: [] });
    const stale = writeTrajectory(dir, { metrics: sampleMetrics("2026-10-18T00:00:01.000Z"), events: [] });
    assert.equal(stale.written, false);
    assert.equal(stale.reason, "existing record is newer");
    const kept = JSON.parse(readFileSync(join(dir, "metrics.json"), "utf8")) as { finishedAt: string };
    assert.equal(kept.finishedAt, "2026-10-18T00:00:09.000Z");
    const fresh = writeTrajectory(dir, { metrics: sampleMetrics("2026-10-18T00:00:10.000Z"), events: [] });
    assert.equal(fresh.written, true);
  });

  it("reports an I/O failure instead of throwing", () => {
    const blocker = join(tempDir("h2-trajectory-blocker-"), "not-a-dir");
    writeFileSync(blocker, "x");
    const result = writeTrajectory(join(blocker, "engagement"), { metrics: sampleMetrics("2026-10-18T00:00:05.000Z"), events: [] });
    assert.equal(result.written, false);
    assert.equal(typeof result.reason, "string");
  });
});

describe("captureEngagementTrajectory finish-path wiring", () => {
  function fakeCtx(overrides: { actions?: number; aborted?: boolean } = {}): Ctx {
    return {
      fingerprint: { host: "shop.example.test", stack: [], appType: "wordpress" },
      itemLedger: new Map(),
      hostKill: { aborted: overrides.aborted ?? false, controllers: new Set() },
      safety: { killSwitchAborts: overrides.aborted === true ? 1 : 0 },
      actions: overrides.actions ?? 2,
      startedAt: Date.now() - 1000,
      liveFindings: [],
      killedLive: [],
    } as unknown as Ctx;
  }

  it("writes both artifacts for a completed run and never throws", () => {
    const dir = tempDir("h2-wire-");
    const events = new EventLog(dir, "eng-wire", { target: "shop.example.test", mode: "red", objective: "test" });
    events.append({ phase: "authorize", actor: "runner", action: "engagement_start", result: "started" });
    events.append({ phase: "exploit", actor: "exploiter", action: "http_probe", attackId: "T1190", result: "200 OK" });
    events.updateState({ status: "complete", phase: "done", findings: [confirmedFinding()] });
    const metrics = captureEngagementTrajectory({
      engagementDir: dir,
      engagementId: "eng-wire",
      target: "shop.example.test",
      ctx: fakeCtx(),
      events,
      environment: {},
    });
    assert.notEqual(metrics, null);
    assert.equal(metrics!.outcome, "success");
    assert.equal(metrics!.vulnsFound, 1);
    assert.equal(metrics!.steps, 2);
    assert.equal(metrics!.targetClass, "wordpress");
    assert.equal(metrics!.harness.runnerVersion, packageJson.version);
    assert.equal(metrics!.tokensIn, 0);
    assert.equal(existsSync(join(dir, "trajectory.json")), true);
    assert.equal(existsSync(join(dir, "metrics.json")), true);
    const trajectory = JSON.parse(readFileSync(join(dir, "trajectory.json"), "utf8")) as TrajectoryRecord;
    assert.equal(trajectory.events.some((event) => event.action === "http_probe" && event.isToolCall), true);
  });

  it("maps a kill-switch run to aborted", () => {
    const dir = tempDir("h2-wire-abort-");
    const events = new EventLog(dir, "eng-abort", { target: "shop.example.test", mode: "red", objective: "test" });
    events.updateState({ status: "halted", phase: "halted", blockedReason: "aborted by operator (kill switch)" });
    const metrics = captureEngagementTrajectory({
      engagementDir: dir,
      engagementId: "eng-abort",
      target: "shop.example.test",
      ctx: fakeCtx({ aborted: true }),
      events,
      environment: {},
    });
    assert.equal(metrics!.outcome, "aborted");
  });

  it("is a guarded no-op when the capture cannot write", () => {
    const dir = tempDir("h2-wire-nofail-");
    const events = new EventLog(dir, "eng-nofail", { target: "shop.example.test", mode: "red", objective: "test" });
    const blocker = join(tempDir("h2-wire-blocker-"), "not-a-dir");
    writeFileSync(blocker, "x");
    let outcome: ReturnType<typeof captureEngagementTrajectory> = undefined as never;
    assert.doesNotThrow(() => {
      outcome = captureEngagementTrajectory({
        engagementDir: join(blocker, "engagement"),
        engagementId: "eng-nofail",
        target: "shop.example.test",
        ctx: fakeCtx(),
        events,
        environment: {},
      });
    });
    assert.equal(outcome, null);
  });
});

// ---------------------------------------------------------------------------
// H2-P1 section-5: full-text step journal (steps.ts) + capture wiring
// ---------------------------------------------------------------------------

describe("section-5 step journal (steps.jsonl)", () => {
  it("appends full-text prompt/tool/observation rows with tool_name and tokens", () => {
    const dir = tempDir("h2-steps-");
    try {
      const journal = createStepJournal({ dir, runId: "eng-steps" });
      const longObservation = "O".repeat(9000) + " FULL-TAIL";
      journal.prompt('{"role":"user","content":"scan bot@client.example"}', 1234);
      journal.tool("http_probe", '{"url":"https://shop.example.test/?q=1"}');
      journal.observation("http_probe", longObservation);
      assert.equal(journal.count, 3);
      assert.equal(journal.tokensTotal, 1234);
      assert.equal(journal.path, stepsPath(dir));

      const rows = readSteps(dir);
      assert.deepEqual(rows.map((row) => row.role), ["prompt", "tool", "observation"]);
      assert.deepEqual(rows.map((row) => row.seq), [1, 2, 3]);
      assert.equal(rows[0]!.run_id, "eng-steps");
      assert.equal(rows[0]!.tool_name, null, "a prompt has no tool name");
      assert.equal(rows[0]!.tokens, 1234, "per-response tokens on the prompt row");
      assert.match(rows[0]!.content, /\[PII-REDACTED\]/, "PII is redacted before the journal write");
      assert.equal(rows[0]!.content.includes("bot@client.example"), false);
      assert.equal(rows[1]!.tool_name, "http_probe");
      assert.equal(rows[1]!.tokens, null);
      assert.equal(rows[2]!.tool_name, "http_probe");
      assert.equal(rows[2]!.content.length, longObservation.length, "observation text is never truncated");
      assert.equal(rows[2]!.content, longObservation);
      assert.equal(sumStepTokens(rows), 1234);
      assert.equal(countStepErrors(rows), 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seeds seq from an existing journal and is fail-soft on an unwritable dir", () => {
    const dir = tempDir("h2-steps-seed-");
    const blocker = join(tempDir("h2-steps-blocker-"), "not-a-dir");
    writeFileSync(blocker, "x");
    try {
      createStepJournal({ dir, runId: "eng-seed" }).prompt("first", null);
      const reopened = createStepJournal({ dir, runId: "eng-seed" });
      assert.equal(reopened.count, 1);
      reopened.prompt("second", null);
      assert.deepEqual(readSteps(dir).map((row) => row.seq), [1, 2]);

      const noop = createStepJournal({ dir: join(blocker, "engagement"), runId: "eng-blocked" });
      assert.doesNotThrow(() => noop.prompt("x", 1));
      assert.equal(noop.count, 0);
      assert.equal(noop.append("prompt", null, "x", null), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tolerates corrupt journal lines when reading back", () => {
    const dir = tempDir("h2-steps-corrupt-");
    try {
      const valid = JSON.stringify({
        run_id: "eng-corrupt",
        seq: 1,
        ts: "2026-10-18T00:00:00.000Z",
        role: "prompt",
        tool_name: null,
        content: "kept",
        tokens: 7,
      });
      writeFileSync(stepsPath(dir), `${valid}\n{broken json\n${JSON.stringify({ seq: 2, role: "bogus", content: "no" })}\n`);
      const rows = readSteps(dir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.content, "kept");
      assert.equal(rows[0]!.tokens, 7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op journal for a context with no engagement dir", () => {
    const noop = stepJournalFor({});
    assert.equal(noop.path, "");
    assert.equal(noop.count, 0);
    assert.doesNotThrow(() => noop.tool("http_probe", "{}"));
    assert.equal(noop.count, 0);
  });

  it("maps provider usage to a per-response token count, or null when absent", () => {
    assert.equal(responseTokens(undefined), null);
    assert.equal(responseTokens({ promptTokens: 80, completionTokens: 20, totalTokens: 100 }), 100);
    assert.equal(responseTokens({ promptTokens: 80, completionTokens: 20 }), 100);
  });
});

describe("agentLoop section-5 instrumentation (agents.ts)", () => {
  function loopCtx(dir: string, completeForRole: (...args: unknown[]) => Promise<unknown>): Ctx {
    return {
      actions: 0,
      consecutive5xx: 0,
      startedAt: Date.now(),
      config: { maxActions: 60, maxDurationMs: 60_000 },
      input: { roe: { blackoutWindows: [] } },
      deps: { completeForRole },
      events: new EventLog(dir, "eng-loop", { target: "shop.example.test", mode: "red", objective: "test" }),
      hostKill: { aborted: false, controllers: new Set<AbortController>() },
      safety: { killSwitchAborts: 0 },
    } as unknown as Ctx;
  }

  it("journals the full outgoing prompt and the response's tokens", async () => {
    const dir = tempDir("h2-loop-");
    try {
      const ctx = loopCtx(dir, async () => ({
        text: "done",
        usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
      }));
      await agentLoop(ctx, "recon", "recon", "SYSTEM-INSTRUCTION", "USER-INSTRUCTION", [], 1, { onIdle: () => null });
      const rows = readSteps(dir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.role, "prompt");
      assert.equal(rows[0]!.run_id, "eng-loop");
      assert.equal(rows[0]!.tokens, 100);
      assert.match(rows[0]!.content, /SYSTEM-INSTRUCTION/);
      assert.match(rows[0]!.content, /USER-INSTRUCTION/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("journals a tool call and an ERROR observation when the dispatch throws", async () => {
    const dir = tempDir("h2-loop-tool-");
    try {
      const ctx = loopCtx(dir, async () => ({
        text: "",
        toolCalls: [{ id: "call-1", name: "http_probe", arguments: { url: "https://shop.example.test/?q=1" } }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }));
      // An in-process kill switch makes dispatchTool throw before any traffic.
      ctx.hostKill.aborted = true;
      await assert.rejects(() => agentLoop(ctx, "exploiter", "exploit", "s", "u", [], 1), /aborted/);
      const rows = readSteps(dir);
      assert.deepEqual(rows.map((row) => row.role), ["prompt", "tool", "observation"]);
      assert.equal(rows[0]!.tokens, 15);
      assert.equal(rows[1]!.tool_name, "http_probe");
      assert.match(rows[1]!.content, /shop\.example\.test/);
      assert.equal(rows[2]!.tool_name, "http_probe");
      assert.equal(rows[2]!.content.startsWith(TOOL_ERROR_PREFIX), true);
      assert.equal(countStepErrors(rows), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// H2-P1 section-5: runs + metrics rows / failure_mode rules (spec5.ts)
// ---------------------------------------------------------------------------

const S5_STARTED = "2026-10-18T00:00:00.000Z";
const S5_FINISHED = "2026-10-18T00:01:00.000Z";

function section5Metrics(over: Partial<RunMetrics> = {}): RunMetrics {
  const base = captureRunMetrics({
    engagementId: "eng-5",
    target: "https://shop.example.test:443/path",
    targetIds: ["webapp"],
    appType: "wordpress",
    status: "complete",
    vulnsFound: 2,
    falsePositives: 0,
    exploitsAttempted: 2,
    exploitsSucceeded: 2,
    steps: 4,
    tokensIn: 100,
    tokensOut: 40,
    startedAtMs: Date.parse(S5_STARTED),
    finishedAtMs: Date.parse(S5_FINISHED),
    harness: { runnerVersion: "test", layerIds: ["base", "wp-hardening"], componentHashes: {} },
  });
  return { ...base, ...over };
}

function stepRow(seq: number, role: StepRecord["role"] = "prompt"): StepRecord {
  return { run_id: "eng-5", seq, ts: S5_STARTED, role, tool_name: null, content: "x", tokens: 5 };
}

function section5Facts(over: Partial<Spec5RunFacts> = {}, metricsOver: Partial<RunMetrics> = {}): Spec5RunFacts {
  return {
    metrics: section5Metrics(metricsOver),
    steps: [],
    actions: 4,
    maxActions: 60,
    maxDurationMs: 45 * 60_000,
    aborted: false,
    toolErrors: 0,
    llmErrors: 0,
    target: "https://shop.example.test:443/path",
    targetIds: ["webapp"],
    appType: "wordpress",
    stack: ["nginx", "wordpress"],
    ...over,
  };
}

describe("section-5 runs and metrics rows", () => {
  it("derives target_class/target_subclass/target_id and the harness stamp columns", () => {
    const rows = buildSpec5Rows(section5Facts());
    assert.equal(rows.run.run_id, "eng-5");
    assert.equal(rows.run.ts, Date.parse(S5_FINISHED));
    assert.equal(rows.run.target_class, "wordpress");
    assert.equal(rows.run.target_subclass, "webapp", "appType class -> the selected target families");
    assert.equal(rows.run.target_id, "https://shop.example.test:443/path");
    assert.equal(rows.run.harness_version, "test");
    assert.equal(rows.run.layer_set, '["base","wp-hardening"]');
    assert.equal(rows.run.cycle_ref, null);
  });

  it("falls back to the fingerprint stack for the subclass without an appType", () => {
    assert.equal(deriveTargetSubclass({ targetClass: "webapp", appType: "unknown", stack: ["React-SPA", "nginx"] }), "nginx+react-spa");
    assert.equal(deriveTargetSubclass({ targetClass: "wordpress", targetIds: ["secscan", "seclayer"], appType: "wordpress" }), "seclayer+secscan");
    assert.equal(deriveTargetSubclass({ targetClass: "10.1.2.3" }), "unknown");
  });

  it("counts claims, steps, tokens and success in the metrics row", () => {
    const rows = buildSpec5Rows(section5Facts({ steps: [stepRow(1), stepRow(2, "tool"), stepRow(3, "observation")] }));
    assert.equal(rows.metrics.run_id, "eng-5");
    assert.equal(rows.metrics.success, 1);
    assert.equal(rows.metrics.vulns_found, 2);
    assert.equal(rows.metrics.claims_total, 2);
    assert.equal(rows.metrics.false_positives, 0);
    assert.equal(rows.metrics.steps_count, 3, "captured step rows win over the planner unit");
    assert.equal(rows.metrics.tokens_total, 140);
    assert.equal(rows.metrics.crashed, 0);
    assert.equal(rows.metrics.failure_mode, "none");
    const fallback = buildSpec5Rows(section5Facts({ actions: 9 }));
    assert.equal(fallback.metrics.steps_count, 9, "no journal -> ctx.actions fallback");
  });

  it("applies the documented failure_mode ladder", () => {
    const cases: { name: string; over?: Partial<Spec5RunFacts>; metrics?: Partial<RunMetrics>; expect: string }[] = [
      { name: "operator abort wins", over: { aborted: true, blockedReason: "duration cap reached" }, expect: "none" },
      { name: "duration halt", over: { blockedReason: "duration cap reached" }, expect: "timeout" },
      { name: "duration at maximum", over: { maxDurationMs: 30_000 }, metrics: { durationMs: 30_000 }, expect: "timeout" },
      { name: "action halt", over: { blockedReason: "action cap reached (60)" }, expect: "step-exhaustion" },
      { name: "actions at maximum", over: { actions: 60 }, expect: "step-exhaustion" },
      { name: "tool exception", over: { toolErrors: 1 }, expect: "tool-error" },
      { name: "llm failure", over: { llmErrors: 1 }, expect: "tool-error" },
      { name: "unexpected crash", over: { blockedReason: "unexpected error: boom" }, expect: "tool-error" },
      { name: "false-positive blow-up", metrics: { vulnsFound: 1, falsePositives: 2 }, expect: "fp-blowup" },
      {
        name: "missed vulnerability",
        metrics: { outcome: "partial", vulnsFound: 0, exploitsSucceeded: 0 },
        expect: "missed-vuln",
      },
      { name: "clean success", over: {}, expect: "none" },
    ];
    for (const entry of cases) {
      assert.equal(
        deriveFailureMode(section5Facts(entry.over ?? {}, entry.metrics ?? {})),
        entry.expect,
        entry.name,
      );
    }
  });

  it("flags a crash only for an unexpected internal error, never an abort", () => {
    assert.equal(isCrashed(section5Facts({ blockedReason: "unexpected error: boom" })), true);
    assert.equal(buildSpec5Rows(section5Facts({ blockedReason: "unexpected error: boom" })).metrics.crashed, 1);
    assert.equal(isCrashed(section5Facts({ aborted: true, blockedReason: "unexpected error: boom" })), false);
    assert.equal(isCrashed(section5Facts({ blockedReason: "action cap reached (60)" })), false);
    assert.equal(buildSpec5Rows(section5Facts()).metrics.crashed, 0);
  });
});

describe("section-5 finish-path wiring", () => {
  function fakeCtx(): Ctx {
    return {
      fingerprint: { host: "shop.example.test", stack: ["nginx", "wordpress"], appType: "wordpress" },
      itemLedger: new Map(),
      hostKill: { aborted: false, controllers: new Set() },
      safety: { killSwitchAborts: 0 },
      actions: 4,
      startedAt: Date.parse(S5_STARTED),
      liveFindings: [],
      killedLive: [],
    } as unknown as Ctx;
  }

  it("writes run.json with the section-5 rows and counts the step journal", () => {
    const dir = tempDir("h2-wire-spec5-");
    try {
      const events = new EventLog(dir, "eng-spec5", { target: "shop.example.test", mode: "red", objective: "test" });
      events.append({ phase: "authorize", actor: "runner", action: "engagement_start", result: "started" });
      events.updateState({ status: "complete", phase: "done", findings: [confirmedFinding()] });
      const journal = createStepJournal({ dir, runId: "eng-spec5" });
      journal.prompt('{"messages":[]}', 100);
      journal.tool("http_probe", '{"url":"https://shop.example.test"}');
      journal.observation("http_probe", `${TOOL_ERROR_PREFIX}tool crashed`);

      const metrics = captureEngagementTrajectory({
        engagementDir: dir,
        engagementId: "eng-spec5",
        target: "shop.example.test",
        targetIds: ["webapp"],
        ctx: fakeCtx(),
        events,
        environment: {},
      });
      assert.notEqual(metrics, null);
      assert.equal(existsSync(join(dir, SPEC5_FILE_NAME)), true);
      const rows = JSON.parse(readFileSync(join(dir, SPEC5_FILE_NAME), "utf8")) as {
        run: Record<string, unknown>;
        metrics: Record<string, unknown>;
      };
      assert.equal(rows.run["run_id"], "eng-spec5");
      assert.equal(rows.run["target_class"], "wordpress");
      assert.equal(rows.run["target_subclass"], "webapp");
      assert.equal(rows.run["cycle_ref"], null);
      assert.equal(typeof rows.run["layer_set"], "string");
      assert.equal(rows.metrics["steps_count"], 3);
      assert.equal(rows.metrics["tokens_total"], metrics!.tokensIn + metrics!.tokensOut);
      assert.equal(rows.metrics["failure_mode"], "tool-error");
      assert.equal(rows.metrics["success"], 1);
      // The contract artifacts are still written unchanged.
      assert.equal(existsSync(join(dir, "trajectory.json")), true);
      assert.equal(existsSync(join(dir, "metrics.json")), true);
      assert.equal(readdirSync(dir).filter((name) => name.includes(".tmp-")).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
