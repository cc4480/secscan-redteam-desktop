/**
 * Q-RP-5 — the deliverable package zip: ONE zip carrying the full
 * client deliverable set (report.html, report.md, report.json,
 * report.txt, findings.csv, report.docx) plus the proof bundles the
 * report cites (poc/*.json). (Set extended by Q-DELIVERABLES-AUTOFIRE.)
 * The suite pins the package against the artifacts on disk — entry list
 * exact, every entry byte-equal to the individually emitted artifact —
 * because the package is a bundle of those files, never a re-render.
 * It also pins the failure domain (a missing deliverable fails loudly,
 * the loose artifacts stay intact), byte determinism, and the agreement
 * between the emitter's constants and the report contract declared in
 * workflows/protocol.ts. Fixtures are local to this suite.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import {
  PACKAGE_DELIVERABLES, REPORT_PACKAGE_NAME,
  buildReportPackage, collectPackageEntries, emitReportPackage,
} from "../src/report/package.js";
import { REPORT_CONTRACT } from "../src/workflows/protocol.js";
import { type Ctx } from "../src/context.js";

const ARTIFACT_BYTES: Record<string, Buffer> = {
  "report.html": Buffer.from("<!doctype html><html><body>fixture report</body></html>\n"),
  "report.md": Buffer.from("# Engagement report (fixture)\n\nFindings follow.\n"),
  "report.json": Buffer.from(JSON.stringify({ kind: "secscan-redteam-report", version: 1, findingCount: 1 }, null, 2) + "\n"),
  "report.txt": Buffer.from("SecScan RedTeam — Penetration Test Report (plain-text summary)\n\nFindings: 1\n"),
  "findings.csv": Buffer.from("id,title,severity\r\nF-1,Fixture finding,high\r\n"),
  // Arbitrary binary content: the package must carry the DOCX verbatim,
  // whatever its bytes are.
  "report.docx": Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0xde, 0xad, 0xbe, 0xef]),
  "poc/F-1.json": Buffer.from(JSON.stringify({ findingId: "F-1", validationTier: "execution" }, null, 2)),
  "poc/F-2.json": Buffer.from(JSON.stringify({ findingId: "F-2", validationTier: "static" }, null, 2)),
};

const EXPECTED_ENTRIES = [
  "report.html",
  "report.md",
  "report.json",
  "report.txt",
  "findings.csv",
  "report.docx",
  "poc/F-1.json",
  "poc/F-2.json",
];

/** Write the six deliverables + two poc bundles (+ one non-JSON file
 * the package must NOT pick up) into a fresh engagement directory. */
function seedEngagementDir(order: string[] = Object.keys(ARTIFACT_BYTES)): string {
  const dir = mkdtempSync(join(tmpdir(), "report-package-"));
  for (const rel of order) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, ARTIFACT_BYTES[rel]!);
  }
  writeFileSync(join(dir, "poc", "notes.txt"), "operator scratch — not a bundle");
  return dir;
}

function fakeCtx(dir: string, appended: { action?: string; result?: string }[]): Ctx {
  return {
    events: { dir, engagementId: "eng-1", append: (e: { action?: string; result?: string }) => appended.push(e) },
  } as unknown as Ctx;
}

describe("report package (Q-RP-5)", () => {
  it("collects exactly the deliverable set + poc bundles, byte-equal to the artifacts", () => {
    const dir = seedEngagementDir();
    const entries = collectPackageEntries(dir);
    assert.deepEqual(Object.keys(entries), EXPECTED_ENTRIES);
    for (const [name, bytes] of Object.entries(ARTIFACT_BYTES)) {
      assert.deepEqual(Buffer.from(entries[name]!), bytes, `${name} carried verbatim`);
    }
  });

  it("the built zip unzips to the same entry set with byte-equal contents", () => {
    const dir = seedEngagementDir();
    const files = unzipSync(buildReportPackage(dir));
    assert.deepEqual(Object.keys(files).sort(), [...EXPECTED_ENTRIES].sort());
    for (const [name, bytes] of Object.entries(ARTIFACT_BYTES)) {
      assert.deepEqual(Buffer.from(files[name]!), bytes, `${name} survives the zip round-trip`);
    }
  });

  it("is deterministic: same artifacts, same zip bytes — regardless of write order", () => {
    const a = seedEngagementDir();
    const b = seedEngagementDir([...Object.keys(ARTIFACT_BYTES)].reverse());
    assert.deepEqual(Buffer.from(buildReportPackage(a)), Buffer.from(buildReportPackage(a)));
    assert.deepEqual(Buffer.from(buildReportPackage(b)), Buffer.from(buildReportPackage(a)));
  });

  it("an engagement with no proof bundles packages the six deliverables alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "report-package-nopoc-"));
    for (const name of PACKAGE_DELIVERABLES) writeFileSync(join(dir, name), ARTIFACT_BYTES[name]!);
    assert.deepEqual(Object.keys(collectPackageEntries(dir)), [...PACKAGE_DELIVERABLES]);
  });

  it("fails loudly when a deliverable is missing — no partial set under the full-set name", () => {
    const broken = mkdtempSync(join(tmpdir(), "report-package-missing-"));
    for (const name of PACKAGE_DELIVERABLES.filter((n) => n !== "findings.csv")) {
      writeFileSync(join(broken, name), ARTIFACT_BYTES[name]!);
    }
    assert.throws(() => collectPackageEntries(broken), /findings\.csv/);
    assert.throws(() => buildReportPackage(broken), /findings\.csv/);
  });

  it("emitReportPackage writes the zip beside the artifacts and records the event", () => {
    const dir = seedEngagementDir();
    const appended: { action?: string; result?: string }[] = [];
    emitReportPackage(fakeCtx(dir, appended));
    const zipPath = join(dir, REPORT_PACKAGE_NAME);
    assert.ok(existsSync(zipPath));
    const files = unzipSync(readFileSync(zipPath));
    assert.deepEqual(Object.keys(files).sort(), [...EXPECTED_ENTRIES].sort());
    assert.equal(appended.length, 1);
    assert.equal(appended[0]!.action, "report_package_written");
    assert.match(appended[0]!.result ?? "", /8 entries/);
  });

  it("emitReportPackage failure leaves the artifacts intact and records the failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "report-package-fail-"));
    for (const name of PACKAGE_DELIVERABLES.filter((n) => n !== "report.docx")) {
      writeFileSync(join(dir, name), ARTIFACT_BYTES[name]!);
    }
    const appended: { action?: string; result?: string }[] = [];
    emitReportPackage(fakeCtx(dir, appended));
    assert.ok(!existsSync(join(dir, REPORT_PACKAGE_NAME)), "no package written");
    for (const name of PACKAGE_DELIVERABLES.filter((n) => n !== "report.docx")) {
      assert.deepEqual(readFileSync(join(dir, name)), ARTIFACT_BYTES[name], `${name} untouched`);
    }
    assert.equal(appended.length, 1);
    assert.equal(appended[0]!.action, "report_package_failed");
    assert.match(appended[0]!.result ?? "", /report\.docx/);
  });

  it("the emitter's names are the report contract's declared formats", () => {
    assert.deepEqual(REPORT_CONTRACT.formats, [...PACKAGE_DELIVERABLES, REPORT_PACKAGE_NAME]);
  });
});
