/**
 * S3-H8 — the deny list on the desktop / chat launch paths.
 *
 * The scope guard enforces roe.outOfScope correctly when one arrives
 * (deny beats allow), and the CLI delivers one (--out-of-scope), but the
 * two paths the desktop actually uses dropped it: toEngagementInput
 * never copied a launch body's outOfScope into the ROE, and the chat
 * engagement_launch tool could not even express one (no schema field,
 * no body field). These tests pin the delivery end to end:
 * launch body -> EngagementInput.roe.outOfScope -> the guard's deny
 * set, on both the UI route and the chat tool, plus the controls that
 * a launch without a deny list is shaped exactly as before.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UiStore } from "../src/ui/store.js";
import { toEngagementInput } from "../src/ui/routes/engagements.js";
import { TOOLS_BY_NAME } from "../src/ui/mcp-tools.js";
import { ENGAGEMENT_TOOLS, buildLaunchBody } from "../src/ui/engagement-tools.js";
import { ScopeGuard } from "../src/safety/scope-guard.js";
import type { UiLaunchRequest } from "../src/ui/types.js";

const baseBody: UiLaunchRequest = {
  target: "https://example.com",
  mode: "red",
  objective: "scan it",
  scope: ["example.com"],
};

describe("toEngagementInput — UI route deny list (S3-H8)", () => {
  it("copies a supplied outOfScope into roe.outOfScope", () => {
    const input = toEngagementInput({ ...baseBody, outOfScope: ["status.example.com", "10.9.9.9"] });
    assert.deepEqual(input.roe.outOfScope, ["status.example.com", "10.9.9.9"]);
    assert.deepEqual(input.roe.scope, ["example.com"]);
  });

  it("a launch without outOfScope produces the base input shape (no deny key, no empty array)", () => {
    const input = toEngagementInput({ ...baseBody });
    assert.equal("outOfScope" in input.roe, false);
    assert.equal(input.roe.outOfScope, undefined);
    assert.deepEqual(input.roe, {
      scope: ["example.com"],
      excludedTechniques: null,
      blackoutWindows: [],
      stopConditions: [],
    });
  });

  it("an empty outOfScope is omitted, mirroring the CLI's length-gated shape", () => {
    const input = toEngagementInput({ ...baseBody, outOfScope: [] });
    assert.equal("outOfScope" in input.roe, false);
  });

  it("rejects a malformed outOfScope the way scope is rejected", () => {
    const notArray = JSON.parse('{"target":"https://example.com","mode":"red","objective":"scan it","scope":["example.com"],"outOfScope":"status.example.com"}') as UiLaunchRequest;
    assert.throws(() => toEngagementInput(notArray), /outOfScope/);
    assert.throws(() => toEngagementInput({ ...baseBody, outOfScope: [""] }), /outOfScope/);
    const nonString = JSON.parse('{"target":"https://example.com","mode":"red","objective":"scan it","scope":["example.com"],"outOfScope":[42]}') as UiLaunchRequest;
    assert.throws(() => toEngagementInput(nonString), /outOfScope/);
  });

  it("a supplied deny entry lands in the guard's deny set and beats allow", () => {
    const input = toEngagementInput({
      ...baseBody,
      scope: ["example.com"],
      outOfScope: ["status.example.com"],
    });
    const guard = ScopeGuard.fromRoe(input.roe);
    assert.equal(guard.denyLoaded, true);
    const denied = guard.checkHost("status.example.com");
    assert.equal(denied.allowed, false);
    assert.equal(denied.kind, "deny");
    assert.equal(guard.checkHost("example.com").allowed, true);
    assert.match(guard.describe(), /deny: 1 entries/);
  });
});

describe("engagement_launch — chat tool deny list (S3-H8)", () => {
  it("the tool schema exposes outOfScope as an array of strings", () => {
    const launch = ENGAGEMENT_TOOLS.find((t) => t.name === "engagement_launch");
    assert.ok(launch, "engagement_launch is registered");
    const props = (launch.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties;
    assert.ok("outOfScope" in props, "schema carries outOfScope");
    assert.equal(props["outOfScope"]?.["type"], "array");
    assert.deepEqual(props["outOfScope"]?.["items"], { type: "string" });
  });

  it("buildLaunchBody carries a supplied deny list, trimmed like scope", () => {
    const built = buildLaunchBody({
      target: "https://example.com",
      objective: "scan it",
      outOfScope: [" status.example.com ", "10.9.9.9"],
    });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    assert.deepEqual(built.body.outOfScope, ["status.example.com", "10.9.9.9"]);
  });

  it("buildLaunchBody without a deny list carries no outOfScope key", () => {
    const built = buildLaunchBody({ target: "https://example.com", objective: "scan it" });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    assert.equal("outOfScope" in built.body, false);
  });

  it("buildLaunchBody ignores a malformed deny list instead of launching with it", () => {
    for (const bad of ["status.example.com", [""], [42], []]) {
      const built = buildLaunchBody({ target: "https://example.com", objective: "scan it", outOfScope: bad });
      assert.ok("body" in built);
      if ("body" in built) assert.equal("outOfScope" in built.body, false, JSON.stringify(bad));
    }
  });

  it("chat body -> engagement input -> guard: the deny list arrives end to end", () => {
    const built = buildLaunchBody({
      target: "https://example.com",
      objective: "scan it",
      outOfScope: ["status.example.com"],
    });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    const input = toEngagementInput(built.body);
    assert.deepEqual(input.roe.outOfScope, ["status.example.com"]);
    const guard = ScopeGuard.fromRoe(input.roe);
    assert.equal(guard.checkHost("status.example.com").allowed, false);
    assert.equal(guard.checkHost("status.example.com").kind, "deny");
    assert.equal(guard.checkHost("example.com").allowed, true);
  });
});

describe("engagement_launch invocation (S3-H8)", () => {
  let tmp = "";
  let store: UiStore;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "oos-launch-test-"));
    store = new UiStore(tmp);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("invoking the tool with a deny list launches (202) on the shared launch path", async () => {
    const launch = TOOLS_BY_NAME.get("engagement_launch");
    assert.ok(launch);
    const out = await launch.run(store, {
      target: "https://example.com",
      objective: "scan it",
      scope: ["example.com"],
      outOfScope: ["status.example.com"],
      dryRun: true,
    });
    assert.equal(out.status, 202, JSON.stringify(out.body));
    const id = (out.body as { id?: string }).id ?? "";
    assert.ok(id, "launch returns an engagement id");
    assert.equal(store.list().length, 1);
    // Let the detached dry run settle so its writes land inside tmp
    // before cleanup; the deny delivery itself is proven above at the
    // EngagementInput and guard boundaries this launch path feeds.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const p = join(tmp, id, "state.json");
      if (existsSync(p)) {
        try {
          const s = JSON.parse(readFileSync(p, "utf8")) as { status?: string };
          if (s.status === "complete" || s.status === "blocked" || s.status === "halted") break;
        } catch {
          // torn read while the writer is mid-write — keep polling
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  });
});
