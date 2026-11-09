/**
 * Report grading seam — the report's grading voice.
 *
 * Pins the seam's own decisions (report/grading.ts over the local
 * posture scoring in report/posture.ts): the finding mapping carries
 * severity and title verbatim, only CONFIRMED findings are graded,
 * and the anchored caps bind — one confirmed critical caps the score
 * at 20, one confirmed high at 45.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gradeFindings, runnerFindingToPostureFinding } from "../src/report/grading.js";
import type { Finding } from "../src/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F-1",
    severity: "medium",
    title: "A finding",
    attackIds: ["T1190"],
    evidence: "receipt text",
    fix: "fix it",
    retest: "retest it",
    status: "confirmed",
    ...overrides,
  };
}

describe("grading seam — the report's grading voice", () => {
  it("maps a runner finding onto the scoring input verbatim", () => {
    const m = runnerFindingToPostureFinding(finding({ severity: "high", title: "T" }));
    assert.equal(m.severity, "high");
    assert.equal(m.title, "T");
  });

  it("anchors the grade: one confirmed critical caps the score at 20 (F)", () => {
    const p = gradeFindings([finding({ severity: "critical" })]);
    assert.equal(p.score, 20);
    assert.equal(p.grade, "F");
    assert.equal(p.confirmedCount, 1);
  });

  it("grades a clean engagement 100/A and ignores killed + deferred findings", () => {
    const clean = gradeFindings([]);
    assert.equal(clean.score, 100);
    assert.equal(clean.grade, "A");
    const mixed = gradeFindings([
      finding({ severity: "critical", status: "killed" }),
      finding({ severity: "critical", status: "deferred", id: "F-2" }),
    ]);
    assert.equal(mixed.score, 100);
    assert.equal(mixed.activeCount, 0);
  });

  it("deducts full weight for confirmed findings (high = 25 off)", () => {
    const p = gradeFindings([finding({ severity: "high" })]);
    assert.equal(p.score, 45); // 100 - 25, then the confirmed-high cap of 45 binds equally
    assert.equal(p.grade, "F");
  });
});
