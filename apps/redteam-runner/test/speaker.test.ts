/**
 * Speaker stamps (ui/speaker.ts) + the mergeVerdictBlock producer fix.
 *
 * The stamp derivations read ONLY execution-side records: the agent
 * loop's own reasoning events, the task runner's task_complete, and
 * finding producers stamped by the dispatch path. Covered here: the
 * seat map (runner/absent → no stamp), the loop-stamped restriction
 * (an asserted actor on any other action — e.g. the abort handler's
 * hardcoded coordinator — never stamps), the reporter-authorship
 * marker, per-finding producers, and the verdict-block merge stamping
 * the EXECUTING role the caller passes (a recon task's block stamps
 * recon — the base code stamped exploiter unconditionally).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  currentSeatSpeaker,
  findingSpeakers,
  reportAuthorSpeaker,
  speakerForActor,
} from "../src/ui/speaker.js";
import { mergeVerdictBlock } from "../src/dispatch/verdicts.js";
import type { Ctx, LiveFinding } from "../src/context.js";
import type { EngagementEvent, Finding } from "../src/types.js";

function ev(over: Partial<EngagementEvent>): EngagementEvent {
  return {
    seq: 1,
    ts: "2026-11-01T00:00:00Z",
    engagementId: "eng-test",
    phase: "exploit",
    actor: "runner",
    action: "reasoning",
    result: "",
    ...over,
  };
}

describe("speakerForActor", () => {
  it("maps every fleet seat to its cast name and chip role", () => {
    assert.deepEqual(speakerForActor("coordinator"), { name: "MORPHEUS", role: "lead" });
    assert.deepEqual(speakerForActor("recon"), { name: "OPERATOR", role: "recon" });
    assert.deepEqual(speakerForActor("exploiter"), { name: "NEO", role: "exploiter" });
    assert.deepEqual(speakerForActor("reporter"), { name: "ARCHITECT", role: "reporter" });
    assert.deepEqual(speakerForActor("architect"), { name: "ARCHITECT", role: "architect" });
  });

  it("names no speaker for engine records or absent actors", () => {
    assert.equal(speakerForActor("runner"), undefined);
    assert.equal(speakerForActor(undefined), undefined);
  });
});

describe("currentSeatSpeaker", () => {
  it("takes the actor of the LAST loop-stamped event", () => {
    const events = [
      ev({ seq: 1, actor: "coordinator", action: "reasoning" }),
      ev({ seq: 2, actor: "recon", action: "reasoning" }),
      ev({ seq: 3, actor: "exploiter", action: "task_complete" }),
      ev({ seq: 4, actor: "runner", action: "report_grade", phase: "report" }),
    ];
    assert.deepEqual(currentSeatSpeaker(events), { name: "NEO", role: "exploiter" });
  });

  it("ignores asserted actors on non-loop actions (the abort hardcode class)", () => {
    const events = [
      ev({ seq: 1, actor: "recon", action: "reasoning" }),
      // bookkeeping stamps abort_engagement 'coordinator' regardless of
      // the calling role — an asserted stamp, never speaker evidence.
      ev({ seq: 2, actor: "coordinator", action: "abort_engagement" }),
      ev({ seq: 3, actor: "coordinator", action: "task_spawn" }),
    ];
    assert.deepEqual(currentSeatSpeaker(events), { name: "OPERATOR", role: "recon" });
  });

  it("returns undefined when only runner-stamped loop actions exist", () => {
    assert.equal(currentSeatSpeaker([ev({ actor: "runner", action: "task_complete" })]), undefined);
    assert.equal(currentSeatSpeaker([]), undefined);
  });
});

describe("reportAuthorSpeaker", () => {
  it("stamps the reporter only when its loop reasoned in the report phase", () => {
    const events = [
      ev({ seq: 1, actor: "exploiter", action: "reasoning" }),
      ev({ seq: 2, actor: "reporter", action: "reasoning", phase: "report" }),
    ];
    assert.deepEqual(reportAuthorSpeaker(events), { name: "ARCHITECT", role: "reporter" });
  });

  it("names no author for a mechanical (halted/blocked) report", () => {
    const events = [
      ev({ seq: 1, actor: "exploiter", action: "reasoning" }),
      ev({ seq: 2, actor: "runner", action: "report_grade", phase: "report" }),
      // Reporter reasoning in a DIFFERENT phase is not report authorship.
      ev({ seq: 3, actor: "reporter", action: "reasoning", phase: "exploit" }),
    ];
    assert.equal(reportAuthorSpeaker(events), undefined);
  });
});

describe("findingSpeakers", () => {
  it("stamps from recorded producers and skips runner/absent", () => {
    const findings = [
      { id: "F-1", producer: "exploiter" },
      { id: "F-2", producer: "runner" },
      { id: "F-3" },
      { id: "F-4", producer: "recon" },
    ] as Finding[];
    assert.deepEqual(findingSpeakers(findings), {
      "F-1": { name: "NEO", role: "exploiter" },
      "F-4": { name: "OPERATOR", role: "recon" },
    });
  });
});

describe("mergeVerdictBlock producer stamping", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "speaker-verdicts-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function mergeAs(role: "recon" | "exploiter"): LiveFinding[] {
    const liveFindings: LiveFinding[] = [];
    const ctx = {
      liveFindings,
      killedLive: [],
      registryPath: join(tmp, "registry.json"),
      registry: { confirmed: [], killed: [] },
      fingerprint: {},
      events: {
        engagementId: "eng-test",
        append: () => {},
        updateState: () => {},
      },
    } as unknown as Ctx;
    const block =
      "verdicts:\n```json\n{\"verdicts\": [{\"kind\": \"confirmed\", \"severity\": \"high\", " +
      "\"vulnClass\": \"sqli\", \"attackId\": \"T1190\", \"evidence\": \"tautology reflected\", " +
      "\"payloadPattern\": \"' OR 1=1--\"}]}\n```";
    mergeVerdictBlock(ctx, block, role);
    return liveFindings;
  }

  it("stamps a recon task's VERDICTS block as recon, not exploiter", () => {
    const [f] = mergeAs("recon");
    assert.ok(f, "the confirmed verdict merged");
    assert.equal(f.producer, "recon");
  });

  it("stamps an exploiter task's VERDICTS block as exploiter", () => {
    const [f] = mergeAs("exploiter");
    assert.ok(f, "the confirmed verdict merged");
    assert.equal(f.producer, "exploiter");
  });
});
