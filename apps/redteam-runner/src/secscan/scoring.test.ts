import { describe, it, expect } from "vitest";
import { computeConfidence, corroborateMerge, autoEnrichConfidence } from "./scoring.js";
import type { ScanVulnerability } from "./scanner.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeVuln(overrides: Partial<ScanVulnerability> = {}): ScanVulnerability {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    name: "Missing X-Frame-Options",
    category: "Security Headers",
    severity: "medium",
    description: "Header absent.",
    solution: "Add header.",
    evidence: null,
    cweId: null,
    wstgId: null,
    cvssScore: null,
    confidence: null,
    ...overrides,
  };
}

// ─── computeConfidence ───────────────────────────────────────────────────────

describe("computeConfidence — base scores", () => {
  it("confirmed_exploit → 95", () => expect(computeConfidence("confirmed_exploit")).toBe(95));
  it("confirmed_exposure → 88", () => expect(computeConfidence("confirmed_exposure")).toBe(88));
  it("dns_record → 80",         () => expect(computeConfidence("dns_record")).toBe(80));
  it("active_behavioral → 78",  () => expect(computeConfidence("active_behavioral")).toBe(78));
  it("validated_passive → 72",  () => expect(computeConfidence("validated_passive")).toBe(72));
  it("header_absent → 68",      () => expect(computeConfidence("header_absent")).toBe(68));
  it("header_misconfigured → 65", () => expect(computeConfidence("header_misconfigured")).toBe(65));
  it("secret_regex → 55",       () => expect(computeConfidence("secret_regex")).toBe(55));
  it("subdomain_heuristic → 52", () => expect(computeConfidence("subdomain_heuristic")).toBe(52));
  it("version_heuristic → 48",  () => expect(computeConfidence("version_heuristic")).toBe(48));
  it("info_disclosure → 42",    () => expect(computeConfidence("info_disclosure")).toBe(42));
});

describe("computeConfidence — evidence modifier", () => {
  it("adds +7 for multi-line evidence (≥3 newlines)", () => {
    expect(computeConfidence("header_absent", { evidence: "a\nb\nc\nd" })).toBe(75);
  });
  it("adds +4 for single-newline evidence", () => {
    expect(computeConfidence("header_absent", { evidence: "a\nb" })).toBe(72);
  });
  it("adds +0 for evidence with no newlines", () => {
    expect(computeConfidence("header_absent", { evidence: "single line" })).toBe(68);
  });
  it("adds +0 for null evidence", () => {
    expect(computeConfidence("header_absent", { evidence: null })).toBe(68);
  });
});

describe("computeConfidence — signals modifier", () => {
  it("1 signal → no bonus", () =>
    expect(computeConfidence("header_absent", { signals: 1 })).toBe(68));
  it("2 signals → +5", () =>
    expect(computeConfidence("header_absent", { signals: 2 })).toBe(73));
  it("4 signals → +15 (capped)", () =>
    expect(computeConfidence("header_absent", { signals: 4 })).toBe(83));
  it("10 signals → +15 (still capped)", () =>
    expect(computeConfidence("header_absent", { signals: 10 })).toBe(83));
});

describe("computeConfidence — taxonomy modifiers", () => {
  it("adds +3 for CWE ID", () =>
    expect(computeConfidence("header_absent", { cweId: "CWE-693" })).toBe(71));
  it("adds +2 for WSTG ID", () =>
    expect(computeConfidence("header_absent", { wstgId: "WSTG-CONF-07" })).toBe(70));
  it("adds +5 for both CWE + WSTG", () =>
    expect(computeConfidence("header_absent", { cweId: "CWE-693", wstgId: "WSTG-CONF-07" })).toBe(73));
});

describe("computeConfidence — ceiling / floor", () => {
  it("caps at 100 when all modifiers stack", () => {
    expect(
      computeConfidence("confirmed_exploit", {
        signals: 10,
        evidence: "a\nb\nc\nd",
        cweId: "CWE-1",
        wstgId: "WSTG-1",
      }),
    ).toBe(100);
  });
  it("floors at 10 (never below)", () => {
    expect(computeConfidence("info_disclosure")).toBeGreaterThanOrEqual(10);
  });
});

// ─── corroborateMerge ────────────────────────────────────────────────────────

