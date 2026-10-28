/**
 * The unified HTML report renderer (design study Part D).
 *
 * The properties pinned here are the design's honesty rules: the PROVEN
 * badge exists only behind an execution-tier PoC bundle; a confirmed
 * finding without a bundle states the reason; the gauge is posture math
 * from the one grading voice; a halted engagement shows the N/A state,
 * never a passing number; and the file is a single self-contained
 * document in the unified token system.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderEngagementReportHtml, type EngagementReportInput } from "../src/report/html/render.js";
import { buildFindingMeta, stripFindingsJson } from "../src/report/html/wire.js";
import { buildFixPrompt } from "../src/report/html/sections.js";
import { gradeBanner, gradeFindings } from "../src/report/grading.js";
import { type ReportMeta } from "../src/report/html.js";
import { type Finding } from "../src/types.js";
import { type PocBundle } from "../src/proof/index.js";

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
  { id: "F-2", severity: "high", title: "Verbose errors disclose stack <script>alert(1)</script>", attackIds: [], evidence: "The error page prints a full stack trace.", fix: "Return generic errors.", retest: "Trigger the error; expect a generic page.", status: "confirmed", accountableOperator: "Carlos" },
  { id: "F-3", severity: "medium", title: "Missing rate limiting on login", attackIds: ["T1110"], evidence: "20 rapid attempts accepted.", fix: "Add rate limiting.", retest: "Repeat the burst; expect throttling.", status: "confirmed", accountableOperator: "Carlos" },
  { id: "F-4", severity: "low", title: "Cookie without Secure flag", attackIds: [], evidence: "Session cookie lacks Secure.", fix: "Set Secure.", retest: "Inspect Set-Cookie.", status: "deferred", accountableOperator: "Carlos" },
  { id: "F-5", severity: "info", title: "SQL injection in search", attackIds: ["T1190"], evidence: "Tested and excluded.", fix: "", retest: "", status: "killed", accountableOperator: "Carlos" },
];

const bundles = new Map<string, PocBundle>([
  ["F-1", bundle({})],
  ["F-2", bundle({ findingId: "F-2", validationTier: "observation", markerSent: undefined, markerObserved: undefined, proves: "The stack trace was observed in the response.", reverifyCommand: "node reverify.mjs --finding F-2" })],
]);

function input(over: Partial<EngagementReportInput> = {}): EngagementReportInput {
  return {
    meta,
    title: "Penetration Test Report",
    narrativeMd: "The team mapped the surface and tested the auth boundary.\n\n```json\n{\"findings\": []}\n```",
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
    ...over,
  };
}

const html = renderEngagementReportHtml(input());

describe("unified report — document discipline", () => {
  it("is one self-contained file: no external requests, scripts off readable", () => {
    assert.match(html, /^<!doctype html>/i);
    assert.ok(!/<(script|link|img)[^>]+(src|href)=/i.test(html), "no external asset references");
    assert.ok(!/@import|url\(\s*["']?https?:/i.test(html), "no remote CSS");
    assert.match(html, /noindex,nofollow/);
  });

  it("uses the unified tokens (Seclayer severity hexes, zinc theme)", () => {
    for (const hex of ["#f87171", "#fb7185", "#fbbf24", "#60a5fa", "#22c55e", "#09090b", "#27272a"]) {
      assert.ok(html.includes(hex), `token ${hex} present`);
    }
  });

  it("escapes target-derived text", () => {
    assert.ok(!html.includes("<script>alert(1)</script>"), "raw script must not survive");
    assert.ok(html.includes("&lt;script&gt;"), "it is escaped");
  });

  it("carries the print discipline", () => {
    assert.match(html, /@media print/);
    assert.match(html, /@page\{margin:1\.5cm 2cm\}/);
    assert.match(html, /break-inside:avoid/);
  });
});

describe("unified report — sections in the design order", () => {
  const marks = [
    "Engagement Report", // cover eyebrow
    "Critical Risk", // posture banner
    "Executive Summary",
    ">Coverage<",
    "class=\"sevrow\"", // severity chips
    "Proven — 1",
    "Confirmed — 2",
    "Deferred — 1",
    "Ruled out — 2",
    "Complete Fix Prompt",
    "Tool Activity",
    "Artifacts:",
  ];
  it("renders every section, in order", () => {
    let last = -1;
    for (const m of marks) {
      const i = html.indexOf(m);
      assert.ok(i > last, `section marker ${JSON.stringify(m)} found after the previous one`);
      last = i;
    }
  });

  it("shows the gauge with the anchored posture grade", () => {
    // One confirmed critical anchors the grade at F / 20 (grading seam).
    assert.match(html, /class="gauge"/);
    assert.match(html, />20<small>\/100<\/small>/);
    assert.match(html, /Grade F — Critical/);
    assert.match(html, /CRITICAL/); // posture rating word
  });

  it("shows the coverage strip with honest limits", () => {
    assert.match(html, /Probed/);
    assert.match(html, /Blocked/);
    assert.match(html, /Not covered/);
    assert.match(html, /Honest limits/);
    assert.match(html, /kerberos ticket material/);
    assert.match(html, /10 battery items: 3 confirmed/);
  });

  it("shows tool activity with the causality line", () => {
    assert.match(html, /128 events across 1 distinct actions/);
    assert.match(html, /Causality integrity: every causedBy link resolves\./);
    assert.match(html, /sign_off \(seq 120\)/);
  });
});

describe("unified report — tier honesty", () => {
  it("badges PROVEN only behind the execution-tier bundle, with its receipt", () => {
    assert.match(html, /✓ PROVEN/);
    assert.match(html, /Exploit Receipt — Proven Live/);
    assert.match(html, /<mark>REDTEAM-MARKER-abc123<\/mark>/, "observed marker highlighted in the steps");
    assert.match(html, /Does not prove: It does not prove data beyond the canary/);
  });

  it("an observation bundle is a receipt, never a PROVEN badge", () => {
    assert.match(html, /Observation Receipt — Captured Steps/);
    assert.equal((html.match(/✓ PROVEN/g) ?? []).length, 1, "exactly one PROVEN badge in the document");
  });

  it("a confirmed finding without a bundle states the reason", () => {
    assert.match(html, /No replayable bundle — finding F-3: no correlated tool execution/);
  });

  it("ruled-out group carries negative proof, deduped against killed findings", () => {
    assert.match(html, /Open redirect on logout/);
    assert.match(html, /Redirect target is allow-listed\./);
    // "SQL injection in search" appears once as the killed finding card, not twice.
    assert.equal(html.split("SQL injection in search").length - 1, 1);
  });

  it("the fix prompt covers actionable confirmed findings only", () => {
    const prompt = buildFixPrompt(meta.target, findings, bundles);
    assert.match(prompt, /Unauthenticated access/);
    assert.match(prompt, /Reverify: node reverify\.mjs --finding F-1/);
    assert.ok(!prompt.includes("Cookie without Secure flag"), "deferred findings are excluded");
    assert.ok(!prompt.includes("SQL injection in search"), "killed findings are excluded");
  });
});

describe("unified report — states", () => {
  it("zero findings renders the all-clear panel, not a bare pass", () => {
    const clean = renderEngagementReportHtml(input({ findings: [], bundles: new Map(), negativeProof: [], posture: gradeFindings([]), banner: gradeBanner([]) }));
    assert.match(clean, /Zero Vulnerabilities Outstanding/);
    assert.match(clean, />100<small>\/100<\/small>/);
    assert.match(clean, /Grade A — Excellent/);
  });

  it("a halted engagement renders the N/A gauge and the halt reason", () => {
    const halted = renderEngagementReportHtml(input({ haltedReason: "Action cap reached (400).", meta: { ...meta, status: "halted" } }));
    assert.match(halted, />—<small>\/100<\/small>/);
    assert.match(halted, /Grade N\/A — Incomplete/);
    assert.match(halted, /Engagement Halted/);
    assert.match(halted, /Action cap reached \(400\)\./);
    assert.ok(!halted.includes("Critical Risk"), "no posture banner on a halted cover");
  });
});

describe("wire helpers", () => {
  it("stripFindingsJson removes only a findings JSON block", () => {
    const md = "Narrative prose.\n\n```json\n{\"findings\": [{\"id\": \"F-1\"}]}\n```\n";
    assert.equal(stripFindingsJson(md), "Narrative prose.");
    const other = "Prose.\n\n```json\n{\"unrelated\": true}\n```";
    assert.equal(stripFindingsJson(other), other);
    assert.equal(stripFindingsJson("plain prose, no fences"), "plain prose, no fences");
  });

  it("buildFindingMeta resolves category + OWASP from the battery item", () => {
    const map = buildFindingMeta(new Map([["F-9", bundle({ findingId: "F-9", batteryItemId: "webapp:WA-002" })]]));
    assert.deepEqual(map.get("F-9"), { category: "validation", owasp: "WSTG-CONF-12" });
    assert.equal(buildFindingMeta(new Map([["F-8", bundle({ findingId: "F-8" })]])).size, 0);
  });
});
