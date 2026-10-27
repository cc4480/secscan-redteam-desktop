/**
 * Duplicate-call guard tests (PentAGI alignment A1).
 *
 * The guard refuses an identical repeat of a target-traffic call that
 * already completed, and refuses a third identical attempt after two
 * failures. No engagement, no network: the guard functions run against a
 * minimal ctx whose event log is captured in memory.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { duplicateRefusal, recordCallOutcome } from "../src/dispatch/duplicate-guard.js";
import { type Ctx } from "../src/context.js";
import { type ActorRole, type EngagementPhase } from "../src/types.js";
import { type ToolCallRequest } from "@secscan/redteam-llm-router";

const ROLE = "recon" as ActorRole;
const PHASE = "recon" as EngagementPhase;
const HOST = "lab.local";

function fakeCtx() {
  const appended: Array<{ action: string; result: string }> = [];
  const ctx = {
    events: {
      append: (e: { action: string; result: string }) => {
        appended.push({ action: e.action, result: e.result });
      },
    },
  } as unknown as Ctx;
  return { ctx, appended };
}

function probe(args: Record<string, unknown>): ToolCallRequest {
  return { id: "call-1", name: "http_probe", arguments: args };
}

const CLEAN = { result: "200 OK — server banner Apache/2.4", ok: true };
const FAILED = { result: "probe failed: connection refused", ok: false };

describe("duplicate guard", () => {
  it("lets a first call execute, then refuses the identical repeat with the previous digest", () => {
    const { ctx, appended } = fakeCtx();
    const call = probe({ url: "http://lab.local/admin" });
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, call, HOST), undefined);
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, CLEAN);
    const refusal = duplicateRefusal(ctx, ROLE, PHASE, call, HOST);
    assert.ok(refusal);
    assert.match(refusal.result, /^DENIED: duplicate call refused/);
    assert.match(refusal.result, /Apache\/2\.4/);
    assert.equal(refusal.ok, false);
    assert.equal(refusal.target, HOST);
    assert.deepEqual(appended.map((e) => e.action), ["duplicate_refused"]);
  });

  it("treats argument key order as the same call", () => {
    const { ctx } = fakeCtx();
    recordCallOutcome(ctx, ROLE, PHASE, probe({ url: "http://lab.local/", method: "GET" }), HOST, CLEAN);
    const refusal = duplicateRefusal(ctx, ROLE, PHASE, probe({ method: "GET", url: "http://lab.local/" }), HOST);
    assert.ok(refusal);
  });

  it("lets a different call execute after a recorded one", () => {
    const { ctx } = fakeCtx();
    recordCallOutcome(ctx, ROLE, PHASE, probe({ url: "http://lab.local/a" }), HOST, CLEAN);
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, probe({ url: "http://lab.local/b" }), HOST), undefined);
  });

  it("allows one retry of a failed call and refuses the third identical attempt", () => {
    const { ctx } = fakeCtx();
    const call = probe({ url: "http://lab.local/flaky" });
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, FAILED);
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, call, HOST), undefined);
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, FAILED);
    const refusal = duplicateRefusal(ctx, ROLE, PHASE, call, HOST);
    assert.ok(refusal);
    assert.match(refusal.result, /already\s+failed 2 times/);
  });

  it("a clean result after a failure makes the repeat a completed-duplicate", () => {
    const { ctx } = fakeCtx();
    const call = probe({ url: "http://lab.local/retry" });
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, FAILED);
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, CLEAN);
    const refusal = duplicateRefusal(ctx, ROLE, PHASE, call, HOST);
    assert.ok(refusal);
    assert.match(refusal.result, /already\s+completed/);
  });

  it("scopes the guard by role and by phase", () => {
    const { ctx } = fakeCtx();
    const call = probe({ url: "http://lab.local/admin" });
    recordCallOutcome(ctx, ROLE, PHASE, call, HOST, CLEAN);
    assert.equal(duplicateRefusal(ctx, "exploiter" as ActorRole, PHASE, call, HOST), undefined);
    assert.equal(duplicateRefusal(ctx, ROLE, "exploit" as EngagementPhase, call, HOST), undefined);
  });

  it("never guards calls without a target host", () => {
    const { ctx, appended } = fakeCtx();
    const call = probe({ url: "http://lab.local/admin" });
    recordCallOutcome(ctx, ROLE, PHASE, call, undefined, CLEAN);
    assert.equal(duplicateRefusal(ctx, ROLE, PHASE, call, undefined), undefined);
    assert.deepEqual(appended, []);
  });
});
