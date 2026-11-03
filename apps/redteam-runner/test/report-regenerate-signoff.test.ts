/**
 * S6-H2c — regeneration must not drop the Scribe signoff stamp.
 *
 * At a completed close the Scribe gate stamps exactly one of
 * artifactSignoff / artifactUnsigned into state.json AND report.json
 * and re-fires the package zip so the shipped copy carries it.
 * Regeneration rebuilds report.json from scratch (buildReportModel
 * carries no signoff fields), so before this fix a recorded SIGNED
 * set regenerated UNSIGNED in report.json — and in the zip — while
 * state.json still claimed the stamp. The recorded stamp must be
 * carried forward into the regenerated report.json and the
 * regenerated package; a record with no stamp must gain none.
 *
 * Fixtures are hand-recorded engagement directories in the shape of
 * test/report-regenerate.test.ts (state.json + report.md + a stamped
 * report.json + a poc bundle), driven through regenerateReport
 * directly — the function engagement_regenerate_report calls.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strFromU8, unzipSync } from "fflate";
import { readState, type ArtifactSignoff, type ArtifactUnsigned } from "../src/events.js";
import { regenerateReport } from "../src/report/regenerate.js";
import { verifyDeliverables, type ReportModel } from "../src/report/deliverables.js";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "regen-signoff-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

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

const SIGNOFF: ArtifactSignoff = { by: "scribe", at: "2026-11-01T09:30:00.000Z", cycles: 2 };

const UNSIGNED: ArtifactUnsigned = {
  reason: "defects",
  defects: [{ file: "report.md", class: "accuracy", detail: "Fixture defect of record.", fix: "Re-render the fixture counts." }],
  cycles: 2,
  at: "2026-11-01T09:30:00.000Z",
};

function recordedModel(id: string, over: { status?: string } = {}): ReportModel {
  const halted = over.status === "halted";
  return {
    kind: "secscan-redteam-report",
    version: 1,
    engagementId: id,
    target: "https://example.com",
    mode: "red",
    objective: "fixture assessment",
    status: halted ? "halted" : "complete",
    ...(halted ? { reason: "fixture halt" } : {}),
    dryRun: false,
    generatedAt: "2026-11-01T09:00:00.000Z",
    grade: halted ? null : { letter: "C", score: 72, rating: "Fair" },
    severityCounts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    findingCount: 1,
    batteryTotals: { total: 3, confirmed: 1, executedClean: 2, killed: 0, blocked: 0, na: 0, pending: 0 },
    coverageCells: [],
    findings: FINDINGS as ReportModel["findings"],
  };
}

/** A recorded engagement whose state AND report.json both carry the
 * given Scribe stamp (the shape a signed/unsigned close leaves), with
 * an incomplete deliverable set so regeneration has work to do. */
function stampedEngagement(
  id: string,
  stamp: { artifactSignoff?: ArtifactSignoff | null; artifactUnsigned?: ArtifactUnsigned | null },
  over: { status?: string } = {},
): string {
  const dir = join(tmp, id);
  mkdirSync(join(dir, "poc"), { recursive: true });
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
      deliverableFailed: true,
      deliverables: { "report.md": join(dir, "report.md") },
      ...stamp,
    }),
  );
  writeFileSync(join(dir, "report.md"), REPORT_MD);
  writeFileSync(
    join(dir, "report.json"),
    JSON.stringify({ ...recordedModel(id, over), ...stamp }, null, 2) + "\n",
  );
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

function looseModel(dir: string): ReportModel {
  return JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as ReportModel;
}

function packagedModel(dir: string): ReportModel {
  const zip = unzipSync(readFileSync(join(dir, "report-package.zip")));
  const entry = zip["report.json"];
  assert.ok(entry, "the regenerated package carries report.json");
  return JSON.parse(strFromU8(entry)) as ReportModel;
}

describe("regeneration carries the recorded Scribe stamp (S6-H2c)", () => {
  it("a recorded artifactSignoff survives regeneration in report.json and in the package zip", () => {
    const id = "eng-2026-11-01-signoff1";
    const dir = stampedEngagement(id, { artifactSignoff: SIGNOFF, artifactUnsigned: null });
    const outcome = regenerateReport(dir);
    assert.equal(outcome.ok, true);
    assert.equal(verifyDeliverables(dir).ok, true);
    const loose = looseModel(dir);
    assert.deepEqual(loose.artifactSignoff, SIGNOFF, "regenerated report.json carries the recorded signoff");
    assert.equal(loose.artifactUnsigned, null);
    const packaged = packagedModel(dir);
    assert.deepEqual(packaged.artifactSignoff, SIGNOFF, "the zip's report.json carries the recorded signoff");
    assert.equal(packaged.artifactUnsigned, null);
    assert.deepEqual(readState(dir)?.artifactSignoff, SIGNOFF, "state.json still carries the stamp — the records agree");
  });

  it("a recorded artifactUnsigned survives regeneration in report.json and in the package zip", () => {
    const id = "eng-2026-11-01-unsigned1";
    const dir = stampedEngagement(id, { artifactSignoff: null, artifactUnsigned: UNSIGNED });
    const outcome = regenerateReport(dir);
    assert.equal(outcome.ok, true);
    const loose = looseModel(dir);
    assert.deepEqual(loose.artifactUnsigned, UNSIGNED, "regenerated report.json carries the recorded unsigned stamp");
    assert.equal(loose.artifactSignoff, null);
    const packaged = packagedModel(dir);
    assert.deepEqual(packaged.artifactUnsigned, UNSIGNED, "the zip's report.json carries the recorded unsigned stamp");
    assert.equal(packaged.artifactSignoff, null);
    assert.deepEqual(readState(dir)?.artifactUnsigned, UNSIGNED);
  });

  it("a halted record carrying a signoff in state keeps it through regeneration", () => {
    const id = "eng-2026-11-01-signoff-halted";
    const dir = stampedEngagement(id, { artifactSignoff: SIGNOFF, artifactUnsigned: null }, { status: "halted" });
    const outcome = regenerateReport(dir);
    assert.equal(outcome.ok, true);
    const loose = looseModel(dir);
    assert.equal(loose.status, "halted");
    assert.equal(loose.grade, null, "a halted regeneration still issues no grade");
    assert.deepEqual(loose.artifactSignoff, SIGNOFF);
    assert.deepEqual(packagedModel(dir).artifactSignoff, SIGNOFF);
  });

  it("a record with no stamp regenerates with no signoff keys added — loose or packaged", () => {
    const id = "eng-2026-11-01-nostamp1";
    const dir = stampedEngagement(id, {});
    const outcome = regenerateReport(dir);
    assert.equal(outcome.ok, true);
    assert.ok(existsSync(join(dir, "report.json")));
    const loose = looseModel(dir);
    assert.equal("artifactSignoff" in loose, false, "no spurious artifactSignoff key");
    assert.equal("artifactUnsigned" in loose, false, "no spurious artifactUnsigned key");
    const packaged = packagedModel(dir);
    assert.equal("artifactSignoff" in packaged, false, "no spurious artifactSignoff key in the zip");
    assert.equal("artifactUnsigned" in packaged, false, "no spurious artifactUnsigned key in the zip");
  });
});
