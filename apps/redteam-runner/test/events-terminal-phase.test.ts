/**
 * Terminal-phase guard (S2-H10): EventLog.writeEvent used to assign
 * state.phase from EVERY appended event, so the bookkeeping events that
 * land after a terminal close — the halt path's report events, then the
 * finally block's trajectory capture with its hardcoded phase "done" —
 * overwrote a halted run's phase first to "report" and finally to
 * "done", indistinguishable by phase from a completed run (or12's real
 * record: status "halted", phase "done"). The audit probe shaped these
 * tests: stamp the terminal state via updateState (exactly as run.ts
 * does, before the trailing events), append trailing events, and read
 * state.json back.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog, readEvents } from "../src/events.js";
import type { LiveState } from "../src/events.js";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "events-terminal-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeLog(id: string): { dir: string; log: EventLog } {
  const dir = join(tmp, id);
  const log = new EventLog(dir, id, { target: "http://127.0.0.1:8080", mode: "red", objective: "probe" });
  return { dir, log };
}

function stateOnDisk(dir: string): LiveState {
  return JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as LiveState;
}

describe("writeEvent phase guard", () => {
  it("keeps a halted run's phase at halted through report and done trailing events", () => {
    const { dir, log } = makeLog("eng-halted");
    // run.ts catch: the halt stamp lands via updateState BEFORE the
    // mechanical report and the finally block's trajectory capture.
    log.updateState({ status: "halted", phase: "halted", blockedReason: "coordinator withheld sign-off" });
    log.append({ phase: "report", actor: "runner", action: "report_json_written", result: "report.json written (0 findings, status halted)." });
    log.append({ phase: "done", actor: "runner", action: "foundry_capture", result: "Foundry capture: 0 case(s) added" });
    const st = stateOnDisk(dir);
    assert.equal(st.status, "halted");
    assert.equal(st.phase, "halted");
    // The events themselves are still appended and persisted exactly as
    // before — only the state phase assignment is skipped.
    const events = readEvents(dir);
    assert.equal(events.length, 2);
    assert.equal(events[1]?.phase, "done");
    assert.equal(st.eventCount, 2);
  });

  it("keeps a blocked run's phase through trailing events", () => {
    const { dir, log } = makeLog("eng-blocked");
    log.updateState({ status: "blocked", phase: "blocked", blockedReason: "ownership not verified" });
    log.append({ phase: "report", actor: "runner", action: "report_json_written", result: "blocked report written." });
    log.append({ phase: "done", actor: "runner", action: "foundry_capture", result: "Foundry capture: 0 case(s) added" });
    const st = stateOnDisk(dir);
    assert.equal(st.status, "blocked");
    assert.equal(st.phase, "blocked");
  });

  it("keeps the blocked phase run.ts actually stamps (report) through the finally capture", () => {
    const { dir, log } = makeLog("eng-blocked-report");
    // run.ts's blocked branch stamps phase "report" (the blocked end
    // goes straight to its mechanical report) — that stamp, not "done",
    // is what the record must keep.
    log.updateState({ status: "blocked", phase: "report", blockedReason: "ownership not verified" });
    log.append({ phase: "done", actor: "runner", action: "foundry_capture", result: "Foundry capture: 0 case(s) added" });
    const st = stateOnDisk(dir);
    assert.equal(st.status, "blocked");
    assert.equal(st.phase, "report");
  });

  it("keeps a complete run's phase at done even when a trailing event carries another phase", () => {
    const { dir, log } = makeLog("eng-complete");
    // run.ts stamps complete/done BEFORE the scribe-gate event, which
    // itself carries phase "report".
    log.updateState({ status: "complete", phase: "done" });
    log.append({ phase: "report", actor: "runner", action: "scribe_gate_outcome", result: "Scribe gate outcome: signed after 1 review cycle(s)." });
    const st = stateOnDisk(dir);
    assert.equal(st.status, "complete");
    assert.equal(st.phase, "done");
  });

  it("still moves the phase with events on a live (non-terminal) run", () => {
    const { dir, log } = makeLog("eng-live");
    log.append({ phase: "recon", actor: "recon", action: "scan", result: "recon running" });
    assert.equal(stateOnDisk(dir).phase, "recon");
    log.updateState({ status: "running" });
    log.append({ phase: "report", actor: "reporter", action: "report_grade", result: "drafting" });
    const st = stateOnDisk(dir);
    assert.equal(st.status, "running");
    assert.equal(st.phase, "report");
  });
});
