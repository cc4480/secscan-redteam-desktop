/**
 * Q-REPORT-DETAIL — predecessor resolution (spec §12.3, phase level).
 *
 * Fixture engagement directories on disk, resolved by the same rules
 * the report phase runs: same normalized target, complete, strictly
 * earlier, same-engine artifacts present, dry runs only against dry
 * runs, halted never a baseline. Plus the arm-run extraction and the
 * live-label join that feed detail.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  armLabelOf,
  extractArmRuns,
  joinLiveLabels,
  normalizeTargetKey,
  recordReportMeta,
  resolvePredecessor,
} from "../src/report/predecessor.js";
import { reportPhase } from "../src/report/phase.js";
import { EventLog } from "../src/events.js";
import { type Ctx, type LiveFinding } from "../src/context.js";
import { type EngagementEvent, type Finding } from "../src/types.js";

interface FixtureOpts {
  target: string;
  status?: string;
  startedAt: string;
  findings?: Finding[];
  dryRun?: boolean;
  artifacts?: boolean;
  meta?: { score: number; grade: string } | null;
  pocExec?: string[];
}

function writeEngagement(root: string, id: string, o: FixtureOpts): string {
  const dir = join(root, id);
  mkdirSync(join(dir, "poc"), { recursive: true });
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      engagementId: id,
      target: o.target,
      mode: "red",
      objective: "",
      status: o.status ?? "complete",
      phase: "done",
      verified: true,
      findings: o.findings ?? [],
      eventCount: 1,
      startedAt: o.startedAt,
      updatedAt: o.startedAt,
    }),
  );
  if (o.artifacts !== false) {
    writeFileSync(join(dir, "report.md"), o.dryRun ? "# Engagement report (dry-run)\n" : "# Engagement report\n");
    writeFileSync(join(dir, "item-verdicts.json"), "[]");
  }
  if (o.meta) {
    writeFileSync(
      join(dir, "report-meta.json"),
      JSON.stringify({ version: 1, engagementId: id, target: o.target, startedAt: o.startedAt, dryRun: !!o.dryRun, score: o.meta.score, grade: o.meta.grade }),
    );
  }
  for (const fid of o.pocExec ?? []) {
    writeFileSync(join(dir, "poc", `${fid}.json`), JSON.stringify({ validationTier: "execution" }));
  }
  return dir;
}

function fakeCtx(dir: string, id: string, target: string, startedAt: string, dryRun = false): Ctx {
  return {
    input: { target },
    config: { dryRunAgents: dryRun },
    events: { dir, engagementId: id, snapshot: { startedAt } },
  } as unknown as Ctx;
}

function finding(over: Partial<Finding>): Finding {
  return {
    id: "F-1", severity: "low", title: "t", attackIds: [], evidence: "", fix: "", retest: "", status: "confirmed",
    ...over,
  };
}

const T = "https://secscan.us";

describe("predecessor resolution (§1.2)", () => {
  it("picks the latest earlier complete engagement of the same target", () => {
    const root = mkdtempSync(join(tmpdir(), "rd-pred-"));
    writeEngagement(root, "eng-old", { target: T, startedAt: "2026-10-01T00:00:00.000Z" });
    writeEngagement(root, "eng-mid", { target: T, startedAt: "2026-10-10T00:00:00.000Z" });
    writeEngagement(root, "eng-other", { target: "https://other.example", startedAt: "2026-10-15T00:00:00.000Z" });
    const cur = writeEngagement(root, "eng-cur", { target: T, startedAt: "2026-10-20T00:00:00.000Z" });
    const base = resolvePredecessor(fakeCtx(cur, "eng-cur", T, "2026-10-20T00:00:00.000Z"));
    assert.equal(base?.engagementId, "eng-mid");
  });

  it("skips halted predecessors and falls to the next earlier complete one", () => {
    const root = mkdtempSync(join(tmpdir(), "rd-pred-"));
    writeEngagement(root, "eng-done", { target: T, startedAt: "2026-10-01T00:00:00.000Z" });
    writeEngagement(root, "eng-halted", { target: T, startedAt: "2026-10-10T00:00:00.000Z", status: "halted" });
    const cur = writeEngagement(root, "eng-cur", { target: T, startedAt: "2026-10-20T00:00:00.000Z" });
    assert.equal(resolvePredecessor(fakeCtx(cur, "eng-cur", T, "2026-10-20T00:00:00.000Z"))?.engagementId, "eng-done");
  });

  it("never baselines a real run against a dry run, nor the reverse", () => {
    const root = mkdtempSync(join(tmpdir(), "rd-pred-"));
    writeEngagement(root, "eng-dry", { target: T, startedAt: "2026-10-10T00:00:00.000Z", dryRun: true });
    const cur = writeEngagement(root, "eng-cur", { target: T, startedAt: "2026-10-20T00:00:00.000Z" });
    assert.equal(resolvePredecessor(fakeCtx(cur, "eng-cur", T, "2026-10-20T00:00:00.000Z")), undefined);
    const root2 = mkdtempSync(join(tmpdir(), "rd-pred-"));
    writeEngagement(root2, "eng-real", { target: T, startedAt: "2026-10-10T00:00:00.000Z" });
    const curDry = writeEngagement(root2, "eng-cur", { target: T, startedAt: "2026-10-20T00:00:00.000Z", dryRun: true });
    assert.equal(resolvePredecessor(fakeCtx(curDry, "eng-cur", T, "2026-10-20T00:00:00.000Z", true)), undefined);
  });

  it("rejects a live-service-shaped directory (no runner artifacts)", () => {
    const root = mkdtempSync(join(tmpdir(), "rd-pred-"));
    writeEngagement(root, "eng-service", { target: T, startedAt: "2026-10-10T00:00:00.000Z", artifacts: false });
    const cur = writeEngagement(root, "eng-cur", { target: T, startedAt: "2026-10-20T00:00:00.000Z" });
    assert.equal(resolvePredecessor(fakeCtx(cur, "eng-cur", T, "2026-10-20T00:00:00.000Z")), undefined);
  });

  it("carries the recorded score when present; counts-only when absent", () => {
    const root = mkdtempSync(join(tmpdir(), "rd-pred-"));
    writeEngagement(root, "eng-scored", { target: T, startedAt: "2026-10-10T00:00:00.000Z", meta: { score: 42, grade: "D" } });
    const cur = writeEngagement(root, "eng-cur", { target: T, startedAt: "2026-10-20T00:00:00.000Z" });
    const scored = resolvePredecessor(fakeCtx(cur, "eng-cur", T, "2026-10-20T00:00:00.000Z"));
    assert.equal(scored?.score, 42);
    assert.equal(scored?.grade, "D");

    const root2 = mkdtempSync(join(tmpdir(), "rd-pred-"));
    writeEngagement(root2, "eng-legacy", { target: T, startedAt: "2026-10-10T00:00:00.000Z", meta: null });
    const cur2 = writeEngagement(root2, "eng-cur", { target: T, startedAt: "2026-10-20T00:00:00.000Z" });
    const legacy = resolvePredecessor(fakeCtx(cur2, "eng-cur", T, "2026-10-20T00:00:00.000Z"));
    assert.ok(legacy, "legacy predecessor still resolves");
    assert.equal(legacy?.score, undefined, "no recorded score => counts-only");
  });

  it("loads baseline findings: killed excluded, execution bundle => proven, deferred carried", () => {
    const root = mkdtempSync(join(tmpdir(), "rd-pred-"));
    writeEngagement(root, "eng-base", {
      target: T,
      startedAt: "2026-10-10T00:00:00.000Z",
      findings: [
        finding({ id: "F-1", title: "proven one" }),
        finding({ id: "F-2", title: "killed one", status: "killed" }),
        finding({ id: "F-3", title: "deferred one", status: "deferred" }),
      ],
      pocExec: ["F-1"],
    });
    const cur = writeEngagement(root, "eng-cur", { target: T, startedAt: "2026-10-20T00:00:00.000Z" });
    const base = resolvePredecessor(fakeCtx(cur, "eng-cur", T, "2026-10-20T00:00:00.000Z"));
    assert.deepEqual(
      base?.findings.map((f) => [f.id, f.tier]),
      [["F-1", "proven"], ["F-3", "deferred"]],
    );
  });
});

describe("target normalization (§1.2)", () => {
  it("lowercases scheme+host, strips default ports and a bare trailing slash", () => {
    assert.equal(normalizeTargetKey("HTTPS://SecScan.US:443/"), "https://secscan.us");
    assert.equal(normalizeTargetKey("http://Example.com:80"), "http://example.com");
    assert.equal(normalizeTargetKey("https://secscan.us:8443/"), "https://secscan.us:8443");
  });
  it("keeps non-empty paths verbatim — a different path is a different target", () => {
    assert.notEqual(normalizeTargetKey("https://secscan.us/app"), normalizeTargetKey("https://secscan.us"));
    assert.equal(normalizeTargetKey("https://secscan.us/App"), "https://secscan.us/App");
  });
});

describe("arm runs + live-label join", () => {
  const ev = (action: string, result = ""): EngagementEvent =>
    ({ ts: "", seq: 1, engagementId: "e", phase: "exploit", actor: "exploiter", action, result }) as EngagementEvent;

  it("extracts only the arms the event log proves", () => {
    const arms = extractArmRuns([
      ev("seclayer_bola"),
      ev("seclayer_dast", "seclayer_dast/dom-xss vs https://x — 1 finding"),
      ev("secscan_exec"),
      ev("http_probe"),
      ev("seclayer_dast", "no label in this result"),
    ]);
    assert.deepEqual(arms.map((a) => a.name).sort(), ["bola", "dom_xss", "secscan-engine"]);
    assert.ok(arms.every((a) => a.state === "ran"));
  });

  it("armLabelOf keeps known arms + engine categories, drops free-form classes", () => {
    assert.equal(armLabelOf("bola-idor"), "bola-idor");
    assert.equal(armLabelOf("aggressive-ssti"), "aggressive-ssti");
    assert.equal(armLabelOf("csrf"), "csrf");
    assert.equal(armLabelOf("Injection Defense"), "Injection Defense");
    assert.equal(armLabelOf("unclassified"), "");
    assert.equal(armLabelOf("sqli"), "");
    assert.equal(armLabelOf(undefined), "");
  });

  it("joins by normalized title + attackId, then by unique title", () => {
    const live: LiveFinding[] = [
      { severity: "critical", title: "Cross-Tenant Access.", attackId: "T1190", evidence: "", vulnClass: "bola-idor" },
      { severity: "low", title: "Loose header", attackId: "T0000", evidence: "", vulnClass: "Injection Defense" },
    ];
    const joined = joinLiveLabels(
      [finding({ id: "F-1", title: "cross-tenant access", attackIds: ["t1190"] }), finding({ id: "F-2", title: "Loose header", attackIds: [] })],
      live,
    );
    assert.equal(joined.get("F-1")?.vulnClass, "bola-idor");
    assert.equal(joined.get("F-2")?.vulnClass, "Injection Defense");
  });
});

describe("recordReportMeta — halt honesty (eng-2026-11-02-or12 defect 2)", () => {
  function metaCtx(dir: string): Ctx {
    return {
      input: { target: "http://127.0.0.1:8080" },
      config: { dryRunAgents: false },
      events: {
        dir,
        engagementId: "eng-test-meta",
        snapshot: { startedAt: "2026-11-02T22:53:00.000Z" },
      },
    } as unknown as Ctx;
  }

  it("a null posture writes NO score/grade — no fabricated A/100", () => {
    const dir = mkdtempSync(join(tmpdir(), "report-meta-null-"));
    recordReportMeta(metaCtx(dir), null);
    const meta = JSON.parse(readFileSync(join(dir, "report-meta.json"), "utf8")) as Record<string, unknown>;
    assert.equal("score" in meta, false);
    assert.equal("grade" in meta, false);
    assert.equal(meta.version, 1);
    assert.equal(meta.engagementId, "eng-test-meta");
    assert.equal(meta.target, "http://127.0.0.1:8080");
    assert.equal(meta.startedAt, "2026-11-02T22:53:00.000Z");
    assert.equal(meta.dryRun, false);
  });

  it("a real posture keeps the exact completed-run byte shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "report-meta-real-"));
    recordReportMeta(metaCtx(dir), { score: 82, grade: "B" });
    const raw = readFileSync(join(dir, "report-meta.json"), "utf8");
    const expected =
      JSON.stringify(
        {
          version: 1, engagementId: "eng-test-meta", target: "http://127.0.0.1:8080",
          startedAt: "2026-11-02T22:53:00.000Z", dryRun: false,
          score: 82, grade: "B",
        },
        null, 2,
      );
    assert.equal(raw, expected);
  });

  it("the real reportPhase halt path writes a meta with no A/100", async () => {
    const dir = mkdtempSync(join(tmpdir(), "report-phase-halt-"));
    const events = new EventLog(dir, "eng-test-halt", {
      target: "http://127.0.0.1:8080",
      mode: "red",
      objective: "halt-path meta honesty",
    });
    const ctx = {
      input: { mode: "red", target: "http://127.0.0.1:8080", fullBattery: false, operatorName: "test" },
      config: { dryRunAgents: false },
      events,
      coverage: new Set(),
      targetCoverage: new Map(),
      itemLedger: new Map(),
      probesUsed: 0,
      liveFindings: [],
      killedLive: [],
      peerDeferredLive: [],
      registryHits: [],
      targetMap: [],
      fingerprint: { host: "127.0.0.1", stack: [], appType: "test" },
      verificationProof: "test attestation",
      plan: undefined,
      operationNarrative: undefined,
      nuclei: { templateExecutions: 0, templatesRun: 0, findings: 0 },
    } as unknown as Ctx;
    try {
      await reportPhase(ctx, "brief", "summary", { haltedReason: "test halt: attested target unreachable" });
    } catch {
      // Deliverable writers downstream of the meta write may need a
      // fuller ctx than this fabrication; the assertion below is on
      // the meta the halt path itself wrote before them.
    }
    const meta = JSON.parse(readFileSync(join(dir, "report-meta.json"), "utf8")) as Record<string, unknown>;
    assert.equal("score" in meta, false);
    assert.equal("grade" in meta, false);
    assert.equal(meta.engagementId, "eng-test-halt");
    assert.equal(meta.target, "http://127.0.0.1:8080");
  });
});
