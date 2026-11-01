/**
 * Q-DOC-ACTIONS — the deliverable download route over real HTTP.
 *
 * A fixture engagement directory carries the full closing deliverable
 * set (one file removed for the gap case); the route must serve each
 * present file byte for byte (sha256 compared), refuse names outside
 * the deliverable set, 404 the missing file, and stay behind the
 * console token like every other /api route.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startUiServer, type UiServerHandle } from "../src/ui/server.js";
import { DELIVERABLE_FILES } from "../src/report/deliverables.js";

const ID = "eng-2026-11-01-fixture1";
const FIXTURE: Record<string, Buffer> = {
  "report.html": Buffer.from("<!doctype html><title>fixture report</title>\n", "utf8"),
  "report.md": Buffer.from("# Fixture report\n\nOne finding.\n", "utf8"),
  "report.json": Buffer.from('{\n  "kind": "secscan-redteam-report"\n}\n', "utf8"),
  "report.txt": Buffer.from("Fixture report — plain text.\n", "utf8"),
  "findings.csv": Buffer.from("id,severity\nF-1,high\n", "utf8"),
  "report.docx": Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef]),
  "report-package.zip": Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04]),
};
const GAP_FILE = "report.txt";

let tmp = "";
let srv: UiServerHandle;
let base = "";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const auth = (): Record<string, string> => ({ authorization: `Bearer ${srv.token}` });

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ui-deliverable-"));
  const dir = join(tmp, ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ engagementId: ID, status: "complete" }));
  for (const [name, bytes] of Object.entries(FIXTURE)) {
    if (name === GAP_FILE) continue;
    writeFileSync(join(dir, name), bytes);
  }
  // A non-deliverable file that must never be reachable through the route.
  writeFileSync(join(dir, "events.jsonl"), "{}\n");
  srv = await startUiServer({ port: 0, engagementsDir: tmp });
  base = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  await srv.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("deliverable download route", () => {
  it("serves every present deliverable byte for byte", async () => {
    for (const name of DELIVERABLE_FILES) {
      if (name === GAP_FILE) continue;
      const res = await fetch(`${base}/api/engagements/${ID}/deliverables/${name}`, { headers: auth() });
      assert.equal(res.status, 200, name);
      assert.equal(res.headers.get("content-disposition"), `attachment; filename="${name}"`, name);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(sha256(bytes), sha256(FIXTURE[name]!), name);
    }
  });

  it("answers HEAD with the download headers and no body (the client's probe)", async () => {
    const res = await fetch(`${base}/api/engagements/${ID}/deliverables/report.md`, { method: "HEAD", headers: auth() });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="report.md"');
    assert.equal(res.headers.get("content-length"), String(FIXTURE["report.md"]!.length));
    assert.equal(await res.text(), "");
    const missing = await fetch(`${base}/api/engagements/${ID}/deliverables/${GAP_FILE}`, { method: "HEAD", headers: auth() });
    assert.equal(missing.status, 404);
  });

  it("answers 404 for the missing deliverable (the gap case)", async () => {
    const res = await fetch(`${base}/api/engagements/${ID}/deliverables/${GAP_FILE}`, { headers: auth() });
    assert.equal(res.status, 404);
  });

  it("refuses names outside the deliverable set and unknown engagements", async () => {
    for (const name of ["events.jsonl", "state.json", "..%2Fstate.json"]) {
      const res = await fetch(`${base}/api/engagements/${ID}/deliverables/${name}`, { headers: auth() });
      assert.equal(res.status, 404, name);
    }
    const res = await fetch(`${base}/api/engagements/eng-2026-11-01-unknown0/deliverables/report.md`, { headers: auth() });
    assert.equal(res.status, 404);
  });

  it("stays behind the console token", async () => {
    const res = await fetch(`${base}/api/engagements/${ID}/deliverables/report.md`);
    assert.equal(res.status, 401);
  });
});
