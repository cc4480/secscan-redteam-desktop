import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkSpf, checkDmarc } from "./dnsChecks.js";

/**
 * DNS check tests — stubs globalThis.fetch to simulate Cloudflare DoH responses.
 * All tests use status=0 (NOERROR) to exercise the actual check logic,
 * not the "network failure" early-return path.
 */

// ─── DoH mock helpers ─────────────────────────────────────────────────────────

function dohResponse(answers: { data: string }[], status = 0): Response {
  return new Response(JSON.stringify({ Status: status, Answer: answers }), {
    status: 200,
    headers: { "content-type": "application/dns-json" },
  });
}

const noTxt = () => dohResponse([]);
const noMx  = () => dohResponse([]);
const hasMx = () => dohResponse([{ data: "10 mail.example.com." }]);

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── checkSpf — missing record ───────────────────────────────────────────────

describe("checkSpf — missing record", () => {
  it("returns one high-severity vuln when SPF is missing and MX records exist", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(noTxt())  // TXT query → no SPF
      .mockResolvedValueOnce(hasMx()); // MX query  → sends mail

    const vulns = await checkSpf("example.com");
    expect(vulns).toHaveLength(1);
    expect(vulns[0].severity).toBe("high");
    expect(vulns[0].name).toMatch(/missing spf/i);
    expect(vulns[0].cweId).toBe("CWE-290");
  });

  it("returns medium severity when SPF is missing and no MX records", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(noTxt())
      .mockResolvedValueOnce(noMx());

    const vulns = await checkSpf("example.com");
    expect(vulns).toHaveLength(1);
    expect(vulns[0].severity).toBe("medium");
  });

  it("returns empty array on network failure (status -1)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));
    expect(await checkSpf("example.com")).toEqual([]);
  });
});

// ─── checkSpf — dangerous configurations ─────────────────────────────────────

describe("checkSpf — dangerous configurations", () => {
  it("flags +all (permits any sender) as critical", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      dohResponse([{ data: "v=spf1 include:_spf.google.com +all" }]),
    );
    const vulns = await checkSpf("example.com");
    expect(vulns.some((v) => v.severity === "critical" && v.name.includes("+all"))).toBe(true);
  });

  it("flags ?all (neutral — no enforcement) as medium", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      dohResponse([{ data: "v=spf1 include:_spf.google.com ?all" }]),
    );
    const vulns = await checkSpf("example.com");
    expect(vulns.some((v) => v.severity === "medium" && v.name.includes("?all"))).toBe(true);
  });

  it("flags SPF that exceeds 8 DNS lookups as low", async () => {
    const manyIncludes =
      "v=spf1 " +
      "include:a.com include:b.com include:c.com include:d.com include:e.com " +
      "include:f.com include:g.com include:h.com include:i.com -all";
    vi.mocked(fetch).mockResolvedValueOnce(dohResponse([{ data: manyIncludes }]));
    const vulns = await checkSpf("example.com");
    expect(vulns.some((v) => /lookup limit/i.test(v.name))).toBe(true);
  });

  it("returns no vulns for a well-formed SPF record with -all", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      dohResponse([{ data: "v=spf1 include:_spf.google.com -all" }]),
    );
    expect(await checkSpf("example.com")).toHaveLength(0);
  });

  it("returns no vulns for ~all (soft fail — acceptable)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      dohResponse([{ data: "v=spf1 include:_spf.google.com ~all" }]),
    );
    expect(await checkSpf("example.com")).toHaveLength(0);
  });
});

// ─── checkDmarc — missing record ─────────────────────────────────────────────

describe("checkDmarc — missing record", () => {
  it("returns one high-severity vuln when DMARC record is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(noTxt());
    const vulns = await checkDmarc("example.com");
    expect(vulns).toHaveLength(1);
    expect(vulns[0].severity).toBe("high");
    expect(vulns[0].name).toMatch(/missing dmarc/i);
  });

  it("returns empty array on network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));
    expect(await checkDmarc("example.com")).toEqual([]);
  });
});

// ─── checkDmarc — policy enforcement ─────────────────────────────────────────

describe("checkDmarc — policy enforcement", () => {
  it("flags p=none (monitoring only) as medium", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      dohResponse([{ data: "v=DMARC1; p=none; rua=mailto:dmarc@example.com" }]),
    );
    const vulns = await checkDmarc("example.com");
    expect(vulns.some((v) => v.severity === "medium" && /none/i.test(v.name))).toBe(true);
  });

  it("flags missing rua= as info", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      dohResponse([{ data: "v=DMARC1; p=quarantine" }]),
    );
    const vulns = await checkDmarc("example.com");
    expect(vulns.some((v) => v.severity === "info" && /rua/i.test(v.name))).toBe(true);
  });

  it("returns no vulns for a fully enforced DMARC record with rua=", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      dohResponse([{ data: "v=DMARC1; p=reject; rua=mailto:dmarc@example.com" }]),
    );
    expect(await checkDmarc("example.com")).toHaveLength(0);
  });

  it("flags p=none AND missing rua= as two separate findings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      dohResponse([{ data: "v=DMARC1; p=none" }]),
    );
    const vulns = await checkDmarc("example.com");
    expect(vulns.length).toBeGreaterThanOrEqual(2);
  });
});
