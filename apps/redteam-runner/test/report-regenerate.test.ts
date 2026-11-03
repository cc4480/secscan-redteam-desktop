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
    const dir = recordedEngagement(id, { status: "running" });
    // A live record that reports running is what "still running" means:
    // the run owns its report phase and must never be re-fired under it.
    store.register({ id, dir, status: "running", startedAt: "2026-11-01T08:00:00.000Z" });
    const out = await tool("engagement_regenerate_report").run(store, { id });
    assert.equal(out.status, 409);
    assert.match(String((out.body as Record<string, unknown>)["error"]), /recorded end/);
  });
});

/** A dead run: the process was killed before any close ran, so the
 * recorded status never became terminal (state starts at "authorizing"
 * and only the close paths write complete/halted/blocked), no report
 * artifacts exist, and the store holds no live record for it. */
function deadEngagement(id: string, over: { status?: string } = {}): string {
  const dir = join(tmp, id);
  mkdirSync(join(dir, "poc"), { recursive: true });
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      engagementId: id,
      target: "https://example.com",
      mode: "red",
      objective: "fixture assessment",
      status: over.status ?? "authorizing",
      phase: "exploit",
      verified: true,
      verificationProof: "Operator-attested ownership",
      plan: null,
      findings: FINDINGS,
      eventCount: 3,
      startedAt: "2026-11-02T08:00:00.000Z",
      updatedAt: "2026-11-02T08:05:00.000Z",
    }),
  );
  writeFileSync(
    join(dir, "events.jsonl"),
    [
      { seq: 1, ts: "2026-11-02T08:00:00.000Z", engagementId: id, phase: "authorize", actor: "runner", action: "authorized", result: "Ownership verified." },
      { seq: 2, ts: "2026-11-02T08:03:00.000Z", engagementId: id, phase: "exploit", actor: "exploiter", action: "probe", result: "Fixture flaw observed." },
      { seq: 3, ts: "2026-11-02T08:05:00.000Z", engagementId: id, phase: "exploit", actor: "runner", action: "finding_recorded", result: "F-1 recorded." },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  writeFileSync(
    join(dir, "poc", "F-1.json"),
    JSON.stringify({
      version: 1, bundleId: "bundle-F-1", engagementId: id, findingId: "F-1",
      attackIds: ["T1190"], severity: "high", title: "Fixture flaw",
      target: "https://example.com", operator: "Carlos", generatedAt: "2026-11-02T08:05:00.000Z",
      steps: [], validationTier: "observation",
      proves: "The fixture flaw responded as recorded.", doesNotProve: "No impact beyond the fixture.",
      reverifyCommand: "curl https://example.com",
    }),
  );
  return dir;
}

describe("dead engagements (S6-H5)", () => {
  it("engagement_report says the run ended without a report and names the repair tool", async () => {
    const id = "eng-2026-11-02-dead1";
    deadEngagement(id);
    const out = await tool("engagement_report").run(store, { id });
    assert.equal(out.status, 200);
    const b = out.body as Record<string, unknown>;
    assert.equal(b["ready"], false);
    assert.match(String(b["summary"]), /ended without a report/);
    assert.match(String(b["summary"]), /engagement_regenerate_report/);
    assert.doesNotMatch(String(b["summary"]), /Keep polling/);
  });

  it("engagement_report names the repair tool for a terminal end with no report either", async () => {
    const id = "eng-2026-11-02-dead2";
    deadEngagement(id, { status: "halted" });
    const out = await tool("engagement_report").run(store, { id });
    const b = out.body as Record<string, unknown>;
    assert.equal(b["ready"], false);
    assert.match(String(b["summary"]), /ended without a report/);
    assert.match(String(b["summary"]), /engagement_regenerate_report/);
  });

  it("regenerates a dead run into the full set with no grade, then reports ready", async () => {
    const id = "eng-2026-11-02-dead3";
    const dir = deadEngagement(id);
    const out = await tool("engagement_regenerate_report").run(store, { id });
    assert.equal(out.status, 200, String((out.body as Record<string, unknown>)["error"] ?? ""));
    const b = out.body as Record<string, unknown>;
    assert.equal(b["regenerated"], true);
    assert.equal(b["ok"], true);
    for (const name of DELIVERABLE_FILES) {
      assert.ok(existsSync(join(dir, name)), `${name} produced for the dead run`);
    }
    const model = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as ReportModel;
    assert.equal(model.status, "halted", "a dead run presents as an ended, uncompleted run");
    assert.equal(model.grade, null, "no completed-run grade is minted for a dead run");
    const txt = readFileSync(join(dir, "report.txt"), "utf8");
    assert.match(txt, /Grade: N\/A/);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    assert.match(md, /Grade N\/A/);
    const html = readFileSync(join(dir, "report.html"), "utf8");
    assert.match(html, /Incomplete/);
    assert.ok(html.includes("Fixture flaw"), "the recorded finding renders");
    const after = await tool("engagement_report").run(store, { id });
    assert.equal((after.body as Record<string, unknown>)["ready"], true);
  });

  it("a surviving 'complete' report model does not mint a grade for a dead run", async () => {
    const id = "eng-2026-11-02-dead5";
    const dir = deadEngagement(id);
    // report.json survived claiming a completed end, but the recorded
    // state never became terminal and no live run remains: the dead-end
    // admission must re-stamp it halted, not deliver its recorded grade.
    writeFileSync(join(dir, "report.json"), JSON.stringify(recordedModel(id), null, 2) + "\n");
    const out = await tool("engagement_regenerate_report").run(store, { id });
    assert.equal(out.status, 200, String((out.body as Record<string, unknown>)["error"] ?? ""));
    const model = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as ReportModel;
    assert.equal(model.status, "halted");
    assert.equal(model.grade, null);
  });

  it("a live running engagement still refuses regeneration and still reads as going", async () => {
    const id = "eng-2026-11-02-dead4";
    const dir = deadEngagement(id, { status: "running" });
    store.register({ id, dir, status: "running", startedAt: "2026-11-02T08:00:00.000Z" });
    const out = await tool("engagement_regenerate_report").run(store, { id });
    assert.equal(out.status, 409);
    const rep = await tool("engagement_report").run(store, { id });
    const b = rep.body as Record<string, unknown>;
    assert.equal(b["ready"], false);
    assert.match(String(b["summary"]), /Keep polling/);
    assert.doesNotMatch(String(b["summary"]), /engagement_regenerate_report/);
  });
});
