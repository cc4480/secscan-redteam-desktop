/**
 * Spec §6: the engagement distress circuit breaker, and the distress
 * classifier's new signals. The auto-halt (autohalt.ts) already stopped
 * traffic to a buckling target; §6 adds the parts it did not have:
 * lockout/429 outcomes count as distress, every halt becomes a
 * preserved escalation record, an engagement with enough halted
 * targets reads as distressed overall, and — the rule with no
 * exceptions — a halted target resumes ONLY on a recorded
 * coordinator/human decision. No timer, no counter, no default.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TargetAutoHalt,
  clearDistressRecord,
  distressHalts,
  engagementDistressed,
  isTargetDistress,
  recordResumeDecision,
  registerDistressHalt,
  resumeTarget,
} from "../src/safety/index.js";

const ENG = "eng-distress-test";

describe("isTargetDistress — §6 signals", () => {
  it("classifies throttling and lockout outcomes as distress", () => {
    assert.equal(isTargetDistress("HTTP 429 from target"), true);
    assert.equal(isTargetDistress("probe returned status 429 Too Many Requests"), true);
    assert.equal(isTargetDistress("login failed: account locked after attempts"), true);
    assert.equal(isTargetDistress("too many failed login attempts — account temporarily locked"), true);
  });

  it("keeps clean negatives clean: a 404 or an auth denial is not distress", () => {
    assert.equal(isTargetDistress("HTTP 404 not found"), false);
    assert.equal(isTargetDistress("HTTP 403 forbidden — authentication required"), false);
    assert.equal(isTargetDistress("HALTED: target was auto-halted"), false);
  });

  it("keeps the original transport/5xx signals", () => {
    assert.equal(isTargetDistress("probe failed: connection refused"), true);
    assert.equal(isTargetDistress("HTTP 503 from target"), true);
  });
});

describe("distress circuit breaker", () => {
  it("registers halts once per host, in order, as the escalation record", () => {
    clearDistressRecord(ENG);
    const a = registerDistressHalt(ENG, "a.example", "5 consecutive distress outcomes");
    const b = registerDistressHalt(ENG, "b.example", "50% distress rate over last 20 outcomes");
    const dup = registerDistressHalt(ENG, "a.example", "a different later reason");
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
    assert.equal(dup, a);
    assert.deepEqual(
      distressHalts(ENG).map((h) => h.host),
      ["a.example", "b.example"],
    );
  });

  it("reports engagement-wide distress at the threshold of halted targets", () => {
    clearDistressRecord(ENG);
    registerDistressHalt(ENG, "a.example", "r");
    registerDistressHalt(ENG, "b.example", "r");
    assert.equal(engagementDistressed(ENG), false);
    registerDistressHalt(ENG, "c.example", "r");
    assert.equal(engagementDistressed(ENG), true);
  });

  it("refuses to resume a halted target without a recorded decision", () => {
    clearDistressRecord(ENG);
    const autoHalt = new TargetAutoHalt({ consecutiveThreshold: 1 });
    autoHalt.recordOutcome("a.example", true);
    assert.equal(autoHalt.isHalted("a.example"), true);
    registerDistressHalt(ENG, "a.example", "distress");
    assert.throws(() => resumeTarget(ENG, "a.example", autoHalt), /no resume decision on record/);
    assert.equal(autoHalt.isHalted("a.example"), true);
  });

  it("a recorded decision resumes the target, and is consumed by the resume", () => {
    clearDistressRecord(ENG);
    const autoHalt = new TargetAutoHalt({ consecutiveThreshold: 1 });
    autoHalt.recordOutcome("a.example", true);
    registerDistressHalt(ENG, "a.example", "distress");
    assert.throws(() => recordResumeDecision(ENG, "a.example", { by: "coordinator", rationale: "  " }), /no rationale/);
    recordResumeDecision(ENG, "a.example", { by: "human", rationale: "operator confirmed the service recovered and approved resuming" });
    const decision = resumeTarget(ENG, "a.example", autoHalt);
    assert.equal(decision.by, "human");
    assert.equal(autoHalt.isHalted("a.example"), false);
    assert.deepEqual(distressHalts(ENG), []);
    // The decision was consumed: a second resume attempt has nothing to stand on.
    assert.throws(() => resumeTarget(ENG, "a.example", autoHalt), /no resume decision on record/);
  });
});
