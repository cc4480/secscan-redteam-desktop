/**
 * Console pages against the runner's REAL state layout (FIX-CONSOLE-PAGES).
 *
 * The merged console pages were verified against fixtures seeded directly
 * under the store root, so they passed while the live app failed: a launch
 * through the console wrote its state where resolveConfig() puts it
 * (REDTEAM_HOME, else the console process's cwd — on the desktop that is
 * the runner payload dir), while every console read resolves under the
 * store's --engagements-dir (on the desktop, <userData>/engagements/live).
 * Carlos's live test (2026-11-01) showed the split exactly: the list
 * carried his run from the in-memory record, the detail 404'd "unknown
 * engagement", Scope & Safety reported no engagement directories, the
 * Foundry loop scored 0 cases over the empty sibling store.
 *
 * This suite reproduces the desktop layout faithfully:
 *   - the store root is an explicit dir (the --engagements-dir the desktop
 *     passes: <userData>/engagements/live),
 *   - the process cwd is a DIFFERENT temp dir (the payload dir the desktop
 *     spawns the console with),
 *   - REDTEAM_HOME is unset (the desktop never sets it),
 * and drives a real (dry-run) launch through handleLaunch — the one launch
 * seam the HTTP route, the MCP tools and the local tools all share — then
 * reads the run back through the pages' own data functions, including
 * through a FRESH store (the console-restart case: no in-memory record).
 *
 * Writer citations (the layout shape comes from the runner's own writers):
 *   - state/events/report: phases/run.ts writes <engagementsDir>/<id>/
 *     (dir = join(config.engagementsDir, engagementId), run.ts:92);
 *     config.engagementsDir resolves at phases/config.ts:127-129.
 *   - foundry cases: harness2/trajectory.ts:272 captures into
 *     storeDirForEngagement(engagementDir) (foundry/store.ts).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UiStore } from "../src/ui/store.js";
import { handleDetail, handleLaunch } from "../src/ui/routes/engagements.js";
import { handleFindings } from "../src/ui/routes/findings.js";
import { handleConsoleEngagements } from "../src/ui/routes/console-engagements.js";
import { handleConsoleScope } from "../src/ui/routes/console-scope.js";
import { handleFoundry, handleFoundryLoop } from "../src/ui/routes/foundry.js";
import {
  caseContentHash,
  caseIdFor,
  registerCase,
  storeDirForEngagement,
  type FoundryCase,
} from "../src/foundry/store.js";

/** Minimal mock response capturing status + body (mirrors test/ui.test.ts). */
function mockRes() {
  const chunks: string[] = [];
  const res = {
    status: 0,
    headers: {} as Record<string, unknown>,
    body: "",
    writeHead(s: number, h?: Record<string, unknown>) {
      res.status = s;
      res.headers = h ?? {};
    },
    write(c: string) {
      chunks.push(c);
      return true;
    },
    end(c?: string) {
      if (c) chunks.push(c);
      res.body = chunks.join("");
    },
  };
  return res;
}

function bodyOf(res: ReturnType<typeof mockRes>): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let base = "";
let userData = "";
let payloadDir = "";
let storeRoot = "";
let savedCwd = "";
let savedHome: string | undefined;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "console-roots-"));
  userData = join(base, "userData");
  payloadDir = join(base, "payload");
  storeRoot = join(userData, "engagements", "live");
  savedCwd = process.cwd();
  savedHome = process.env["REDTEAM_HOME"];
  delete process.env["REDTEAM_HOME"];
  mkdirSync(payloadDir, { recursive: true });
  mkdirSync(userData, { recursive: true });
  // The desktop spawns the console with cwd = the runner payload dir.
  process.chdir(payloadDir);
});

afterEach(() => {
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env["REDTEAM_HOME"];
  else process.env["REDTEAM_HOME"] = savedHome;
  rmSync(base, { recursive: true, force: true });
});

