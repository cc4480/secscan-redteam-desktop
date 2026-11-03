/**
 * S3-H6 — `verifiedScope` persistence (slice 3, Hop 6).
 *
 * The AUTHORIZE phase stamps its attestation output — the raw ROE scope
 * entries whose hosts passed authorization — onto the in-memory Ctx
 * (`ctx.verifiedScope`), and the scope guard derives its allow set from
 * that record. Before this fix the stamp never reached the persisted
 * record: `LiveState` / state.json carried `verified`,
 * `verificationTs` and `verificationProof`, but no `verifiedScope`, so
 * the attested host list existed only in RAM. Anything governing from
 * the persisted record — or a relaunch whose ROE differs from what was
 * attested — fell back to the general ROE path, whose allow set for a
 * bare hostname is EMPTY (deny-all): the audit's probe3 built a guard
 * for ROE ["Cho-zen1"] without the stamp and got `allow: empty`,
 * checkHost("cho-zen1") denied.
 *
 * These tests drive the real authorize phase over a real EventLog and
 * pin, in order:
 *  - both authorize success paths (normal and test mode) persist
 *    `verifiedScope` into state.json, beside the proof;
 *  - a scope guard rebuilt from the PERSISTED record (readState →
 *    scopeGuardFor, the probe3 shape) allows the attested bare
 *    hostname — the deny-all reproduction on the pre-fix tree;
 *  - persistence widens nothing: a pre-fix state.json WITHOUT
 *    `verifiedScope` (the or12 record shape) still yields the old
 *    deny-all fallback, and a deny entry still beats the persisted
 *    allow when the guard is rebuilt from state.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog, readState } from "../src/events.js";
import { authorizePhase } from "../src/phases/authorize.js";
import { scopeGuardFor } from "../src/safety/scope-guard.js";
import type { Ctx } from "../src/context.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "verified-scope-persist-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/**
 * A context over a REAL EventLog in `dir`, shaped like the scope-guard
 * suite's authorize fixtures: the attested-record default path (no
 * injected verifier, no service opt-in), so authorize stamps from the
 * engagement record itself.
 */
function authorizeCtx(
  dir: string,
  opts: { testMode?: boolean; scope: string[]; hosts: string[]; domain: string; outOfScope?: string[] },
): Ctx {
  const events = new EventLog(dir, "eng-verified-scope", {
    target: opts.domain,
    mode: "red",
    objective: "verified-scope persistence proof",
  });
  return {
    domain: opts.domain,
    hosts: opts.hosts,
    input: {
      mode: "red",
      objective: "verified-scope persistence proof",
      operatorName: "Test Operator",
      roe: { scope: opts.scope, outOfScope: opts.outOfScope ?? [] },
    },
    config: { testMode: opts.testMode ?? false, verifyViaService: false, mcpEndpoint: "", mcpToken: "", localSandbox: false },
    deps: {},
    events,
  } as unknown as Ctx;
}

describe("S3-H6 — authorize persists the attested scope into state.json", () => {
  it("normal path: state.json carries verifiedScope with the attested bare hostname", async () => {
    const dir = tempDir();
    const ctx = authorizeCtx(dir, { scope: ["Cho-zen1"], hosts: ["cho-zen1"], domain: "cho-zen1" });

    const verdict = await authorizePhase(ctx);
    assert.equal(verdict.allowed, true);
    assert.deepEqual(ctx.verifiedScope, ["Cho-zen1"]);

    const state = readState(dir);
    assert.ok(state, "state.json is readable after authorize");
    assert.equal(state.verified, true);
    assert.deepEqual(state.verifiedScope, ["Cho-zen1"], "the persisted record carries the attested host list");
    assert.ok(
      readFileSync(join(dir, "state.json"), "utf8").includes('"verifiedScope"'),
      "the raw state.json mentions verifiedScope (audit probe3 check)",
    );
  });

  it("test-mode path: the second success-path updateState also persists verifiedScope", async () => {
    const dir = tempDir();
    const ctx = authorizeCtx(dir, {
      testMode: true,
      scope: ["example.com", "192.168.1.10"],
      hosts: ["example.com", "192.168.1.10"],
      domain: "example.com",
    });

    const verdict = await authorizePhase(ctx);
    assert.equal(verdict.allowed, true);

    const state = readState(dir);
    assert.ok(state, "state.json is readable after test-mode authorize");
    assert.deepEqual(state.verifiedScope, ["example.com", "192.168.1.10"]);
  });
});

