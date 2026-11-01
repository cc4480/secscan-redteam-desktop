/**
 * Q-RP-7 / Q-RP-8 — front/back matter + "what is working well".
 *
 * The properties worth pinning are the honesty ones: the matter
 * sections render exactly the fields the engagement record carries
 * (absent data => absent row, never invented), the strengths section
 * exists only when executed-clean / ruled-out evidence exists and its
 * counts trace 1:1 to that evidence, and the wire assembly groups the
 * ledger's executed-clean items so their area counts sum to the same
 * executed-clean total the Coverage section prints.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReportMatter, type MatterInput } from "../src/report/detail-matter.js";
import { renderEngagementReportHtml, type EngagementReportInput } from "../src/report/html/render.js";
import { buildEngagementReportInput, type WireDeps } from "../src/report/html/wire.js";
import { gradeBanner, gradeFindings } from "../src/report/grading.js";
import { type ReportMeta } from "../src/report/html.js";
import { type Ctx } from "../src/context.js";
import { type Finding } from "../src/types.js";

const TOTALS = { total: 97, confirmed: 1, executedClean: 16, killed: 1, blocked: 4, na: 0, pending: 0 };

function matterInput(over: Partial<MatterInput> = {}): MatterInput {
  return {
    target: "https://secscan.us",
    objective: "Assess the public surface",
    mode: "red",
    tier: 1,
    environment: "production",
    localHost: false,
    dryRun: false,
    scope: ["secscan.us", "*.secscan.us"],
    outOfScope: ["status.secscan.us"],
    excludedTechniques: ["T1499"],
    stopConditions: ["production outage"],
    testWindow: { start: "2026-10-28T09:00:00.000Z", end: "2026-10-28T17:00:00.000Z" },
    deconflictionContact: "ops@example.com",
    verified: true,
    verifiedAt: "2026-10-28T08:55:00.000Z",
    verificationProof: "DNS TXT token verified",
    operator: "Carlos",
    client: "SecScan",
    startedAt: "2026-10-28T09:00:00.000Z",
    generatedAt: "2026-10-28T10:00:00.000Z",
    fullBattery: true,
    batteryTargets: [
      { id: "secscan", items: 41 },
      { id: "seclayer", items: 56 },
    ],
    categoriesProbed: ["logic", "functionality", "validation"],
    planPhases: ["plan", "recon", "exploit", "report"],
    probesUsed: 36,
    toolActions: 12,
    eventCount: 120,
    totals: TOTALS,
    notCovered: ["credential_chain"],
    planOnly: ["secscan:SS-064 [needs: kerberos ticket material]"],
    blockedCells: ["secscan:logic"],
    executedClean: 16,
    cleanAreas: [
      { target: "secscan", category: "logic", items: 6 },
      { target: "secscan", category: "validation", items: 10 },
    ],
    ruledOut: ["Weak session fixation", "Reflected XSS in search"],
    ...over,
  };
}

describe("report matter — scope & authorisation rows carry exactly the record", () => {
  it("renders every ROE field present, verbatim", () => {
    const m = buildReportMatter(matterInput());
    assert.deepEqual(
      m.scopeRows.map((r) => r.label),
      ["Target", "Objective", "In scope", "Out of scope", "Excluded techniques", "Test window", "Stop conditions", "Deconfliction contact"],
    );
    assert.equal(m.scopeRows.find((r) => r.label === "In scope")?.value, "secscan.us, *.secscan.us");
    assert.equal(m.scopeRows.find((r) => r.label === "Out of scope")?.value, "status.secscan.us");
    assert.equal(
      m.scopeRows.find((r) => r.label === "Test window")?.value,
      "2026-10-28T09:00:00.000Z → 2026-10-28T17:00:00.000Z",
    );
  });

  it("omits rows for data the record does not carry", () => {
    const m = buildReportMatter(
      matterInput({
        objective: "",
        outOfScope: [],
        excludedTechniques: [],
        stopConditions: [],
        testWindow: undefined,
        deconflictionContact: undefined,
      }),
    );
    assert.deepEqual(m.scopeRows.map((r) => r.label), ["Target", "In scope"]);
  });

  it("states the verification record — proof and timestamp when verified", () => {
    const m = buildReportMatter(matterInput());
    assert.deepEqual(
      m.authorisationRows.map((r) => r.label),
      ["Ownership verification", "Verification proof", "Verified at", "Accountable operator", "Client", "Engagement started", "Report generated"],
    );
    assert.equal(m.authorisationRows[0]?.value, "Verified");
    assert.equal(m.authorisationRows.find((r) => r.label === "Verification proof")?.value, "DNS TXT token verified");
  });

  it("states Not verified plainly, with no proof rows, when unverified", () => {
    const m = buildReportMatter(
      matterInput({ verified: false, verifiedAt: undefined, verificationProof: undefined, operator: undefined, client: undefined }),
    );
    assert.equal(m.authorisationRows[0]?.value, "Not verified");
    assert.ok(!m.authorisationRows.some((r) => r.label === "Verification proof"));
    assert.ok(!m.authorisationRows.some((r) => r.label === "Verified at"));
  });
});

describe("report matter — method & risk-rating lines", () => {
  it("composes the full-battery composition from the selected targets", () => {
    const m = buildReportMatter(matterInput());
    assert.match(m.methodLines[0]!, /^red mode · autonomy tier 1 · production environment\.$/);
    assert.ok(
      m.methodLines.some((l) => l.includes("Full battery — 2 target batteries (secscan, seclayer), 97 battery items")),
      "battery items sum from the per-target counts",
    );
    assert.ok(m.methodLines.some((l) => l.includes("plan → recon → exploit → report")));
    assert.ok(m.methodLines.some((l) => l.includes("120 audit events · 12 distinct tool actions · 36 probes")));
  });

  it("composes the scoped composition from the probed categories only", () => {
    const m = buildReportMatter(
      matterInput({ fullBattery: false, batteryTargets: [], categoriesProbed: ["validation"], planPhases: [], eventCount: 0, toolActions: 0, probesUsed: 0 }),
    );
    assert.ok(m.methodLines.some((l) => l.includes("Scoped run — probed categories: validation (of logic, functionality, validation).")));
    assert.ok(!m.methodLines.some((l) => l.includes("Full battery")));
    assert.equal(m.methodLines.length, 2, "mode line + scoped line only — no plan/activity lines without recorded facts");
  });

  it("states the anchored grading method from the fixed tables", () => {
    const m = buildReportMatter(matterInput());
    const text = m.riskMethodLines.join("\n");
    assert.match(text, /critical 35 · high 25 · medium 15 · low 5 · info 0/);
    assert.match(text, /one confirmed critical caps the score at 20/);
    assert.match(text, /one confirmed high caps the score at 45/);
    assert.match(text, /floors at 10/);
    assert.match(text, /×0\.5 at medium confidence, ×0\.25 at low/);
    assert.match(text, /Only confirmed findings are graded/);
  });
});

describe("report matter — limitations from the coverage record", () => {
  it("restates blocked, plan-only, not-covered, pending and na facts", () => {
    const m = buildReportMatter(matterInput({ totals: { ...TOTALS, pending: 2, na: 3 } }));
    assert.ok(m.limitationLines.includes("Blocked (prerequisite not met): secscan:logic"));
    assert.ok(m.limitationLines.includes("Executes when its prerequisite is supplied: secscan:SS-064 [needs: kerberos ticket material]"));
    assert.ok(m.limitationLines.includes("Not covered: credential_chain"));
    assert.ok(m.limitationLines.some((l) => l.startsWith("2 battery item(s) had no verdict")));
    assert.ok(m.limitationLines.some((l) => l.startsWith("3 battery item(s) were recorded not-applicable")));
  });

  it("names the halt and the dry run when the record carries them", () => {
    const m = buildReportMatter(matterInput({ haltedReason: "action cap reached", dryRun: true }));
    assert.ok(m.limitationLines.some((l) => l.includes("halted before completion: action cap reached")));
    assert.ok(m.limitationLines.some((l) => l.includes("Dry run — agent decisions were simulated")));
  });

  it("states the no-limitations line only when nothing is outstanding", () => {
    const m = buildReportMatter(
      matterInput({ totals: { ...TOTALS, blocked: 0, pending: 0, na: 0 }, notCovered: [], planOnly: [], blockedCells: [] }),
    );
    assert.deepEqual(m.limitationLines, [
      "Nothing in the coverage record was blocked, left uncovered, or left pending at report time.",
    ]);
  });
});

describe("report matter — strengths trace 1:1 to the evidence", () => {
  it("counts and areas come from the executed-clean / ruled-out inputs", () => {
    const input = matterInput();
    const m = buildReportMatter(input);
    assert.ok(m.strengths);
    assert.match(m.strengths.summary, /^16 battery check\(s\) executed and returned no finding · 2 hypothesis\(es\) were tested and ruled out\./);
    assert.deepEqual(m.strengths.areaLines, [
      "secscan · logic: 6 check(s) ran and produced no finding",
      "secscan · validation: 10 check(s) ran and produced no finding",
    ]);
    const areaSum = input.cleanAreas.reduce((n, a) => n + a.items, 0);
    assert.equal(areaSum, input.executedClean, "fixture invariant: area counts sum to the executed-clean total");
  });

  it("renders strengths from ruled-out evidence alone", () => {
    const m = buildReportMatter(matterInput({ executedClean: 0, cleanAreas: [], ruledOut: ["Reflected XSS in search"] }));
    assert.ok(m.strengths);
    assert.match(m.strengths.summary, /^1 hypothesis\(es\) were tested and ruled out\./);
    assert.deepEqual(m.strengths.areaLines, []);
  });

  it("produces NO strengths section when there is no such evidence", () => {
    const m = buildReportMatter(matterInput({ executedClean: 0, cleanAreas: [], ruledOut: [] }));
    assert.equal(m.strengths, undefined);
  });
});

const FINDINGS: Finding[] = [
  { id: "F-1", severity: "critical", title: "Cross-tenant object access (BOLA)", attackIds: ["T1190"], evidence: "Object of another tenant returned.", fix: "Enforce per-object authorization.", retest: "Repeat with the second identity.", status: "confirmed", accountableOperator: "Carlos" },
];

function renderInput(over: Partial<EngagementReportInput> = {}): EngagementReportInput {
  return {
    meta: {
      engagementId: "eng-matter",
      target: "https://secscan.us",
      mode: "red",
      environment: "production",
      tier: 1,
      operator: "Carlos",
      status: "complete",
      phase: "done",
      verified: true,
      objective: "Assess the public surface",
      startedAt: "2026-10-28T09:00:00.000Z",
      generatedAt: "2026-10-28T10:00:00.000Z",
      findings: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
    },
    title: "Penetration Test Report",
    narrativeMd: "The team mapped the surface.",
    posture: gradeFindings(FINDINGS),
    banner: gradeBanner(FINDINGS),
    findings: FINDINGS,
    bundles: new Map(),
    noBundleReasons: new Map(),
    negativeProof: [],
    findingMeta: new Map(),
    coverage: {
      fullBattery: true,
      cells: [{ target: "secscan", category: "validation", state: "done" }],
      totals: TOTALS,
      probesUsed: 36,
      planOnly: [],
      notCovered: ["credential_chain"],
    },
    activity: { eventCount: 3, rows: [], totalActions: 2, decisions: [], danglingCauses: [] },
    matter: buildReportMatter(matterInput()),
    ...over,
  };
}

describe("report matter — rendering", () => {
  const html = renderEngagementReportHtml(renderInput());

  it("places front matter before the narrative and back matter before the footer", () => {
    const marks = ["Scope &amp; Authorisation", "Method &amp; Tooling", "Risk Rating Method", "Executive Summary", ">Coverage<", "What Is Working Well", "Tool Activity", "Limitations &amp; Residual Unknowns", "Artifacts:"];
    let last = -1;
    for (const mark of marks) {
      const i = html.indexOf(mark);
      assert.ok(i > last, `marker ${mark} in order`);
      last = i;
    }
  });

  it("renders the recorded scope and authorisation values", () => {
    assert.match(html, /status\.secscan\.us/);
    assert.match(html, /DNS TXT token verified/);
    assert.match(html, /one confirmed critical caps the score at 20/);
    assert.match(html, /<strong>Proven:<\/strong>/, "tier definitions render with the method note");
  });

  it("reconciles: the strengths count equals the coverage executed-clean count", () => {
    assert.match(html, /16 battery check\(s\) executed and returned no finding/);
    assert.match(html, /16 executed-clean/, "the coverage totals line prints the same figure");
  });

  it("escapes hostile record values", () => {
    const hostile = renderEngagementReportHtml(
      renderInput({ matter: buildReportMatter(matterInput({ scope: ['<script>alert(1)</script>'] })) }),
    );
    assert.ok(!hostile.includes("<script>alert(1)</script>"), "raw script tag must not survive");
    assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it("renders no matter sections when the input carries none (pre-matter anatomy)", () => {
    const bare = renderEngagementReportHtml(renderInput({ matter: undefined }));
    for (const t of ["Scope &amp; Authorisation", "Method &amp; Tooling", "Risk Rating Method", "What Is Working Well", "Limitations &amp; Residual Unknowns"]) {
      assert.ok(!bare.includes(t), `${t} absent without matter`);
    }
  });

  it("renders no strengths section when the matter carries no strength evidence", () => {
    const noStrengths = renderEngagementReportHtml(
      renderInput({ matter: buildReportMatter(matterInput({ executedClean: 0, cleanAreas: [], ruledOut: [] })) }),
    );
    assert.ok(!noStrengths.includes("What Is Working Well"));
    assert.ok(noStrengths.includes("Scope &amp; Authorisation"), "front matter still renders");
  });
});

describe("report matter — wire assembly", () => {
  it("groups executed-clean ledger items by area and de-duplicates ruled-out hypotheses", () => {
    const ledgerEntry = (key: string, target: string, itemId: string, category: string, disposition: string) =>
      ({ key, target, itemId, category, name: itemId, disposition }) as never;
    const ctx = {
      input: {
        target: "example.com",
        mode: "red",
        objective: "Assess",
        fullBattery: false,
        localHost: false,
        environment: "staging",
        roe: { scope: ["example.com"], outOfScope: ["cdn.example.com"], excludedTechniques: null, stopConditions: [] },
      },
      config: { dryRunAgents: false },
      coverage: new Set(["validation"]),
      targetCoverage: new Map(),
      itemLedger: new Map([
        ["secscan:SS-001", ledgerEntry("secscan:SS-001", "secscan", "SS-001", "validation", "executed-clean")],
        ["secscan:SS-002", ledgerEntry("secscan:SS-002", "secscan", "SS-002", "validation", "executed-clean")],
        ["secscan:SS-003", ledgerEntry("secscan:SS-003", "secscan", "SS-003", "logic", "executed-clean")],
        ["secscan:SS-004", ledgerEntry("secscan:SS-004", "secscan", "SS-004", "logic", "confirmed")],
      ]),
      probesUsed: 7,
      plan: {
        mode: "red",
        objective: "Assess",
        adversaryProfile: "",
        steps: [
          { phase: "recon", description: "map" },
          { phase: "exploit", description: "test" },
          { phase: "recon", description: "map more" },
        ],
      },
      verifiedAt: "2026-10-28T08:55:00.000Z",
      verificationProof: "DNS TXT token verified",
      events: { dir: "/nonexistent-rp78-wire-dir", engagementId: "eng-wire" },
    } as unknown as Ctx;
    const meta: ReportMeta = {
      engagementId: "eng-wire",
      target: "example.com",
      mode: "red",
      environment: "staging",
      tier: 2,
      status: "complete",
      phase: "done",
      verified: true,
      objective: "Assess",
      startedAt: "2026-10-28T09:00:00.000Z",
      generatedAt: "2026-10-28T10:00:00.000Z",
    };
    const killed: Finding = {
      id: "F-9", severity: "medium", title: "Weak session fixation", attackIds: [],
      evidence: "Session id rotated on login.", fix: "None required.", retest: "Log in twice.",
      status: "killed", accountableOperator: "Carlos",
    };
    const deps: WireDeps = {
      ctx,
      meta,
      title: "Penetration Test Report",
      findings: [killed],
      narrativeMd: "Summary.",
      bundles: new Map(),
      proof: {
        noBundleReasons: new Map(),
        negative: [
          { hypothesis: " weak session fixation ", killingObservation: "rotated", decisiveEvents: [] },
          { hypothesis: "Reflected XSS in search", killingObservation: "encoded", decisiveEvents: [] },
        ],
      },
      cells: [],
      totals: { total: 4, confirmed: 1, executedClean: 3, killed: 0, blocked: 0, na: 0, pending: 0 },
      planOnly: [],
      events: [],
    };
    const input = buildEngagementReportInput(deps);
    assert.ok(input.matter);
    const m = input.matter;
    // Scope/authorisation from the ROE + ctx verification record.
    assert.equal(m.scopeRows.find((r) => r.label === "In scope")?.value, "example.com");
    assert.equal(m.scopeRows.find((r) => r.label === "Out of scope")?.value, "cdn.example.com");
    assert.equal(m.authorisationRows.find((r) => r.label === "Verification proof")?.value, "DNS TXT token verified");
    // Method: scoped composition + de-duplicated plan phases.
    assert.ok(m.methodLines.some((l) => l.includes("Scoped run — probed categories: validation")));
    assert.ok(m.methodLines.some((l) => l.includes("recon → exploit")));
    // Strengths: 3 executed-clean items over 2 areas, summing to the
    // coverage total the same input carries; ruled-out de-duplicated
    // (the negative proof restating the killed finding counts once).
    assert.ok(m.strengths);
    assert.match(m.strengths.summary, /^3 battery check\(s\) executed and returned no finding · 2 hypothesis\(es\) were tested and ruled out\./);
    assert.deepEqual(m.strengths.areaLines, [
      "secscan · logic: 1 check(s) ran and produced no finding",
      "secscan · validation: 2 check(s) ran and produced no finding",
    ]);
    assert.equal(input.coverage.totals.executedClean, 3);
  });
});