/** Launch one dry-run engagement through the console's launch seam. */
async function launchDryRun(store: UiStore): Promise<string> {
  const res = mockRes();
  await handleLaunch(store, {} as never, res as never, {
    target: "https://example.com",
    mode: "red",
    objective: "console pages real-roots proof",
    scope: ["example.com"],
    operatorName: "Console Proof",
    dryRun: true,
  });
  assert.equal(res.status, 202, `launch refused: ${res.body}`);
  const id = (JSON.parse(res.body) as { id: string }).id;
  assert.ok(id, "launch returns an engagement id");
  return id;
}

/** Poll until the run's state.json under dir reads terminal (or timeout). */
async function awaitTerminalState(dir: string, timeoutMs = 240_000): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = join(dir, "state.json");
    if (existsSync(p)) {
      try {
        const state = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
        if (["complete", "blocked", "halted"].includes(String(state["status"]))) return state;
      } catch {
        /* torn read while the writer is mid-write — keep polling */
      }
    }
    await sleep(250);
  }
  return null;
}

describe("console pages read what the launch actually wrote (desktop layout)", () => {
  it("a launched run lands under the store root and every page reads it back, even after a restart", async () => {
    const store = new UiStore(storeRoot);
    const id = await launchDryRun(store);

    // The writer must have written under the STORE root — at base the state
    // lands under <payloadDir>/engagements/live instead and this times out.
    const state = await awaitTerminalState(join(storeRoot, id));
    assert.ok(
      state,
      `state.json never appeared under the store root ${storeRoot}; ` +
        `the writer's fallback root holds it instead: ${join(payloadDir, "engagements", "live", id)}`,
    );
    assert.equal(state["engagementId"], id);
    assert.ok(existsSync(join(storeRoot, id, "events.jsonl")), "events.jsonl written beside state.json");
    // Small settle for the deliverables the report phase writes at the end.
    await sleep(500);

    // Restart: a fresh store has no in-memory record — reads are disk-only,
    // which is exactly the surface that 404'd for Carlos.
    const fresh = new UiStore(storeRoot);

    const listed = fresh.list();
    const summary = listed.find((e) => e.id === id);
    assert.ok(summary, "fresh store list() finds the launched run on disk");
    assert.equal(summary?.live, false);

    const detailRes = mockRes();
    handleDetail(fresh, detailRes as never, id);
    assert.equal(detailRes.status, 200, `detail failed: ${detailRes.body}`);
    const detail = bodyOf(detailRes);
    assert.ok(detail["state"], "detail carries the state record, not the pending placeholder");
    assert.equal((detail["state"] as Record<string, unknown>)["engagementId"], id);

    const findingsRes = mockRes();
    handleFindings(fresh, findingsRes as never, id);
    assert.equal(findingsRes.status, 200, `findings failed with: ${findingsRes.body}`);
    assert.ok(Array.isArray(JSON.parse(findingsRes.body)), "findings answers an array");

    const consoleRes = mockRes();
    handleConsoleEngagements(fresh, consoleRes as never);
    const consoleBody = bodyOf(consoleRes);
    assert.equal(consoleBody["available"], true);
    const entries = consoleBody["engagements"] as Array<Record<string, unknown>>;
    assert.ok(entries.some((e) => e["id"] === id), "console engagements list carries the run");

    const scopeRes = mockRes();
    handleConsoleScope(fresh, scopeRes as never);
    const scopeBody = bodyOf(scopeRes);
    assert.equal(scopeBody["available"], true, `scope not available: ${scopeRes.body}`);
    assert.ok(
      ((scopeBody["window"] as Record<string, unknown>)["engagementsScanned"] as number) >= 1,
      "scope aggregates the real engagement directory",
    );
  });

  it("scope over a genuinely empty root is a valid zero aggregate, not an error", () => {
    const emptyRoot = join(base, "empty-userData", "engagements", "live");
    const store = new UiStore(emptyRoot);
    const res = mockRes();
    handleConsoleScope(store, res as never);
    const body = bodyOf(res);
    assert.equal(body["available"], true, `empty scope must not hard-error: ${res.body}`);
    assert.equal((body["window"] as Record<string, unknown>)["engagementsScanned"], 0);
    assert.equal((body["totals"] as Record<string, unknown>)["denials"], 0);
    assert.deepEqual(body["perEngagement"], []);
  });

  it("foundry: cases captured from a launched run are scored by the page's loop", async () => {
    const store = new UiStore(storeRoot);
    const id = await launchDryRun(store);
    // Where did the writer actually put this run? The trajectory capture
    // derives the foundry store from THAT engagement dir
    // (storeDirForEngagement), the page from the store root
    // (foundryStoreDir) — the loop only scores the run's cases when both
    // derivations name the same store.
    let writerEngagementDir: string | null = null;
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline && writerEngagementDir === null) {
      for (const candidate of [join(storeRoot, id), join(payloadDir, "engagements", "live", id)]) {
        if (existsSync(join(candidate, "state.json"))) {
          writerEngagementDir = candidate;
          break;
        }
      }
      if (writerEngagementDir === null) await sleep(250);
    }
    assert.ok(writerEngagementDir, "the launched run wrote a state.json somewhere");
    // Register only once the run is terminal, so the case write never
    // races the run's own trajectory capture into the same store.
    const statePath = join(writerEngagementDir, "state.json");
    const terminalDeadline = Date.now() + 240_000;
    for (;;) {
      try {
        const parsed = JSON.parse(readFileSync(statePath, "utf8")) as { status?: string };
        if (parsed.status === "complete" || parsed.status === "blocked" || parsed.status === "halted") break;
      } catch {
        // state file mid-write; keep polling.
      }
      assert.ok(Date.now() < terminalDeadline, "the launched run reached a terminal state");
      await sleep(250);
    }
    const storeDir = storeDirForEngagement(writerEngagementDir);
    const pattern = {
      family: "sqli",
      vulnClass: "sql-injection",
      cwe: "CWE-89",
      severity: "high",
      endpointShape: ["/search?q={}"],
      methodMix: [] as string[],
      payloadClass: "tautology-quote",
      proofType: "cell-proven",
      techFingerprints: ["wordpress"],
    };
    const contentHash = caseContentHash(pattern);
    const foundryCase: FoundryCase = {
      id: caseIdFor(id, contentHash),
      kind: "live-case",
      origin: "scan",
      family: "sqli",
      vulnClass: pattern.vulnClass,
      cwe: pattern.cwe,
      severity: pattern.severity,
      endpointShape: pattern.endpointShape,
      methodMix: pattern.methodMix,
      payloadClass: pattern.payloadClass,
      proofType: pattern.proofType,
      mechanisms: ["live-detection", "dual-exploiter-cell", "state-confirmation"],
      techFingerprints: pattern.techFingerprints,
      tier: "SILVER",
      sourceEngagementId: id,
      lineage: null,
      createdAt: "2026-11-01T14:00:00.000Z",
      contentHash,
    };
    assert.equal(registerCase(storeDir, foundryCase), true, "the store's own writer registers the case");

    const loopRes = mockRes();
    await handleFoundryLoop(store, loopRes as never);
    const loopBody = bodyOf(loopRes);
    const summary = loopBody["summary"] as Record<string, unknown>;
    assert.equal(summary["error"], null, `loop cycle errored: ${JSON.stringify(summary)}`);
    assert.ok(
      (summary["casesScored"] as number) >= 1,
      `loop scored ${String(summary["casesScored"])} cases over the page's store — the store the page reads must be the store the capture writes`,
    );

    const getRes = mockRes();
    handleFoundry(store, getRes as never);
    const getBody = bodyOf(getRes);
    const storeView = getBody["store"] as Record<string, unknown>;
    assert.ok(((storeView["counts"] as Record<string, unknown>)["total"] as number) >= 1, "foundry page counts the case");
  });
});
