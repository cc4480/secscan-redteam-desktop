/**
 * Chat engagement tools (v0.31.0).
 *
 * The trio a chat agent uses to fulfil a scan request end to end:
 * engagement_launch / engagement_status / engagement_report. Covered here:
 * the surface (registered once, never shadowing executor tools), the
 * conversation-shaped launch body (punctuation cleaning, host-derived
 * scope, the named operator the authorize attestation consumes), refusal
 * paths that launch nothing, and the status/report shapes against canned
 * engagement records. The live round-trip is proven separately against a
 * real server; nothing here starts a real engagement.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UiStore } from "../src/ui/store.js";
import { TOOLS, TOOLS_BY_NAME } from "../src/ui/mcp-tools.js";
import { EXEC_TOOLS } from "../src/ui/mcp-exec.js";
import { ENGAGEMENT_TOOLS, buildLaunchBody, cleanTarget, targetHost } from "../src/ui/engagement-tools.js";
import { startUiServer } from "../src/ui/server.js";

let tmp = "";
let store: UiStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "eng-tools-test-"));
  store = new UiStore(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const tool = (name: string) => {
  const t = TOOLS_BY_NAME.get(name);
  assert.ok(t, `tool ${name} is registered`);
  return t;
};

function cannedState(id: string, status: string, withReport: boolean): string {
  const dir = join(tmp, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({
      engagementId: id,
      target: "https://example.com",
      mode: "red",
      objective: "test",
      status,
      phase: status === "complete" ? "report" : "exploit",
      verified: true,
      verificationProof: "Operator-attested ownership: the desktop user attests on the engagement record",
      findings: [
        { id: "F-1", severity: "high", title: "SQLi in search", attackIds: ["T1190"], status: "confirmed", tier: 1, target: "example.com" },
        { id: "F-2", severity: "low", title: "Verbose banner", attackIds: [], status: "confirmed", tier: 0, target: "example.com" },
      ],
      eventCount: 42,
      startedAt: "2026-10-28T10:00:00Z",
      updatedAt: "2026-10-28T10:05:00Z",
    }),
  );
  if (withReport) writeFileSync(join(dir, "report.md"), "# Engagement report\n\nGrade: A\n");
  return dir;
}

describe("tool surface", () => {
  it("registers the quartet once, alongside the CLI-shaped tools", () => {
    assert.equal(ENGAGEMENT_TOOLS.length, 4);
    for (const name of ["engagement_launch", "engagement_status", "engagement_report", "engagement_regenerate_report"]) {
      assert.ok(TOOLS_BY_NAME.has(name), `${name} in TOOLS_BY_NAME`);
      assert.equal(TOOLS.filter((t) => t.name === name).length, 1, `${name} appears exactly once`);
    }
  });

  it("never shadows an executor tool name", () => {
    const execNames = new Set(EXEC_TOOLS.map((t) => t.name));
    for (const t of ENGAGEMENT_TOOLS) assert.ok(!execNames.has(t.name), `${t.name} is cockpit-owned`);
  });
});

describe("launch body building", () => {
  it("cleans the trailing-comma target that defeated the keeper's first launch", () => {
    assert.equal(cleanTarget("https://secscan.us,"), "https://secscan.us");
    assert.equal(cleanTarget('  "https://secscan.us". '), "https://secscan.us");
    assert.equal(cleanTarget("https://example.com:8443/a,b"), "https://example.com:8443/a,b");
  });

  it("reads hosts from URLs and bare hosts alike", () => {
    assert.equal(targetHost("https://secscan.us/path?q=1"), "secscan.us");
    assert.equal(targetHost("secscan.us"), "secscan.us");
    assert.equal(targetHost("secscan.us:8443"), "secscan.us");
    assert.equal(targetHost("not a target!!"), null);
  });

  it("derives a single-host scope and defaults mode to red", () => {
    const built = buildLaunchBody({ target: "https://secscan.us,", objective: "full deep scan" });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    assert.equal(built.body.target, "https://secscan.us");
    assert.deepEqual(built.body.scope, ["secscan.us"]);
    assert.equal(built.body.mode, "red");
  });

  it("names the operator so authorize attests from the record", () => {
    const named = buildLaunchBody({ target: "secscan.us", objective: "scan", operatorName: "Carlos" });
    assert.ok("body" in named && named.body.operatorName === "Carlos");
    const fallback = buildLaunchBody({ target: "secscan.us", objective: "scan" });
    assert.ok("body" in fallback && fallback.body.operatorName === "the desktop user");
    const clientOnly = buildLaunchBody({ target: "secscan.us", objective: "scan", client: "Acme" });
    assert.ok("body" in clientOnly && clientOnly.body.operatorName === undefined && clientOnly.body.client === "Acme");
  });

  it("keeps an explicit scope and refuses what it cannot shape", () => {
    const scoped = buildLaunchBody({ target: "https://a.example.com", objective: "scan", scope: ["a.example.com", "b.example.com"] });
    assert.ok("body" in scoped && scoped.body.scope.length === 2);
    assert.ok("error" in buildLaunchBody({ objective: "scan" }), "target required");
    assert.ok("error" in buildLaunchBody({ target: "secscan.us" }), "objective required");
    assert.ok("error" in buildLaunchBody({ target: "not a target!!", objective: "scan" }), "host required");
  });
});

describe("engagement_launch refusals", () => {
  it("returns 400 and launches nothing for an unshapeable target", async () => {
    const out = await tool("engagement_launch").run(store, { target: "not a target!!", objective: "scan it" });
    assert.equal(out.status, 400);
    assert.equal(store.list().length, 0);
  });

  it("ignores a malformed explicit scope instead of launching with it", async () => {
    // A blank-string scope fails the builder's shape check and falls back
    // to the derived host; with an unshapeable target alongside, nothing
    // launches at all.
    const built = buildLaunchBody({ target: "https://example.com", objective: "scan", scope: [""] });
    assert.ok("body" in built);
    if ("body" in built) assert.deepEqual(built.body.scope, ["example.com"]);
    const out = await tool("engagement_launch").run(store, { target: "", objective: "scan", scope: [""] });
    assert.equal(out.status, 400);
    assert.equal(store.list().length, 0);
  });
});

describe("engagement_status", () => {
  it("reshapes a completed engagement for narration", async () => {
    cannedState("eng-2026-10-28-aaaa", "complete", true);
    const out = await tool("engagement_status").run(store, { id: "eng-2026-10-28-aaaa" });
    assert.equal(out.status, 200);
    const b = out.body as Record<string, unknown>;
    assert.equal(b["status"], "complete");
    assert.equal(b["phase"], "report");
    assert.equal(b["findings"], 2);
    assert.equal(b["eventCount"], 42);
    assert.equal(b["verified"], true);
    assert.match(String(b["summary"]), /complete: 2 findings over 42 events/);
  });

  it("surfaces the halt reason for a run that died before writing state", async () => {
    store.register({
      id: "eng-2026-10-28-bbbb",
      dir: join(tmp, "eng-2026-10-28-bbbb"),
      status: "halted",
      startedAt: "2026-10-28T10:00:00Z",
      target: "https://example.com",
      mode: "red",
      error: "No model provider key is configured. Set MODEL_API_KEY (Meta) or DEEPSEEK_API_KEY.",
    });
    const out = await tool("engagement_status").run(store, { id: "eng-2026-10-28-bbbb" });
    assert.equal(out.status, 200);
    const b = out.body as Record<string, unknown>;
    assert.equal(b["status"], "halted");
    assert.equal(b["phase"], "starting");
    assert.match(String(b["summary"]), /halted before it started/);
  });

  it("404s an unknown id", async () => {
    const out = await tool("engagement_status").run(store, { id: "eng-2026-10-28-zzzz" });
    assert.equal(out.status, 404);
  });
});

describe("engagement_report", () => {
  it("returns the report content and in-app path once finished", async () => {
    const dir = cannedState("eng-2026-10-28-cccc", "complete", true);
    const out = await tool("engagement_report").run(store, { id: "eng-2026-10-28-cccc" });
    assert.equal(out.status, 200);
    const b = out.body as Record<string, unknown>;
    assert.equal(b["ready"], true);
    assert.match(String(b["content"]), /# Engagement report/);
    assert.equal(b["reportPath"], join(dir, "report.md"));
  });

  it("says ready:false while the run is still going", async () => {
    cannedState("eng-2026-10-28-dddd", "running", false);
    const out = await tool("engagement_report").run(store, { id: "eng-2026-10-28-dddd" });
    assert.equal(out.status, 200);
    const b = out.body as Record<string, unknown>;
    assert.equal(b["ready"], false);
    assert.equal(b["status"], "running");
  });

  it("404s an unknown id", async () => {
    const out = await tool("engagement_report").run(store, { id: "eng-2026-10-28-yyyy" });
    assert.equal(out.status, 404);
  });
});

describe("the MCP surface a chat host consumes", () => {
  it("lists the trio over /mcp and answers a status call", async () => {
    cannedState("eng-2026-10-28-eeee", "complete", true);
    const srv = await startUiServer({ port: 0, engagementsDir: tmp });
    try {
      const base = `http://127.0.0.1:${srv.port}`;
      const rpc = async (method: string, params?: Record<string, unknown>) => {
        const res = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${srv.token}`, "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
        });
        return (await res.json()) as Record<string, unknown>;
      };
      await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } });
      const list = await rpc("tools/list");
      const tools = (list["result"] as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
      for (const name of ["engagement_launch", "engagement_status", "engagement_report"]) {
        assert.ok(tools.includes(name), `${name} in tools/list`);
      }
      const call = await rpc("tools/call", { name: "engagement_status", arguments: { id: "eng-2026-10-28-eeee" } });
      const result = call["result"] as { content: Array<{ text: string }>; isError?: boolean };
      assert.notEqual(result.isError, true);
      const body = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
      assert.equal(body["status"], "complete");
      assert.equal(body["findings"], 2);
    } finally {
      await srv.close();
    }
  });
});
