/**
 * Native SecScan seam (secscan_exec).
 *
 * The dispatch handler fronts a byte-frozen vendored engine, so these
 * tests pin the seam's own decisions — never the engine's behavior:
 * the finding mapping is verbatim, depth is classified on the autonomy
 * ladder like scan_url's aggressive flag, the target host resolves for
 * the rate limiter, and the verification-gated deep depth refuses when
 * the engagement record carries no owner verification.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSecscanTools, scanVulnerabilityToFinding } from "../src/dispatch/secscan.js";
import { SECSCAN_EXEC_TOOL } from "../src/tools/secscan.js";
import { RECON_TOOLS } from "../src/tools/compose.js";
import { toolMinTier, isExploitStepTool } from "../src/accountability/tiers.js";
import { toolTargetHost } from "../src/dispatch/target-host.js";
import type { Ctx } from "../src/context.js";
import type { ScanVulnerability } from "#secscan/scanner.js";

function vuln(overrides: Partial<ScanVulnerability> = {}): ScanVulnerability {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Missing Content-Security-Policy",
    severity: "medium",
    category: "Security Headers",
    description: "The CSP header is absent.",
    evidence: "GET / → no content-security-policy response header",
    solution: "Add a CSP header.",
    ...overrides,
  };
}

/**
 * Minimal ctx. The refusal path reads only input.mode/roe +
 * verificationProof; the passive path additionally touches coverage
 * bookkeeping and probesUsed before it reaches the engine (whose own
 * egress guard refuses 127.0.0.1:9 instantly — no registry writes).
 */
function fakeCtx(verificationProof?: string): Ctx {
  return {
    input: { mode: "red", roe: {}, fullBattery: false },
    verificationProof,
    coverage: new Set(),
    targetCoverage: new Map(),
    probesUsed: 0,
    liveFindings: [],
    events: { engagementId: "secscan-seam-test", updateState: () => {}, append: () => {} },
  } as unknown as Ctx;
}

const CALL = { name: "secscan_exec" } as never;
const DEEP_ARGS = { url: "https://target.example", depth: "deep", category: "validation" };

describe("secscan seam — finding mapping", () => {
  it("carries severity, title, vuln class and evidence verbatim", () => {
    const f = scanVulnerabilityToFinding(vuln(), "T1190");
    assert.equal(f.severity, "medium");
    assert.equal(f.title, "Missing Content-Security-Policy");
    assert.equal(f.vulnClass, "Security Headers");
    assert.equal(f.evidence, "GET / → no content-security-policy response header");
    assert.equal(f.attackId, "T1190");
  });

  it("falls back to the description when the check recorded no evidence blob", () => {
    const f = scanVulnerabilityToFinding(vuln({ evidence: null }), "T1190");
    assert.equal(f.evidence, "The CSP header is absent.");
  });
});

describe("secscan seam — depth on the autonomy ladder", () => {
  it("classifies passive as Tier 0 and deep as Tier 1, mirroring scan_url", () => {
    assert.equal(toolMinTier("secscan_exec", {}), 0);
    assert.equal(toolMinTier("secscan_exec", { depth: "passive" }), 0);
    assert.equal(toolMinTier("secscan_exec", { depth: "deep" }), 1);
    assert.equal(isExploitStepTool("secscan_exec", { depth: "deep" }), true);
    assert.equal(isExploitStepTool("secscan_exec", { depth: "passive" }), false);
  });

  it("resolves the rate-limit target host from the url argument", () => {
    const host = toolTargetHost({ name: "secscan_exec", arguments: { url: "https://Target.Example:8443/path" } } as never);
    assert.equal(host, "target.example");
  });
});

describe("secscan seam — verification gate", () => {
  it("refuses depth=deep with no verification on the engagement record", async () => {
    const r = await handleSecscanTools(fakeCtx(undefined), "recon", "recon", CALL, DEEP_ARGS);
    assert.ok(r);
    assert.match(r.result, /^DENIED: secscan_exec depth=deep runs verification-gated web app tests/);
    assert.match(r.result, /Get verification from the owner/);
  });

  it("does not verification-refuse depth=passive (it fails later, at the engine, not the gate)", async () => {
    // The engine's own egress guard refuses 127.0.0.1:9 instantly, so a
    // passive call passes this gate and surfaces as an engine failure —
    // the assertion is only that the verification refusal did NOT fire.
    const r = await handleSecscanTools(fakeCtx(undefined), "recon", "recon", CALL, { url: "http://127.0.0.1:9", depth: "passive", category: "validation" });
    assert.ok(r);
    assert.doesNotMatch(r.result, /verification-gated/);
  });

  it("ignores other tools", async () => {
    const r = await handleSecscanTools(fakeCtx(undefined), "recon", "recon", { name: "http_probe" } as never, {});
    assert.equal(r, null);
  });
});

describe("secscan seam — tool surface", () => {
  it("states the verification gate in the tool description the agents read", () => {
    assert.match(SECSCAN_EXEC_TOOL.description, /verification-gated/);
    assert.match(SECSCAN_EXEC_TOOL.description, /REFUSES depth=deep when no verification is on record/);
  });

  it("is composed into the recon tool set with battery tagging", () => {
    const t = RECON_TOOLS.find((x) => x.name === "secscan_exec");
    assert.ok(t, "secscan_exec missing from RECON_TOOLS");
    const props = (t.parameters as { properties: Record<string, unknown> }).properties;
    assert.ok("batteryItem" in props, "batteryItem tagging missing");
    assert.ok("depth" in props && "url" in props);
  });
});
