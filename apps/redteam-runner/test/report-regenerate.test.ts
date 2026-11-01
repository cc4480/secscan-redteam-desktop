/**
 * Deliverable repair path (diag-html-report 2026-11-01, Cause 2):
 *
 *   (1) engagement_status names the missing files when a recorded end
 *       carries deliverableFailed — it never reads as plain "complete";
 *   (2) engagement_regenerate_report restores a set whose report.html
 *       was deleted — the full seven files, verified, the failure stamp
 *       cleared;
 *   (3) regeneration on a healthy set is a no-op success;
 *   (4) an unknown engagement id gets a typed error and nothing is
 *       written;
 *   (5) a still-running engagement is refused — regeneration runs only
 *       on a recorded end.
 *
 * Fixtures are hand-recorded engagement directories (state.json +
 * report.md + report.json + a poc bundle), the same records a real
 * close writes; no engagement is launched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UiStore } from "../src/ui/store.js";
import { TOOLS_BY_NAME } from "../src/ui/mcp-tools.js";
import { readState } from "../src/events.js";
import { DELIVERABLE_FILES, verifyDeliverables, type ReportModel } from "../src/report/deliverables.js";

let tmp = "";
let store: UiStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "regen-test-"));
  store = new UiStore(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const tool = (name: string) => {
  const t = TOOLS_BY_NAME.get(name);
  assert.ok(t, `tool ${name} is registered`);
  return t;
};

const FINDINGS = [
  {
    id: "F-1", severity: "high", title: "Fixture flaw", attackIds: ["T1190"],
    evidence: "fixture evidence", fix: "Apply the fixture patch.", retest: "Re-probe the fixture.",
    status: "confirmed", accountableOperator: "Carlos",
  },
];

const REPORT_MD =
  "# Engagement report\n\nFixture narrative prose.\n\n" +
  "```json " + JSON.stringify({ findings: FINDINGS }) + " ```\n" +
  "\n\n---\n\n## Battery coverage (runner-computed)\n\n" +
  "Battery coverage: 3/3 categories probed (logic:yes, functionality:yes, validation:yes, 12 probes total).\n";

function recordedModel(id: string): ReportModel {
  return {
    kind: "secscan-redteam-report",
    version: 1,
    engagementId: id,
    target: "https://example.com",
    mode: "red",
    objective: "fixture assessment",
    status: "complete",
    dryRun: false,
    generatedAt: "2026-11-01T09:00:00.000Z",
    grade: { letter: "C", score: 72, rating: "Fair" },
    severityCounts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    findingCount: 1,
    batteryTotals: { total: 3, confirmed: 1, executedClean: 2, killed: 0, blocked: 0, na: 0, pending: 0 },
    coverageCells: [],
    findings: FINDINGS as ReportModel["findings"],
  };
}

/** A recorded engagement whose deliverable set is short: only report.md
 * is on disk, and the state carries the deliverable_failed stamp. */
function recordedEngagement(id: string, over: { status?: string; deliverableFailed?: boolean } = {}): string {
  const dir = join(tmp, id);
  mkdirSync(join(dir, "poc"), { recursive: true });
  const failed = over.deliverableFailed !== false;
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      engagementId: id,
      target: "https://example.com",
      mode: "red",
      objective: "fixture assessment",
      status: over.status ?? "complete",
      phase: "report",
      verified: true,
      verificationProof: "Operator-attested ownership",
      plan: null,
      findings: FINDINGS,
      eventCount: 7,
      startedAt: "2026-11-01T08:00:00.000Z",
      updatedAt: "2026-11-01T09:00:00.000Z",
      ...(failed
        ? { deliverableFailed: true, deliverables: { "report.md": join(dir, "report.md") } }
        : {}),
    }),
  );
  writeFileSync(join(dir, "report.md"), REPORT_MD);
  writeFileSync(join(dir, "report.json"), JSON.stringify(recordedModel(id), null, 2) + "\n");
  writeFileSync(
    join(dir, "poc", "F-1.json"),
    JSON.stringify({
      version: 1, bundleId: "bundle-F-1", engagementId: id, findingId: "F-1",
      attackIds: ["T1190"], severity: "high", title: "Fixture flaw",
      target: "https://example.com", operator: "Carlos", generatedAt: "2026-11-01T09:00:00.000Z",
      steps: [], validationTier: "observation",
      proves: "The fixture flaw responded as recorded.", doesNotProve: "No impact beyond the fixture.",
      reverifyCommand: "curl https://example.com",
    }),
  );
  return dir;
}

