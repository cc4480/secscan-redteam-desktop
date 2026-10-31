/**
 * Q-REPORT-DETAIL — the renderer half (Agent B's tests; spec §12.9–13).
 *
 * The fixture is the locked parity record (spec §10): engagement
 * parity-2026-10-28 against secscan.us, grade F 20/100 anchored by a
 * confirmed critical BOLA, 3 confirmed findings, 22 battery items, 17 of
 * 21 arms probed. Derivations come from detail.ts (Agent A); these tests
 * pin the WIRING: the §9 anatomy order, the no-baseline panel with zero
 * delta strings, the baseline cover math, and the reconciliation of
 * risk-area / pillar counts against the cover total in the RENDERED
 * document.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReportDetail, type DetailInput } from "../src/report/detail.js";
import { renderEngagementReportHtml, type EngagementReportInput } from "../src/report/html/render.js";
import { gradeBanner, gradeFindings } from "../src/report/grading.js";
import { type ReportMeta } from "../src/report/html.js";
import { type Finding } from "../src/types.js";

export const parityFindings: Finding[] = [
  { id: "F-1", severity: "critical", title: "Cross-tenant object access (BOLA)", attackIds: ["T1190"], evidence: "Object of another tenant returned without an ownership check.", fix: "Enforce per-object authorization on every API read. Verify the requesting identity owns the object before returning it.", retest: "Repeat with the second identity; expect 403.", status: "confirmed", accountableOperator: "Carlos" },
  { id: "F-2", severity: "low", title: "Missing Content Security Policy header", attackIds: [], evidence: "No CSP header on the app responses.", fix: "Add a Content-Security-Policy header. Start with default-src 'self'.", retest: "Fetch the app root; expect the header.", status: "confirmed", accountableOperator: "Carlos" },
  { id: "F-3", severity: "info", title: "robots.txt discloses hidden paths", attackIds: [], evidence: "Disallow entries name internal paths.", fix: "Remove internal paths from robots.txt.", retest: "Fetch robots.txt; expect no internal paths.", status: "confirmed", accountableOperator: "Carlos" },
];

const ARMS_RAN = [
  "bola", "api", "webhook", "redteam",
  "aggressive_ssti", "aggressive_nosql", "aggressive_xxe", "aggressive_crlf", "aggressive_host_header",
  "csrf", "dom_xss", "deserialization", "prototype_pollution", "price_manipulation",
  "auth_rate_limit", "i18n", "edge_function", "secscan-engine",
];

export function parityDetailInput(over: Partial<DetailInput> = {}): DetailInput {
  return {
    target: "https://secscan.us",
    mode: "red",
    dryRun: false,
    posture: { score: 20, grade: "F", postureRating: "CRITICAL" },
    worstConfirmed: { id: "F-1", severity: "critical", title: "Cross-tenant object access (BOLA)" },
    findingsBySeverity: { critical: 1, high: 0, medium: 0, low: 1, info: 1 },
    tierCounts: { proven: 0, confirmed: 3, deferred: 0 },
    findings: [
      { id: "F-1", title: "Cross-tenant object access (BOLA)", severity: "critical", tier: "confirmed", attackIds: ["T1190"], sourceLabel: "bola-idor", signals: [], fix: parityFindings[0]!.fix },
      { id: "F-2", title: "Missing Content Security Policy header", severity: "low", tier: "confirmed", attackIds: [], sourceLabel: "Injection Defense", signals: ["WSTG-CONF-12", "CWE-79"], fix: parityFindings[1]!.fix },
      { id: "F-3", title: "robots.txt discloses hidden paths", severity: "info", tier: "confirmed", attackIds: [], sourceLabel: "Information Disclosure", signals: [], fix: parityFindings[2]!.fix },
    ],
    coverage: {
      totals: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
      probesUsed: 36,
      fullBattery: true,
      notCovered: ["credential_chain", "stored_xss", "weak_session", "llm"],
      planOnly: [],
      arms: ARMS_RAN.map((name) => ({ name, state: "ran" as const })),
    },
    surface: {
      tlsGrade: "A",
      servedVia: "Cloudflare",
      technologies: ["Cloudflare", "Railway", "Bolt.new", "Tailwind CSS", "Bootstrap", "Ruby on Rails"],
    },
    ...over,
  };
}

export function parityMeta(over: Partial<ReportMeta> = {}): ReportMeta {
  return {
    engagementId: "parity-2026-10-28",
    target: "https://secscan.us",
    mode: "red",
    environment: "production",
    tier: 1,
    operator: "Carlos",
    client: "SecScan",
    status: "complete",
    phase: "done",
    verified: true,
    objective: "Assess the public surface",
    startedAt: "2026-10-28T09:00:00.000Z",
    generatedAt: "2026-10-28T10:00:00.000Z",
    findings: { critical: 1, high: 0, medium: 0, low: 1, info: 1 },
    battery: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
    ...over,
  };
}

export function parityRenderInput(over: Partial<EngagementReportInput> = {}): EngagementReportInput {
  return {
    meta: parityMeta(),
    title: "Penetration Test Report",
    narrativeMd: "The team mapped the surface and tested the tenant boundary.",
    posture: gradeFindings(parityFindings),
    banner: gradeBanner(parityFindings),
    findings: parityFindings,
    bundles: new Map(),
    noBundleReasons: new Map(),
    negativeProof: [],
    findingMeta: new Map(),
    coverage: {
      fullBattery: true,
      cells: [{ target: "webapp", category: "validation", state: "done" }],
      totals: { total: 22, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 },
      probesUsed: 36,
      planOnly: [],
      notCovered: ["credential_chain", "stored_xss", "weak_session", "llm"],
    },
    activity: { eventCount: 0, rows: [], totalActions: 0, decisions: [], danglingCauses: [] },
    detail: buildReportDetail(parityDetailInput()),
    ...over,
  };
}

const html = renderEngagementReportHtml(parityRenderInput());

function section(htmlText: string, title: string): string {
  const start = htmlText.indexOf(`>${title}<`);
  assert.ok(start >= 0, `section ${title} present`);
  const next = htmlText.indexOf(`<h2 class="sec-title">`, start + 1);
  return htmlText.slice(start, next === -1 ? undefined : next);
}

describe("report detail — §9 anatomy", () => {
  it("renders the detail sections in the §9 order", () => {
    const marks = [
      "Engagement Report",
      "Detailed Executive Breakdown",
      "What Changed",
      "Key Risk Areas",
      "Business Impact",
      ">Findings<",
      "Complete Fix Prompt",
      "Priority Actions",
      "Pillar Coverage",
      ">Coverage<",
      "Surface &amp; Coverage Detail",
      "Artifacts:",
    ];
    let last = -1;
    for (const m of marks) {
      const i = html.indexOf(m);
      assert.ok(i > last, `marker ${JSON.stringify(m)} in §9 order`);
      last = i;
    }
  });

  it("keeps the document self-contained (zero external references)", () => {
    assert.ok(!/<(script|link|img)[^>]+(src|href)=/i.test(html));
    assert.ok(!/@import|url\(\s*["']?https?:/i.test(html));
  });
});

describe("report detail — no-baseline state", () => {
  it("shows the designed first-scan panel, verbatim in substance", () => {
    assert.match(html, /First recorded scan of this target by this engine/);
    assert.match(html, /This report is the baseline: the next scan of https:\/\/secscan\.us will be diffed against it\./);
  });

  it("contains zero delta strings anywhere (no fabricated comparison)", () => {
    assert.ok(!html.includes("Δ"), "no Δ without a baseline");
    assert.ok(!html.includes('<div class="delta-line">'), "no cover delta line without a baseline");
  });

  it("renders the honest pillar states: NO ARM never reads SECURE", () => {
    const pillars = section(html, "Pillar Coverage");
    for (const p of ["SAST", "IAST", "SCA"]) assert.ok(pillars.includes(p), `${p} card present`);
    assert.equal((pillars.match(/NO ARM/g) ?? []).length, 3, "SAST/IAST/SCA are NO ARM");
    assert.match(pillars, /MAPPED/, "EASM is MAPPED from recon facts");
  });

  it("shows only the surface rows the parity record carries", () => {
    const surface = section(html, "Surface &amp; Coverage Detail");
    assert.match(surface, /TLS grade/);
    assert.match(surface, /Cloudflare/);
    assert.match(surface, /Ruby on Rails/);
    assert.ok(!/Resolved IP/.test(surface), "no invented IP row");
  });
});

describe("report detail — reconciliation (rendered)", () => {
  it("risk-area member rows sum to the actionable total", () => {
    const areas = section(html, "Key Risk Areas");
    const rows = (areas.match(/href="#finding-/g) ?? []).length;
    assert.equal(rows, 3, "three member rows for three actionable findings");
  });

  it("pillar attribution sums to the actionable total", () => {
    const d = buildReportDetail(parityDetailInput());
    const pillarSum = d.pillars.reduce((n, p) => n + p.findingCount, 0);
    const areaSum = d.riskAreas.reduce((n, a) => n + a.findings.length, 0);
    assert.equal(areaSum, d.actionableCount);
    assert.equal(pillarSum, d.actionableCount);
    assert.equal(d.actionableCount, 3);
  });

  it("priority actions are ranked by the anchored weights (critical first)", () => {
    const prio = section(html, "Priority Actions");
    const order = ["F-1", "F-2", "F-3"].map((id) => prio.indexOf(`Fix ${id}`));
    assert.ok(order[0]! >= 0 && order[0]! < order[1]! && order[1]! < order[2]!, "F-1 → F-2 → F-3");
    assert.match(prio, /Enforce per-object authorization on every API read\./, "fix text is the finding's own first sentence");
  });

  it("business impact fires rule 1 (confirmed critical) with the incident sentence", () => {
    const impact = section(html, "Business Impact");
    assert.match(impact, /Material business risk/);
    assert.match(impact, /Treat as an incident until the fix is verified by retest\./);
  });
});

describe("report detail — baseline render", () => {
  const baselineInput = parityDetailInput({
    baseline: {
      engagementId: "eng-2026-10-20-base",
      startedAt: "2026-10-20T09:00:00.000Z",
      dryRun: false,
      score: 16,
      grade: "F",
      findings: [
        { id: "F-1", title: "Cross-tenant object access (BOLA)", severity: "critical", tier: "confirmed", attackIds: ["T1190"], sourceLabel: "", signals: [], fix: "" },
        { id: "F-2", title: "Missing Content Security Policy header", severity: "low", tier: "confirmed", attackIds: [], sourceLabel: "", signals: [], fix: "" },
        { id: "F-3", title: "Outdated TLS configuration", severity: "medium", tier: "confirmed", attackIds: [], sourceLabel: "", signals: [], fix: "" },
        { id: "F-4", title: "Verbose server banner", severity: "info", tier: "confirmed", attackIds: [], sourceLabel: "", signals: [], fix: "" },
      ],
    },
  });
  const withBase = renderEngagementReportHtml(
    parityRenderInput({
      meta: parityMeta({ baseline: { engagementId: "eng-2026-10-20-base", startedAt: "2026-10-20T09:00:00.000Z", score: 16, grade: "F" } }),
      detail: buildReportDetail(baselineInput),
    }),
  );

  it("cover carries the delta line with correct signs (+4 score, −1 findings)", () => {
    assert.match(withBase, /<div class="delta-line">/);
    assert.match(withBase, /Δ score <span class="d-good">\+4<\/span>/);
    assert.match(withBase, /Δ findings <span class="d-good">−1<\/span>/);
    assert.match(withBase, /since 2026-10-20/);
  });

  it("counts-only baseline: section diffs counts, cover shows no delta line", () => {
    const countsOnly = renderEngagementReportHtml(
      parityRenderInput({
        meta: parityMeta({ baseline: { engagementId: "eng-2026-10-20-base", startedAt: "2026-10-20T09:00:00.000Z" } }),
        detail: buildReportDetail(
          parityDetailInput({
            baseline: { ...baselineInput.baseline!, score: undefined, grade: undefined },
          }),
        ),
      }),
    );
    const changed = section(countsOnly, "What Changed");
    assert.match(changed, /predates recorded scores/);
    assert.match(changed, /Δ findings −1/);
    assert.ok(!countsOnly.includes('<div class="delta-line">'), "§2.3: no cover line without a recorded score");
  });

  it("what-changed names the baseline and lists resolved findings by title", () => {
    const changed = section(withBase, "What Changed");
    assert.match(changed, /Since eng-2026-10-20-base · 2026-10-20T09:00:00\.000Z/);
    assert.match(changed, /1 new · 2 resolved · 0 worsened/);
    assert.match(changed, /Outdated TLS configuration/);
    assert.match(changed, /Verbose server banner/);
  });
});

describe("report detail — zero findings", () => {
  const zero = renderEngagementReportHtml(
    parityRenderInput({
      findings: [],
      posture: gradeFindings([]),
      banner: gradeBanner([]),
      detail: buildReportDetail(
        parityDetailInput({
          posture: { score: 100, grade: "A", postureRating: "EXCELLENT" },
          worstConfirmed: null,
          findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          tierCounts: { proven: 0, confirmed: 0, deferred: 0 },
          findings: [],
        }),
      ),
    }),
  );

  it("omits risk areas, renders the zero priority entry and zero impact sentence", () => {
    assert.ok(!zero.includes("Key Risk Areas"), "no empty risk-area section");
    assert.match(zero, /No action required/);
    assert.match(zero, /No material business risk identified from this pass/);
    assert.match(zero, /Zero Vulnerabilities Outstanding/);
  });
});