describe("corroborateMerge", () => {
  it("passes through a single finding unchanged", () => {
    const vulns = [makeVuln({ confidence: 65 })];
    const result = corroborateMerge(vulns);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(65);
  });

  it("merges two findings with the same name and floors confidence at 90", () => {
    const vulns = [
      makeVuln({ name: "Missing X-Frame-Options", confidence: 60 }),
      makeVuln({ name: "Missing X-Frame-Options", confidence: 70 }),
    ];
    const result = corroborateMerge(vulns);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(90);
  });

  it("preserves a confidence already above 90 when merging", () => {
    const vulns = [
      makeVuln({ name: "Missing X-Frame-Options", confidence: 95 }),
      makeVuln({ name: "Missing X-Frame-Options", confidence: 72 }),
    ];
    const result = corroborateMerge(vulns);
    expect(result[0].confidence).toBe(95);
  });

  it("picks canonical by highest severity, not insertion order", () => {
    const vulns = [
      makeVuln({ name: "Missing X-Frame-Options", severity: "low",    confidence: 80 }),
      makeVuln({ name: "Missing X-Frame-Options", severity: "high",   confidence: 60 }),
      makeVuln({ name: "Missing X-Frame-Options", severity: "medium", confidence: 70 }),
    ];
    const result = corroborateMerge(vulns);
    expect(result[0].severity).toBe("high");
  });

  it("uses confidence as tiebreaker when severities are equal", () => {
    const vulns = [
      makeVuln({ name: "Missing X-Frame-Options", severity: "medium", confidence: 60 }),
      makeVuln({ name: "Missing X-Frame-Options", severity: "medium", confidence: 85 }),
    ];
    const result = corroborateMerge(vulns);
    expect(result[0].confidence).toBe(90);
  });

  it("concatenates unique evidence from all corroborating signals", () => {
    const vulns = [
      makeVuln({ name: "Missing X-Frame-Options", evidence: "signal-A", confidence: 60 }),
      makeVuln({ name: "Missing X-Frame-Options", evidence: "signal-B", confidence: 60 }),
    ];
    const result = corroborateMerge(vulns);
    expect(result[0].evidence).toContain("signal-A");
    expect(result[0].evidence).toContain("signal-B");
  });

  it("deduplicates identical evidence strings", () => {
    const vulns = [
      makeVuln({ name: "Missing X-Frame-Options", evidence: "same-evidence", confidence: 60 }),
      makeVuln({ name: "Missing X-Frame-Options", evidence: "same-evidence", confidence: 60 }),
    ];
    const result = corroborateMerge(vulns);
    expect(result[0].evidence).toBe("same-evidence");
  });

  it("does not merge distinct findings", () => {
    const vulns = [
      makeVuln({ name: "Missing X-Frame-Options" }),
      makeVuln({ name: "Missing Content-Security-Policy" }),
    ];
    expect(corroborateMerge(vulns)).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(corroborateMerge([])).toEqual([]);
  });
});

// ─── autoEnrichConfidence ────────────────────────────────────────────────────

describe("autoEnrichConfidence", () => {
  it("skips vulns that already have a confidence value", () => {
    const v = makeVuln({ confidence: 55 });
    expect(autoEnrichConfidence([v])[0].confidence).toBe(55);
  });

  it("assigns a non-null confidence to vulns with null confidence", () => {
    const v = makeVuln({ confidence: null });
    const result = autoEnrichConfidence([v])[0];
    expect(result.confidence).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("infers dns_record class (base 80) for Email Security category", () => {
    const v = makeVuln({ category: "Email Security", confidence: null });
    expect(autoEnrichConfidence([v])[0].confidence).toBeGreaterThanOrEqual(80);
  });

  it("infers confirmed_exploit class (base 95) from /etc/passwd evidence", () => {
    const v = makeVuln({ evidence: "root:x:0:0:", confidence: null });
    expect(autoEnrichConfidence([v])[0].confidence).toBeGreaterThanOrEqual(95);
  });

  it("infers subdomain_heuristic class for subdomain takeover findings", () => {
    const v = makeVuln({ name: "Subdomain Takeover Possible", confidence: null });
    expect(autoEnrichConfidence([v])[0].confidence).toBeGreaterThanOrEqual(52);
  });

  it("infers info_disclosure class (base 42) for severity=info", () => {
    const v = makeVuln({ severity: "info", confidence: null });
    expect(autoEnrichConfidence([v])[0].confidence).toBeGreaterThanOrEqual(42);
  });

  it("infers version_heuristic class for CVE/outdated category", () => {
    const v = makeVuln({ category: "CVE / Known Vulnerability", confidence: null });
    expect(autoEnrichConfidence([v])[0].confidence).toBeGreaterThanOrEqual(48);
  });

  it("processes a mixed array: enriches nulls, preserves existing values", () => {
    const vulns = [
      makeVuln({ confidence: 77 }),
      makeVuln({ confidence: null }),
    ];
    const result = autoEnrichConfidence(vulns);
    expect(result[0].confidence).toBe(77);
    expect(result[1].confidence).not.toBeNull();
  });
});