describe("engagement_status deliverable surfacing", () => {
  it("names the missing files when the set failed — never plain 'complete'", async () => {
    const id = "eng-2026-11-01-fixture1";
    recordedEngagement(id);
    const out = await tool("engagement_status").run(store, { id });
    assert.equal(out.status, 200);
    const b = out.body as Record<string, unknown>;
    assert.equal(b["deliverableFailed"], true);
    const missing = b["missingDeliverables"] as string[];
    assert.ok(missing.includes("report.html"), "report.html named missing");
    assert.ok(missing.includes("report.docx"), "report.docx named missing");
    assert.ok(missing.includes("report-package.zip"), "package named missing");
    assert.match(String(b["summary"]), /INCOMPLETE/);
    assert.match(String(b["summary"]), /report\.html/);
    assert.match(String(b["summary"]), /engagement_regenerate_report/);
  });

  it("a clean completion still summarizes as plain complete", async () => {
    const id = "eng-2026-11-01-fixture2";
    recordedEngagement(id, { deliverableFailed: false });
    const out = await tool("engagement_status").run(store, { id });
    const b = out.body as Record<string, unknown>;
    assert.equal(b["deliverableFailed"], undefined);
    assert.match(String(b["summary"]), /is complete/);
  });
});

describe("engagement_regenerate_report", () => {
  it("restores the full set when report.html (and siblings) are missing", async () => {
    const id = "eng-2026-11-01-fixture3";
    const dir = recordedEngagement(id);
    assert.equal(verifyDeliverables(dir).ok, false);
    const out = await tool("engagement_regenerate_report").run(store, { id });
    assert.equal(out.status, 200);
    const b = out.body as Record<string, unknown>;
    assert.equal(b["regenerated"], true);
    assert.equal(b["ok"], true);
    assert.equal(b["deliverableGap"], undefined);
    assert.ok(String(b["reportHtmlPath"]).endsWith("report.html"));
    for (const name of DELIVERABLE_FILES) {
      assert.ok(existsSync(join(dir, name)), `${name} restored`);
    }
    assert.equal(verifyDeliverables(dir).ok, true);
    const html = readFileSync(join(dir, "report.html"), "utf8");
    assert.ok(html.length > 3000, "regenerated HTML is a substantive document");
    assert.ok(html.includes("Fixture flaw"), "the recorded finding renders");
    assert.equal(readState(dir)?.deliverableFailed, false);
  });

  it("is a no-op success on a healthy set", async () => {
    const id = "eng-2026-11-01-fixture4";
    const dir = recordedEngagement(id);
    const first = await tool("engagement_regenerate_report").run(store, { id });
    assert.equal((first.body as Record<string, unknown>)["ok"], true);
    const htmlBefore = readFileSync(join(dir, "report.html"), "utf8");
    const second = await tool("engagement_regenerate_report").run(store, { id });
    assert.equal(second.status, 200);
    const b = second.body as Record<string, unknown>;
    assert.equal(b["regenerated"], false);
    assert.match(String(b["summary"]), /already complete/);
    assert.equal(readFileSync(join(dir, "report.html"), "utf8"), htmlBefore, "no file rewritten");
  });

  it("refuses an unknown engagement with a typed error and writes nothing", async () => {
    const before = readdirSync(tmp);
    const out = await tool("engagement_regenerate_report").run(store, { id: "eng-2026-11-01-zzzzzzzz" });
    assert.equal(out.status, 404);
    assert.equal((out.body as Record<string, unknown>)["error"], "unknown engagement");
    assert.deepEqual(readdirSync(tmp), before, "no engagement directory created");
  });

  it("refuses a still-running engagement — recorded ends only", async () => {
    const id = "eng-2026-11-01-fixture5";
    recordedEngagement(id, { status: "running" });
    const out = await tool("engagement_regenerate_report").run(store, { id });
    assert.equal(out.status, 409);
    assert.match(String((out.body as Record<string, unknown>)["error"]), /recorded end/);
  });
});
