/**
 * Q-RP-3 + Q-RP-1 receipts — engine reference data reaches the report, and
 * the findings sheet reconciles with the report model.
 *
 * The parity audit found CVSS/CWE produced by the SecScan engine and
 * dropped at every seam: the FindingMeta chips were dead code and no
 * findings.csv existed. These tests pin the carry at each joint (dispatch
 * seam → live finding → report-phase stamp → FindingMeta → CSV) and the
 * honesty rule: a value exists only where an engine record carries it —
 * unmatched or ambiguous joins REMOVE values, they never invent them.
 * Fakes only — no network, no live engagements.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanVulnerabilityToFinding } from "../src/dispatch/secscan.js";
import { applyFindingRefs, buildFindingMeta } from "../src/report/html/wire.js";
import { buildFindingsCsv, emitFindingsCsv, FINDINGS_CSV_COLUMNS } from "../src/report/csv.js";
import type { Ctx, LiveFinding } from "../src/context.js";
import type { Finding } from "../src/types.js";
import type { PocBundle } from "../src/proof/bundle.js";
import type { ScanVulnerability } from "#secscan/scanner.js";

function vuln(overrides: Partial<ScanVulnerability> = {}): ScanVulnerability {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Cookie without Secure attribute",
    severity: "medium",
    category: "Cookies",
    description: "The session cookie lacks the Secure attribute.",
    evidence: "Set-Cookie: sid=…; HttpOnly",
    solution: "Add the Secure attribute.",
    cvssScore: 6.5,
    cweId: "CWE-614",
    ...overrides,
  };
}

function live(overrides: Partial<LiveFinding> = {}): LiveFinding {
  return {
    severity: "medium",
    title: "Cookie without Secure attribute",
    attackId: "T1190",
    evidence: "Set-Cookie: sid=…; HttpOnly",
    cvss: 6.5,
    cwe: "CWE-614",
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F-1",
    severity: "medium",
    title: "Cookie without Secure attribute",
    attackIds: ["T1190"],
    evidence: "Set-Cookie: sid=…; HttpOnly",
    fix: "Add the Secure attribute to all cookies.",
    retest: "Re-request and inspect Set-Cookie.",
    status: "confirmed",
    ...overrides,
  };
}

function bundle(overrides: Partial<PocBundle> = {}): PocBundle {
  return {
    version: 1,
    bundleId: "b-1",
    engagementId: "eng-1",
    findingId: "F-1",
    attackIds: ["T1190"],
    severity: "medium",
    title: "Cookie without Secure attribute",
    target: "https://target.example",
    operator: "op",
    generatedAt: "2026-10-31T00:00:00Z",
    steps: [],
    validationTier: "execution",
    proves: "The cookie was set without Secure.",
    doesNotProve: "Session theft itself.",
    reverifyCommand: "redteam-runner reverify b-1",
    ...overrides,
  } as PocBundle;
}

describe("RP-3 — the SecScan seam stops dropping reference data", () => {
  it("carries the scanner's recorded cvssScore and cweId verbatim", () => {
    const f = scanVulnerabilityToFinding(vuln(), "T1190");
    assert.equal(f.cvss, 6.5);
    assert.equal(f.cwe, "CWE-614");
  });

  it("leaves the fields absent when the scanner recorded none", () => {
    const f = scanVulnerabilityToFinding(vuln({ cvssScore: null, cweId: null }), "T1190");
    assert.ok(!("cvss" in f), "no cvss key at all — absent, not null or derived");
    assert.ok(!("cwe" in f), "no cwe key at all");
  });
});

describe("RP-3 — applyFindingRefs, the report-phase stamp", () => {
  it("stamps the positional match when attackId corroborates", () => {
    const findings = [finding()];
    applyFindingRefs(findings, [live()]);
    assert.equal(findings[0].cvss, 6.5);
    assert.equal(findings[0].cwe, "CWE-614");
  });

  it("removes a reporter-invented value when no live finding corroborates", () => {
    const findings = [finding({ cvss: 9.9, cwe: "CWE-999" })];
    applyFindingRefs(findings, [live({ attackId: "T1059", title: "Something else" })]);
    assert.ok(!("cvss" in findings[0]), "invented cvss must not survive the stamp");
    assert.ok(!("cwe" in findings[0]));
  });

  it("finds a reordered finding by its unique attackId+title match", () => {
    const findings = [finding({ id: "F-2" })];
    // The positional candidate (index 1) does not corroborate; the match
    // sits at index 0 and is the unique attackId+title hit.
    applyFindingRefs(findings, [live(), live({ title: "Unrelated", attackId: "T1059", cvss: 1.0, cwe: "CWE-000" })]);
    assert.equal(findings[0].cvss, 6.5);
    assert.equal(findings[0].cwe, "CWE-614");
  });

  it("stamps nothing when the match is ambiguous", () => {
    const findings = [finding({ id: "F-3", cvss: 9.9 })];
    applyFindingRefs(findings, [live(), live()]);
    assert.ok(!("cvss" in findings[0]), "two identical candidates = no honest stamp");
  });

  it("leaves refs absent when the source live finding recorded none", () => {
    const findings = [finding()];
    applyFindingRefs(findings, [live({ cvss: undefined, cwe: undefined })]);
    assert.ok(!("cvss" in findings[0]));
    assert.ok(!("cwe" in findings[0]));
  });
});

describe("RP-3 — buildFindingMeta merges engine refs into the render model", () => {
  it("adds cvss/cwe alongside the bundle's category + OWASP", () => {
    const bundles = new Map([["F-1", bundle({ batteryItemId: "webapp:WA-002" })]]);
    const map = buildFindingMeta(bundles, [finding({ cvss: 6.5, cwe: "CWE-614" })]);
    assert.deepEqual(map.get("F-1"), { category: "validation", owasp: "WSTG-CONF-12", cvss: 6.5, cwe: "CWE-614" });
  });

  it("creates an entry from finding refs alone, and none without refs", () => {
    const map = buildFindingMeta(new Map(), [finding({ cvss: 6.5, cwe: "CWE-614" }), finding({ id: "F-2" })]);
    assert.deepEqual(map.get("F-1"), { cvss: 6.5, cwe: "CWE-614" });
    assert.equal(map.has("F-2"), false);
  });
});

describe("RP-1 — findings.csv reconciles with the report model", () => {
  const findings: Finding[] = [
    finding({ fix: "Add the Secure attribute.\nThen re-test  the header." }),
    finding({ id: "F-2", severity: "high", title: "Reflected XSS in search", attackIds: ["T1059"], fix: "Escape output." }),
    finding({ id: "F-3", severity: "low", title: "Verbose errors", status: "killed", fix: "Generic error pages." }),
  ];
  const bundles = new Map<string, PocBundle>([["F-1", bundle()]]);
  const meta = buildFindingMeta(bundles, [
    finding({ cvss: 6.5, cwe: "CWE-614" }),
    finding({ id: "F-2", cvss: 7.4 }),
    finding({ id: "F-3" }),
  ]);
  const csv = buildFindingsCsv({ findings, findingMeta: meta, bundles, target: "https://target.example" });
  const lines = csv.split("\r\n").filter((l) => l.length > 0);

  it("emits the header and exactly one row per finding", () => {
    assert.equal(lines[0], FINDINGS_CSV_COLUMNS.join(","));
    assert.equal(lines.length - 1, findings.length);
  });

  it("carries id, severity, CVSS and CWE per row from the same model", () => {
    const cells = lines.slice(1).map((l) => l.split(","));
    assert.deepEqual(cells.map((c) => c[0]), ["F-1", "F-2", "F-3"]);
    assert.deepEqual(cells.map((c) => c[2]), ["medium", "high", "low"]);
    assert.deepEqual(cells.map((c) => c[3]), ["6.5", "7.4", ""]);
    assert.deepEqual(cells.map((c) => c[4]), ["CWE-614", "", ""]);
    assert.ok(cells.every((c) => c[5] === "https://target.example"));
  });

  it("renders the proof state from the bundle join and an honest empty cell", () => {
    const cells = lines.slice(1).map((l) => l.split(","));
    assert.equal(cells[0][6], "confirmed");
    assert.equal(cells[0][7], "proven", "execution bundle = proven tier, same as the card");
    assert.equal(cells[1][7], "confirmed");
    assert.equal(cells[2][7], "ruled-out", "killed finding renders its honest tier");
    assert.equal(cells[2][3], "", "no CVSS recorded = empty cell, never a derived score");
  });

  it("collapses the remediation to one line and escapes commas and quotes", () => {
    assert.ok(lines[1].endsWith("Add the Secure attribute. Then re-test the header."));
    const tricky = buildFindingsCsv({
      findings: [finding({ title: 'Header, "quoted" title' })],
      findingMeta: new Map(),
      bundles: new Map(),
      target: "https://target.example",
    });
    assert.ok(tricky.split("\r\n")[1].startsWith('F-1,"Header, ""quoted"" title",medium'));
  });

  it("emitFindingsCsv writes the sheet beside the report and records the event", () => {
    const dir = mkdtempSync(join(tmpdir(), "findings-csv-"));
    const appended: { action?: string }[] = [];
    const ctx = {
      events: { dir, engagementId: "eng-1", append: (e: { action?: string }) => appended.push(e) },
      input: { target: "https://target.example" },
    } as unknown as Ctx;
    emitFindingsCsv(ctx, findings, bundles);
    const path = join(dir, "findings.csv");
    assert.ok(existsSync(path));
    const written = readFileSync(path, "utf8");
    const expected = buildFindingsCsv({
      findings,
      findingMeta: buildFindingMeta(bundles, findings),
      bundles,
      target: "https://target.example",
    });
    assert.equal(written, expected);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].action, "report_csv_written");
  });
});
