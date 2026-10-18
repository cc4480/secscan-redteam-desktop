/**
 * H2-P1a: trajectory + metrics capture.
 *
 * Covers: harness stamp shape (version, pinned guardrails, real component
 * hashes, layer override), the outcome mapping for success/partial/failure/
 * aborted, the targetClass rule, explicit-0 token capture vs real meter sums,
 * atomic + newer-wins trajectory.json/metrics.json writes, event normalization,
 * and the finish-path wiring helper being a guarded no-op on error.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventLog } from "../src/events.js";
import { EDITABLE_COMPONENTS, PINNED_COMPONENT, type TrajectoryRecord } from "../src/harness2/contract.js";
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
