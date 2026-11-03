/**
 * Q-RP-11 — the local-host entry surface: the chat tool
 * (engagement_launch_local), the launch-body builders, and the /pcscan
 * CLI input. The collector is stubbed at the artifact seam (see
 * host-inventory.test.ts); here the pins are that a local launch can
 * only ever name THIS machine, carries the localHost marker through
 * every surface, and cannot be re-aimed at a remote target.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Import order matters: the tool registry (mcp-tools) loads first —
// the same registry-first order engagement-tools.test.ts uses and the
// order every production entry (mcp-endpoint, ui server) loads the
// ui module graph in.
import { TOOLS, TOOLS_BY_NAME } from "../src/ui/mcp-tools.js";
import { buildLaunchBody } from "../src/ui/engagement-tools.js";
import { buildLocalLaunchBody, LOCAL_TOOLS } from "../src/ui/local-tools.js";
import { EXEC_TOOLS } from "../src/ui/mcp-exec.js";
import { buildLocalEngagementInput, parseCommand, planCommand } from "../src/workflows/commands.js";

/** Narrow a launch build to its body, failing loudly when it refused. */
function bodyOf(
  r: ReturnType<typeof buildLocalLaunchBody>,
): Extract<ReturnType<typeof buildLocalLaunchBody>, { body: unknown }>["body"] {
  if ("error" in r) throw new Error(r.error);
  return r.body;
}

describe("buildLocalLaunchBody (chat surface)", () => {
  it("targets this machine only: target = scope = hostname, windows family, localHost set", () => {
    const body = bodyOf(buildLocalLaunchBody({ operatorName: "Carlos" }, "TESTBOX"));
    assert.equal(body.target, "TESTBOX");
    assert.deepEqual(body.scope, ["TESTBOX"]);
    assert.deepEqual(body.targets, ["windows"]);
    assert.equal(body.localHost, true);
    assert.equal(body.mode, "red");
    assert.equal(body.operatorName, "Carlos");
    assert.match(body.objective, /workstation/);
  });

  it("never attests a placeholder — falls back to a real identity", () => {
    // The ownership basis the authorize phase consumes is this name. It used to
    // default to the constant "the desktop user", so the record attested that a
    // named person had claimed ownership when nobody had.
    const body = bodyOf(buildLocalLaunchBody({}, "TESTBOX"));
    assert.notEqual(body.operatorName, "the desktop user");
    assert.ok((body.operatorName ?? "").trim().length > 0, "no identity was recorded");
  });

  it("carries the caller's objective, operator, client, mode, tier, dryRun", () => {
    const body = bodyOf(buildLocalLaunchBody(
      { objective: "check my PC before the demo", operatorName: "Carlos", mode: "black", tier: 0, dryRun: true },
      "TESTBOX",
    ));
    assert.equal(body.objective, "check my PC before the demo");
    assert.equal(body.operatorName, "Carlos");
    assert.equal(body.mode, "black");
    assert.equal(body.tier, 0);
    assert.equal(body.dryRun, true);
  });

  it("ignores any target/scope smuggled into the args — a local launch cannot be re-aimed", () => {
    const body = bodyOf(buildLocalLaunchBody(
      { target: "victim.example.com", scope: ["victim.example.com"], localHost: false, operatorName: "Carlos" },
      "TESTBOX",
    ));
    assert.equal(body.target, "TESTBOX");
    assert.deepEqual(body.scope, ["TESTBOX"]);
    assert.equal(body.localHost, true);
  });
});

describe("engagement_launch passthrough", () => {
  it("buildLaunchBody carries localHost: true and nothing else changes", () => {
    const plain = buildLaunchBody({ target: "example.com", objective: "scan it", operatorName: "Carlos" });
    assert.ok(!("error" in plain));
    if ("error" in plain) return;
    assert.equal(plain.body.localHost, undefined);
    const local = buildLaunchBody({ target: "example.com", objective: "scan it", localHost: true, operatorName: "Carlos" });
    assert.ok(!("error" in local));
    if ("error" in local) return;
    assert.equal(local.body.localHost, true);
  });
});

describe("tool registration", () => {
  it("engagement_launch_local is registered exactly once and shadows nothing", () => {
    assert.equal(LOCAL_TOOLS.length, 1);
    assert.ok(TOOLS_BY_NAME.has("engagement_launch_local"));
    assert.equal(TOOLS.filter((t) => t.name === "engagement_launch_local").length, 1);
    const execNames = new Set(EXEC_TOOLS.map((t) => t.name));
    assert.ok(!execNames.has("engagement_launch_local"));
    const tool = TOOLS_BY_NAME.get("engagement_launch_local");
    assert.ok(tool);
    assert.match(tool.description, /LOCAL host assessment/);
  });
});

describe("/pcscan CLI input (buildLocalEngagementInput)", () => {
  it("builds a local input: hostname target/scope, localHost, no production stamp", () => {
    const parsed = parseCommand("/pcscan full");
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed === "string") return;
    const input = buildLocalEngagementInput(parsed, "TESTBOX");
    assert.equal(input.target, "TESTBOX");
    assert.deepEqual(input.roe.scope, ["TESTBOX"]);
    assert.equal(input.localHost, true);
    assert.deepEqual(input.targets, ["windows"]);
    assert.equal(input.environment, undefined);
    assert.equal(input.confirmProduction, undefined);
  });

  it("refuses a non-local command", () => {
    const parsed = parseCommand("/scan example.com");
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed === "string") return;
    assert.throws(() => buildLocalEngagementInput(parsed, "TESTBOX"), /not a local-host command/);
  });

  it("the /pcscan plan's recon phase is on-host collection, not surface mapping", () => {
    const parsed = parseCommand("/pcscan");
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed === "string") return;
    const recon = planCommand(parsed).find((p) => p.phase === "recon");
    assert.ok(recon);
    assert.match(recon.objective, /ON-HOST/);
    assert.match(recon.objective, /host-inventory\.json/);
    const scan = parseCommand("/scan example.com");
    assert.notEqual(typeof scan, "string");
    if (typeof scan === "string") return;
    const remoteRecon = planCommand(scan).find((p) => p.phase === "recon");
    assert.ok(remoteRecon);
    assert.doesNotMatch(remoteRecon.objective, /ON-HOST/);
  });
});
