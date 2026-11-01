/**
 * Wire derivation guard (diag-html-report 2026-11-01, Cause 2): the
 * optional detail/matter derivations in buildEngagementReportInput used
 * to sit outside any guard, so one throw killed report.html + report.docx
 * while the md/json/txt twins survived. Now a derivation failure degrades
 * that section to absent, records report_detail_failed naming the
 * section, and the HTML still assembles and renders.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog, readEvents } from "../src/events.js";
import { type Ctx } from "../src/context.js";
import { type Finding } from "../src/types.js";
import { type ReportMeta } from "../src/report/html.js";
import { type DetailInput } from "../src/report/detail.js";
import { buildEngagementReportInput, type WireDeps } from "../src/report/html/wire.js";
import { renderEngagementReportHtml } from "../src/report/html/render.js";

const META: ReportMeta = {
  engagementId: "eng-wire-guard",
  target: "example.com",
  mode: "red",
  environment: "staging",
  tier: 1,
  status: "complete",
  phase: "report",
  verified: true,
  objective: "Assess",
  startedAt: "2026-11-01T08:00:00.000Z",
  generatedAt: "2026-11-01T09:00:00.000Z",
};

const FINDING: Finding = {
  id: "F-1", severity: "high", title: "Fixture flaw", attackIds: ["T1190"],
  evidence: "fixture evidence", fix: "Apply the fixture patch.", retest: "Re-probe.",
  status: "confirmed", accountableOperator: "Carlos",
};

function makeDeps(dir: string, over: { roe?: unknown; detailInput?: DetailInput } = {}): WireDeps {
  const events = new EventLog(dir, "eng-wire-guard", { target: "example.com", mode: "red", objective: "Assess" });
  const ctx = {
    input: {
      target: "example.com",
      mode: "red",
      objective: "Assess",
      fullBattery: false,
      localHost: false,
      environment: "staging",
      roe: "roe" in over ? over.roe : { scope: ["example.com"] },
    },
    config: { dryRunAgents: false },
    coverage: new Set(["validation"]),
    targetCoverage: new Map(),
    itemLedger: new Map(),
    probesUsed: 3,
    plan: null,
    verifiedAt: "2026-11-01T07:55:00.000Z",
    verificationProof: "Operator-attested ownership",
    events,
  } as unknown as Ctx;
  return {
    ctx,
    meta: META,
    title: "Penetration Test Report",
    findings: [FINDING],
    narrativeMd: "Fixture narrative.",
    bundles: new Map(),
    proof: { noBundleReasons: new Map(), negative: [] },
    cells: [],
    totals: { total: 1, confirmed: 1, executedClean: 0, killed: 0, blocked: 0, na: 0, pending: 0 },
    planOnly: [],
    events: [],
    ...(over.detailInput ? { detailInput: over.detailInput } : {}),
  };
}

function detailFailedEvents(dir: string) {
  return readEvents(dir, 0, 100000).filter((e) => e.action === "report_detail_failed");
}

describe("wire derivation guard", () => {
  it("a throwing matter derivation degrades to absent — HTML still renders, typed event names the section", () => {
    const dir = mkdtempSync(join(tmpdir(), "wire-guard-"));
    try {
      // roe undefined: buildMatter dereferences roe.scope and throws.
      const input = buildEngagementReportInput(makeDeps(dir, { roe: undefined }));
      assert.equal(input.matter, undefined);
      const html = renderEngagementReportHtml(input);
      assert.ok(html.length > 1000, "HTML renders without the matter section");
      assert.ok(html.includes("Fixture flaw"), "findings still render");
      const failed = detailFailedEvents(dir);
      assert.equal(failed.length, 1);
      assert.match(failed[0]!.result, /matter/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a throwing detail derivation degrades to absent — HTML still renders, typed event names the section", () => {
    const dir = mkdtempSync(join(tmpdir(), "wire-guard-"));
    try {
      // A null finding entry makes buildReportDetail's first filter throw.
      const detailInput = {
        target: "example.com",
        mode: "red",
        dryRun: false,
        posture: { score: 80, grade: "B", postureRating: "Fair" },
        findingsBySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
        tierCounts: { proven: 0, confirmed: 1, deferred: 0 },
        findings: [null as never],
        coverage: {},
        surface: {},
      } as unknown as DetailInput;
      const input = buildEngagementReportInput(makeDeps(dir, { detailInput }));
      assert.equal(input.detail, undefined);
      assert.ok(input.matter, "the healthy derivation is unaffected");
      const html = renderEngagementReportHtml(input);
      assert.ok(html.length > 1000, "HTML renders without the detail section");
      const failed = detailFailedEvents(dir);
      assert.equal(failed.length, 1);
      assert.match(failed[0]!.result, /detail/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("healthy derivations pass through untouched and record nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "wire-guard-"));
    try {
      const input = buildEngagementReportInput(makeDeps(dir));
      assert.ok(input.matter);
      assert.equal(detailFailedEvents(dir).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
