/**
 * Native Seclayer seams (seclayer_* tools + the grading seam).
 *
 * The dispatch handlers front byte-frozen vendored modules, so these
 * tests pin the seams' own decisions — never the modules' internals:
 * the finding mapping is verbatim, every tool sits at Tier 1 on the
 * autonomy ladder and counts as an exploit step, the target host
 * resolves for the rate limiter, every tool refuses without owner
 * verification on the engagement record, and the report grade comes
 * from the Seclayer anchored scoring math over confirmed findings
 * only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSeclayerTools, seclayerFindingToLive, type RawSeclayerFinding } from "../src/dispatch/seclayer.js";
import { handleSeclayerDastTool } from "../src/dispatch/seclayer-dast.js";
import { SECLAYER_TOOLS } from "../src/tools/seclayer.js";
import { EXPLOIT_TOOLS } from "../src/tools/compose.js";
import { toolMinTier, isExploitStepTool } from "../src/accountability/tiers.js";
import { toolTargetHost } from "../src/dispatch/target-host.js";
import { gradeFindings, runnerFindingToSeclayerFinding } from "../src/report/grading.js";
import type { Ctx } from "../src/context.js";
import type { Finding } from "../src/types.js";

const TOOL_NAMES = ["seclayer_redteam", "seclayer_bola", "seclayer_api", "seclayer_webhook", "seclayer_dast", "seclayer_aggressive"];

function fakeCtx(verificationProof?: string): Ctx {
  return {
    input: { mode: "red", roe: {}, fullBattery: false },
    verificationProof,
    coverage: new Set(),
    targetCoverage: new Map(),
    probesUsed: 0,
    liveFindings: [],
    fingerprint: "seam-test-target",
    registryPath: join(mkdtempSync(join(tmpdir(), "seclayer-seam-")), "registry.json"),
    registry: { confirmed: [], killed: [] },
    events: { engagementId: "seclayer-seam-test", updateState: () => {}, append: () => {} },
  } as unknown as Ctx;
}

const ARGS = { url: "https://target.example", category: "validation" };

describe("seclayer seam — finding mapping", () => {
  it("carries severity, test name, payload and the demonstrated receipt verbatim", () => {
    const raw: RawSeclayerFinding = {
      testName: "SQL Injection (error-based)",
      payload: "id='",
      severity: "critical",
      description: "desc",
      evidence: { demonstration: "We injected and the row came back.", signal: { quote: "ORA-01756" } },
    };
    const f = seclayerFindingToLive(raw, "T1190", "redteam-probe");
    assert.equal(f.severity, "critical");
    assert.equal(f.title, "SQL Injection (error-based)");
    assert.equal(f.vulnClass, "redteam-probe");
    assert.equal(f.payload, "id='");
    assert.equal(f.evidence, "We injected and the row came back. Signal: ORA-01756");
    assert.equal(f.attackId, "T1190");
  });

  it("falls back to the description when a finding carries no receipt", () => {
    const f = seclayerFindingToLive({ testName: "X", severity: "low", description: "only a description" }, undefined, "csrf");
    assert.equal(f.evidence, "only a description");
    assert.equal(f.attackId, "T1190");
  });
});

describe("seclayer seam — autonomy ladder", () => {
  it("classifies every seclayer tool as a Tier 1 exploit step", () => {
    for (const name of TOOL_NAMES) {
      assert.equal(toolMinTier(name, {}), 1, name);
      assert.equal(isExploitStepTool(name, {}), true, name);
    }
  });

  it("resolves the rate-limit target host from the url argument", () => {
    const host = toolTargetHost({ name: "seclayer_redteam", arguments: { url: "https://Target.Example:8443/app" } } as never);
    assert.equal(host, "target.example");
  });
});

describe("seclayer seam — verification gate", () => {
  it("refuses every tool with no verification on the engagement record", async () => {
    for (const name of ["seclayer_redteam", "seclayer_bola", "seclayer_api", "seclayer_webhook", "seclayer_aggressive"]) {
      const r = await handleSeclayerTools(fakeCtx(undefined), "exploiter", "exploit", { name } as never, { ...ARGS, probe: "ssti" });
      assert.ok(r, name);
      assert.match(r.result, /DENIED: .* runs verification-gated web app tests/, name);
      assert.match(r.result, /Get verification from the owner/, name);
    }
    const r = await handleSeclayerDastTool(fakeCtx(undefined), "exploiter", "exploit", { name: "seclayer_dast" } as never, { ...ARGS, probe: "csrf" });
    assert.ok(r);
    assert.match(r.result, /verification-gated/);
  });

  it("does not verification-refuse with verification on record (the probe runs and reports)", async () => {
    // csrf posture assessment over empty captured data: passes the gate,
    // runs the module, records nothing — the assertion is that the
    // verification refusal did NOT fire.
    const ctx = fakeCtx("owner verified via authorize phase");
    const r = await handleSeclayerDastTool(ctx, "exploiter", "exploit", { name: "seclayer_dast" } as never, { ...ARGS, probe: "csrf", cookieLines: [], forms: [] });
    assert.ok(r);
    assert.doesNotMatch(r.result, /verification-gated/);
    assert.match(r.result, /0 findings/);
  });

  it("records a module finding end-to-end (deserialization marker in a cookie)", async () => {
    const ctx = fakeCtx("owner verified via authorize phase");
    const cookie = "session=rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcA==; Path=/; HttpOnly";
    const r = await handleSeclayerDastTool(ctx, "exploiter", "exploit", { name: "seclayer_dast" } as never, { ...ARGS, probe: "deserialization", cookieLines: [cookie] });
    assert.ok(r);
    assert.match(r.result, /1 finding\(s\) recorded/);
    assert.equal(ctx.liveFindings.length, 1);
    assert.equal(ctx.liveFindings[0]?.vulnClass, "deserialization");
    assert.equal(ctx.registry.confirmed.length, 1);
  });

  it("ignores other tools", async () => {
    const r = await handleSeclayerTools(fakeCtx(undefined), "exploiter", "exploit", { name: "http_probe" } as never, {});
    assert.equal(r, null);
  });
});

describe("seclayer seam — tool surface", () => {
  it("states the verification gate in every tool description the agents read", () => {
    for (const t of SECLAYER_TOOLS) {
      assert.match(t.description, /VERIFICATION-GATED/, t.name);
      assert.match(t.description, /REFUSES/, t.name);
    }
  });

  it("composes all six tools into the exploit tool set with battery tagging", () => {
    for (const name of TOOL_NAMES) {
      const t = EXPLOIT_TOOLS.find((x) => x.name === name);
      assert.ok(t, `${name} missing from EXPLOIT_TOOLS`);
      const props = (t.parameters as { properties: Record<string, unknown> }).properties;
      assert.ok("batteryItem" in props, `${name} batteryItem tagging missing`);
    }
  });
});

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

describe("seclayer grading seam — the report's grading voice", () => {
  it("maps a runner finding onto the scoring input verbatim, confidence unset", () => {
    const m = runnerFindingToSeclayerFinding(finding({ severity: "high", title: "T", evidence: "E", fix: "F" }));
    assert.equal(m.severity, "high");
    assert.equal(m.title, "T");
    assert.equal(m.description, "E");
    assert.equal(m.fix, "F");
    assert.equal(m.confidence, undefined);
    assert.equal(m.evidence, undefined);
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
