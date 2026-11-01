/**
 * Q-REPORT-TEMPLATES — the cross-format reconciliation proof.
 *
 * ONE fixture engagement (the report-html-design fixture: five
 * findings across every truth tier, an execution bundle, an
 * observation bundle, a no-bundle confirmed finding, negative proofs)
 * rendered through every deliverable writer from the ONE shared
 * report document. The assertions pin the unification contract:
 * the same grade, the same severity counts (the posture's — a killed
 * or deferred finding must not leak into them in ANY format), the
 * same tier counts, the same finding order, and the same section
 * presence in HTML, MD, JSON, TXT, CSV, and DOCX.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { type Ctx } from "../src/context.js";
import { type Finding } from "../src/types.js";
import { type PocBundle } from "../src/proof/index.js";
import { type ReportMeta } from "../src/report/html.js";
import { gradeBanner, gradeFindings } from "../src/report/grading.js";
import { renderEngagementReportHtml, type EngagementReportInput } from "../src/report/html/render.js";
import { buildReportDocument } from "../src/report/document.js";
import { renderReportMarkdown } from "../src/report/markdown.js";
import { buildReportModel, renderReportJson } from "../src/report/deliverables.js";
import { renderReportTxt } from "../src/report/text.js";
import { buildFindingsCsv } from "../src/report/csv.js";
import { buildReportDocx } from "../src/report/docx.js";
import { REPORT_CSS } from "../src/report/html/style.js";

const meta: ReportMeta = {
  engagementId: "eng-2026-10-28-test",
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
  findings: { critical: 1, high: 1, medium: 1, low: 1, info: 0 },
  battery: { total: 10, confirmed: 3, executedClean: 4, killed: 2, blocked: 1, na: 0, pending: 0 },
};

function bundle(over: Partial<PocBundle>): PocBundle {
  return {
    version: 1,
    bundleId: "b-1",
    engagementId: meta.engagementId,
    findingId: "F-1",
    attackIds: ["T1190"],
    severity: "critical",
    title: "t",
    target: meta.target,
    operator: "Carlos",
    generatedAt: meta.generatedAt,
    steps: [
      {
        seq: 7,
        ts: meta.startedAt,
        tool: "http_probe",
        command: "GET /learn",
        result: "200 OK — body contains REDTEAM-MARKER-abc123",
        validation: "marker-echo",
        marker: "REDTEAM-MARKER-abc123",
        replay: null,
      },
    ],
    markerSent: "REDTEAM-MARKER-abc123",
    markerObserved: "REDTEAM-MARKER-abc123",
    validationTier: "execution",
    proves: "The marker was executed and echoed by the target.",
    doesNotProve: "It does not prove data beyond the canary was reachable.",
    reverifyCommand: "node reverify.mjs --finding F-1",
    ...over,
  };
}

const findings: Finding[] = [
  { id: "F-1", severity: "critical", title: "Unauthenticated access to protected resource", attackIds: ["T1190"], evidence: "GET /learn returned another user's object with no credentials.", fix: "Require authentication and enforce object ownership.", retest: "Repeat the request unauthenticated; expect 401.", status: "confirmed", accountableOperator: "Carlos" },
  { id: "F-2", severity: "high", title: "Verbose errors disclose stack trace", attackIds: [], evidence: "The error page prints a full stack trace.", fix: "Return generic errors.", retest: "Trigger the error; expect a generic page.", status: "confirmed", accountableOperator: "Carlos" },
  { id: "F-3", severity: "medium", title: "Missing rate limiting on login", attackIds: ["T1110"], evidence: "20 rapid attempts accepted.", fix: "Add rate limiting.", retest: "Repeat the burst; expect throttling.", status: "confirmed", accountableOperator: "Carlos" },
  { id: "F-4", severity: "low", title: "Cookie without Secure flag", attackIds: [], evidence: "Session cookie lacks Secure.", fix: "Set Secure.", retest: "Inspect Set-Cookie.", status: "deferred", accountableOperator: "Carlos" },
  { id: "F-5", severity: "info", title: "SQL injection in search", attackIds: ["T1190"], evidence: "Tested and excluded.", fix: "", retest: "", status: "killed", accountableOperator: "Carlos" },
];

const bundles = new Map<string, PocBundle>([
  ["F-1", bundle({})],
  ["F-2", bundle({ findingId: "F-2", validationTier: "observation", markerSent: undefined, markerObserved: undefined, proves: "The stack trace was observed in the response.", reverifyCommand: "node reverify.mjs --finding F-2" })],
]);

const input: EngagementReportInput = {
  meta,
  title: "Penetration Test Report",
  narrativeMd: "The team mapped the surface and tested the auth boundary.",
  posture: gradeFindings(findings),
  banner: gradeBanner(findings),
  findings,
  bundles,
  noBundleReasons: new Map([["F-3", "finding F-3: no correlated tool execution in the audit log — no bundle"]]),
  negativeProof: [
    { hypothesis: "SQL injection in search", killingObservation: "Parameterised query confirmed.", decisiveEvents: [] },
    { hypothesis: "Open redirect on logout", killingObservation: "Redirect target is allow-listed.", attackId: "T1204", decisiveEvents: [{ seq: 3, ts: meta.startedAt, tool: "http_probe", result: "302 to /home" }] },
  ],
  findingMeta: new Map([["F-1", { category: "validation", owasp: "WSTG-ATHZ-04" }]]),
  coverage: {
    fullBattery: true,
    cells: [
      { target: "webapp", category: "validation", state: "done" },
      { target: "webapp", category: "logic", state: "blocked" },
      { target: "webapp", category: "functionality", state: "missing" },
    ],
    totals: { total: 10, confirmed: 3, executedClean: 4, killed: 2, blocked: 1, na: 0, pending: 0 },
    probesUsed: 42,
    planOnly: ["webapp:WS-064 [needs: kerberos ticket material]"],
    notCovered: ["webapp:functionality"],
  },
  activity: {
    eventCount: 128,
    rows: [{ action: "http_probe", count: 40, attackIds: ["T1190"], firstSeq: 2, lastSeq: 90 }],
    totalActions: 1,
    decisions: [{ action: "sign_off", seq: 120 }],
    danglingCauses: [],
  },
};

const doc = buildReportDocument(input);
const html = renderEngagementReportHtml(input);
const md = renderReportMarkdown(doc, {
  batteryLine: "Battery coverage: fixture line.",
  proofMd: "",
  integrationsMd: "",
});
const ctxStub = {
  events: { engagementId: meta.engagementId },
  input: { target: meta.target, mode: meta.mode, objective: meta.objective },
  config: { dryRunAgents: false },
} as unknown as Ctx;
const model = buildReportModel(
  ctxStub,
  {
    findings,
    totals: { total: 10, confirmed: 3, executedClean: 4, killed: 2, blocked: 1, na: 0, pending: 0 },
    cells: [
      { t: "webapp", c: "validation", s: "done" },
      { t: "webapp", c: "logic", s: "blocked" },
      { t: "webapp", c: "functionality", s: "missing" },
    ],
  },
  doc,
);
const json = JSON.parse(renderReportJson(model)) as typeof model;
const txt = renderReportTxt(model, doc);
const csv = buildFindingsCsv({
  findings: doc.findingsInReportOrder,
  findingMeta: input.findingMeta,
  bundles,
  target: meta.target,
});
const docxText = strFromU8(unzipSync(buildReportDocx(input))["word/document.xml"]!);

describe("one document — canonical counts", () => {
  it("tiers: 1 proven · 2 confirmed · 1 deferred · 2 ruled out (negative proof deduped)", () => {
    assert.deepEqual(doc.tierCounts, { proven: 1, confirmed: 2, deferred: 1, "ruled-out": 2 });
    assert.deepEqual(
      doc.findingsInReportOrder.map((f) => f.id),
      ["F-1", "F-2", "F-3", "F-4", "F-5"],
    );
  });

  it("severity counts are the posture's in every format — killed/deferred never leak in", () => {
    // Posture counts confirmed findings only: critical 1, high 1,
    // medium 1. An all-findings count would read low 1 / info 1.
    assert.deepEqual(doc.severityCounts, { critical: 1, high: 1, medium: 1, low: 0, info: 0 });
    assert.deepEqual(json.severityCounts, doc.severityCounts);
    assert.deepEqual(json.tierCounts, doc.tierCounts);
    assert.ok(txt.includes("1 critical · 1 high · 1 medium · 0 low · 0 info"), "txt severity line");
    assert.ok(txt.includes("Tiers: 1 proven · 2 confirmed · 1 deferred · 2 ruled out"), "txt tier line");
    assert.ok(md.includes("Severity: 1 critical · 1 high · 1 medium · 0 low · 0 info"), "md severity line");
    assert.ok(md.includes("Tiers: 1 proven · 2 confirmed · 1 deferred · 2 ruled out"), "md tier line");
    assert.ok(html.includes("1 proven · 2 confirmed · 1 deferred · 2 ruled out"), "html accuracy line");
  });

  it("the grade is one verdict everywhere: F, 20/100, anchored by the confirmed critical", () => {
    assert.equal(doc.posture.grade, "F");
    assert.equal(doc.posture.score, 20);
    assert.equal(json.grade?.letter, "F");
    assert.equal(json.grade?.score, 20);
    assert.ok(html.includes(">20<small>/100</small>"), "html gauge");
    assert.ok(md.includes("**Grade F — 20/100**"), "md grade line");
    assert.ok(txt.includes("Grade: F (20/100"), "txt grade line");
    assert.ok(docxText.includes("F (20/100)"), "docx grade line");
  });
});

describe("one document — section presence reconciles", () => {
  const htmlMarks: Record<string, string> = {
    cover: "Engagement Report",
    banner: "Critical Risk",
    "executive-summary": "Executive Summary",
    coverage: ">Coverage<",
    findings: "Proven — 1",
    "fix-prompt": "Complete Fix Prompt",
    activity: "Tool Activity",
    footer: "Artifacts:",
  };
  const mdMarks: Record<string, string> = {
    cover: "# Penetration Test Report",
    "executive-summary": "## Executive Summary",
    coverage: "## Coverage",
    "severity-breakdown": "## Severity Breakdown",
    findings: "## Findings",
    "fix-prompt": "## Complete Fix Prompt",
    activity: "## Tool activity (runner-computed",
    footer: "Artifacts: report.md",
  };

  it("the JSON manifest is the document's section list, in canonical order", () => {
    assert.deepEqual(json.sections, [...doc.sections]);
    assert.deepEqual(doc.sections, [
      "cover",
      "banner",
      "executive-summary",
      "coverage",
      "severity-breakdown",
      "findings",
      "fix-prompt",
      "activity",
      "footer",
    ]);
  });

  it("every manifest section renders in the HTML and the MD", () => {
    for (const s of doc.sections) {
      const hm = htmlMarks[s];
      if (hm) assert.ok(html.includes(hm), `html carries ${s} (${hm})`);
      const mm = mdMarks[s];
      if (mm) assert.ok(md.includes(mm), `md carries ${s} (${mm})`);
    }
    assert.ok(docxText.includes("Complete Fix Prompt"), "docx carries the fix prompt");
    assert.ok(docxText.includes("Coverage"), "docx carries coverage");
    assert.ok(txt.includes("Complete Fix Prompt"), "txt carries the fix prompt");
  });

  it("HTML sections appear in the canonical order", () => {
    const order = ["Engagement Report", "Critical Risk", "Executive Summary", ">Coverage<", "Proven — 1", "Complete Fix Prompt", "Tool Activity", "Artifacts:"];
    let last = -1;
    for (const mark of order) {
      const i = html.indexOf(mark);
      assert.ok(i > last, `${mark} in canonical position`);
      last = i;
    }
  });

  it("the fix prompt text is identical in JSON, MD, TXT, and HTML", () => {
    assert.ok(doc.fixPrompt.length > 0);
    assert.equal(json.fixPrompt, doc.fixPrompt);
    assert.ok(md.includes(doc.fixPrompt), "md embeds the prompt verbatim");
    assert.ok(txt.includes(doc.fixPrompt), "txt embeds the prompt verbatim");
    assert.ok(html.includes("Unauthenticated access to protected resource"), "html fix prompt names the finding");
    assert.ok(!doc.fixPrompt.includes("Cookie without Secure flag"), "deferred findings stay out");
  });
});

describe("one document — CSV and flagship discipline", () => {
  it("CSV rows follow report order with the document's proof states", () => {
    const rows = csv.trimEnd().split("\r\n");
    assert.equal(rows.length, 6, "header + one row per finding");
    const ids = rows.slice(1).map((r) => r.split(",")[0]);
    assert.deepEqual(ids, ["F-1", "F-2", "F-3", "F-4", "F-5"]);
    const states = rows.slice(1).map((r) => r.split(",")[7]);
    assert.deepEqual(states, ["proven", "confirmed", "confirmed", "deferred", "ruled-out"]);
  });

  it("the HTML stays one self-contained file on the locked glass system", () => {
    assert.ok(!/<(script|link|img)[^>]+(src|href)=/i.test(html), "no external asset references");
    assert.ok(!/@import|url\(\s*["']?https?:/i.test(html), "no remote CSS");
    assert.ok(REPORT_CSS.includes("backdrop-filter:blur(14px) saturate(170%)"), "glass blur + saturate from the locked recipe");
    assert.ok(REPORT_CSS.includes("prefers-reduced-motion:reduce"), "reduced-motion final states");
    assert.ok(REPORT_CSS.includes("@media print"), "print final states");
    assert.ok(REPORT_CSS.includes("cubic-bezier(.22,1,.36,1)"), "house motion curve");
    for (const hex of ["#f87171", "#fb7185", "#fbbf24", "#60a5fa", "#22c55e", "#09090b", "#27272a"]) {
      assert.ok(html.includes(hex), `token ${hex} present`);
    }
  });
});