describe("S3-H6 — a guard rebuilt from the persisted record", () => {
  it("allows the attested bare hostname (probe3: without the stamp this is allow: empty, denied)", async () => {
    const dir = tempDir();
    const ctx = authorizeCtx(dir, { scope: ["Cho-zen1"], hosts: ["cho-zen1"], domain: "cho-zen1" });
    await authorizePhase(ctx);

    // Rebuild from the persisted record alone: the stamp is re-seeded
    // from readState(dir), exactly as a record reader must do — the
    // in-memory ctx from the original process is not consulted.
    const persisted = readState(dir);
    assert.ok(persisted);
    const rebuilt = scopeGuardFor({
      verifiedScope: persisted.verifiedScope,
      input: { roe: { scope: ["Cho-zen1"], outOfScope: [] } },
    });
    assert.equal(rebuilt.checkHost("cho-zen1").allowed, true, "the attested bare host is allowed from the persisted record");
    assert.notEqual(rebuilt.describe(), "allow: empty · deny: empty");

    // Control: the same launch ROE with NO persisted stamp is the
    // audit's deny-all reproduction — the general path drops the bare
    // hostname and the guard allows nothing.
    const unstamped = scopeGuardFor({ input: { roe: { scope: ["Cho-zen1"], outOfScope: [] } } });
    assert.equal(unstamped.checkHost("cho-zen1").allowed, false);
    assert.equal(unstamped.describe(), "allow: empty · deny: empty");
  });

  it("deny still beats allow when the guard is rebuilt from state", async () => {
    const dir = tempDir();
    const ctx = authorizeCtx(dir, { scope: ["Cho-zen1"], hosts: ["cho-zen1"], domain: "cho-zen1" });
    await authorizePhase(ctx);

    const persisted = readState(dir);
    assert.ok(persisted);
    const rebuilt = scopeGuardFor({
      verifiedScope: persisted.verifiedScope,
      input: { roe: { scope: ["Cho-zen1"], outOfScope: ["Cho-zen1"] } },
    });
    const verdict = rebuilt.checkHost("cho-zen1");
    assert.equal(verdict.allowed, false, "the deny entry wins over the persisted allow");
    assert.equal(verdict.kind, "deny");
  });
});

describe("S3-H6 — persistence widens nothing for pre-fix records", () => {
  it("a state.json WITHOUT verifiedScope (or12 shape) still yields the old deny-all fallback", () => {
    const dir = tempDir();
    // The or12 record shape: proof persisted, attested list absent.
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        engagementId: "eng-or12-shape",
        target: "http://127.0.0.1:8080",
        mode: "red",
        objective: "pre-fix record",
        status: "running",
        phase: "recon",
        verified: true,
        verificationTs: "2026-11-02T00:00:00.000Z",
        verificationProof: "Operator-attested ownership: fixture",
        plan: null,
        findings: [],
        eventCount: 3,
        startedAt: "2026-11-02T00:00:00.000Z",
        updatedAt: "2026-11-02T00:00:00.000Z",
      }),
    );

    const state = readState(dir);
    assert.ok(state, "the pre-fix record still parses");
    assert.equal(state.verifiedScope, undefined, "no attested list is invented for a pre-fix record");

    const guard = scopeGuardFor({
      verifiedScope: state.verifiedScope,
      input: { roe: { scope: ["Cho-zen1"], outOfScope: [] } },
    });
    assert.equal(guard.checkHost("cho-zen1").allowed, false, "old behavior preserved: bare hostname denied without a stamp");
    assert.equal(guard.describe(), "allow: empty · deny: empty");
  });
});
