/**
 * Q-RP-11 — the host-inventory report half: the artifact contract
 * (parse / read / reconcile), the inventory sections' rendering and
 * honesty rules, and the full-report wiring. The collector is stubbed
 * by fixture artifacts — a written host-inventory.json in a canned
 * engagement dir is exactly what the report phase consumes.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  derivedTotals, parseHostInventory, readHostInventory, reconcileInventory,
  type HostInventoryArtifact,
} from "../src/report/host-inventory.js";
import { inventorySection } from "../src/report/html/inventory-sections.js";
import { renderEngagementReportHtml, type EngagementReportInput } from "../src/report/html/render.js";
import { gradeBanner, gradeFindings } from "../src/report/grading.js";
import { type ReportMeta } from "../src/report/html.js";

/** Fixture artifact (raw JSON shape, as a collector would write it). */
export function fixtureInventory(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "ok",
    inventory: {
      hostname: "CHO-ZEN1",
      collectedAt: "2026-10-31T16:30:00.000Z",
      collector: "pc-agent local collect v1",
      system: [
        { label: "OS", value: "Windows 11 Pro 25H2" },
        { label: "CPU", value: "Intel i5-7600" },
      ],
      volumes: [
        { name: "C:", fileSystem: "NTFS", sizeBytes: 512_110_190_592, freeBytes: 84_000_000_000 },
        { name: "D:", fileSystem: "NTFS", sizeBytes: 1_024_000_000_000, freeBytes: 400_000_000_000 },
        { name: "E:", fileSystem: "exFAT", sizeBytes: 2_048_000_000_000, freeBytes: 900_000_000_000 },
      ],
      accounts: [
        { name: "Cho-zen", kind: "local user", enabled: true, groups: ["Administrators"] },
        { name: "Guest", kind: "local user", enabled: false, groups: ["Guests"] },
      ],
      patches: [
        { id: "KB5066133", installedOn: "2026-10-12" },
        { id: "KB5065426", installedOn: "2026-09-09" },
      ],
      processes: [
        { name: "System", pid: 4 },
        { name: "explorer.exe", pid: 900, user: "Cho-zen", cpuPercent: 1.5, memoryPercent: 2.25 },
      ],
      defender: [{ label: "RealTimeProtection", value: "On" }],
      remoteConfig: [
        { label: "SMBv1", value: "Disabled" },
        { label: "RDP", value: "Enabled (NLA)" },
      ],
      hardening: [{ label: "UAC EnableLUA", value: "1" }],
      software: [
        { name: "Docker Desktop", version: "4.34.0", publisher: "Docker Inc." },
        { name: "Evil <script>alert(1)</script> App", version: "1.0", publisher: "Nobody" },
      ],
      filesystem: {
        totalsByVolume: [
          { volume: "C:", files: 100, bytes: 5_000_000 },
          { volume: "D:", files: 50, bytes: 9_000_000 },
        ],
        categories: [{ category: "Executables", files: 40, bytes: 4_000_000 }],
        largestDirectories: [{ path: "C:\\Users", bytes: 3_000_000 }],
        largestFiles: [{ path: "C:\\pagefile.sys", bytes: 2_000_000 }],
        recentExecutables: [{ path: "C:\\Users\\Cho-zen\\Downloads\\tool.exe", modifiedAt: "2026-10-30T10:00:00.000Z" }],
        coverage: "User areas and system roots inventoried.",
      },
      sensitive: {
        categories: [{ category: "Credential files", files: 3 }],
        credentialLocations: [{ location: "%USERPROFILE%\\.aws\\credentials", present: false }],
        stores: [{ store: "Windows Credential Manager", entries: 12 }],
      },
      totals: { volumes: 3, accounts: 2, patches: 2, software: 2, files: 150 },
      ...over,
    },
  };
}

function okArtifact(over: Record<string, unknown> = {}): HostInventoryArtifact {
  return parseHostInventory(fixtureInventory(over));
}

describe("host-inventory artifact contract", () => {
  it("parses an ok artifact; derived totals equal the recorded totals", () => {
    const art = okArtifact();
    assert.equal(art.status, "ok");
    if (art.status !== "ok") return;
    assert.deepEqual(derivedTotals(art.inventory), { volumes: 3, accounts: 2, patches: 2, software: 2, files: 150 });
    assert.deepEqual(reconcileInventory(art.inventory), []);
  });

  it("parses a failed artifact with its error verbatim", () => {
    const art = parseHostInventory({ status: "failed", hostname: "CHO-ZEN1", error: "pc-agent channel closed mid-collect" });
    assert.equal(art.status, "failed");
    if (art.status !== "failed") return;
    assert.equal(art.error, "pc-agent channel closed mid-collect");
  });

  it("fails loud on contract violations instead of guessing", () => {
    const noHostname = fixtureInventory();
    delete (noHostname["inventory"] as Record<string, unknown>)["hostname"];
    assert.throws(() => parseHostInventory(noHostname), /hostname/);
    assert.throws(() => parseHostInventory({ status: "maybe" }), /status/);
    assert.throws(() => parseHostInventory("nope"), /object/);
    const noTotals = fixtureInventory();
    delete (noTotals["inventory"] as Record<string, unknown>)["totals"];
    assert.throws(() => parseHostInventory(noTotals), /totals/);
  });

  it("drops non-contract fields so contents cannot ride the sensitive block", () => {
    const raw = fixtureInventory();
    const inv = raw["inventory"] as Record<string, unknown>;
    (inv["sensitive"] as Record<string, unknown>)["categories"] = [
      { category: "Keys", files: 1, contents: "AKIA-SECRET-VALUE" },
    ];
    const art = parseHostInventory(raw);
    assert.equal(art.status, "ok");
    if (art.status !== "ok") return;
    assert.ok(!JSON.stringify(art).includes("AKIA-SECRET-VALUE"));
  });
});

describe("readHostInventory (the report phase's seam)", () => {
  let tmp = "";
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "host-inv-test-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("absent artifact => undefined (non-local engagements unchanged)", () => {
    assert.equal(readHostInventory(tmp), undefined);
  });

  it("fixture artifact in the engagement dir => ok (stubbed collector)", () => {
    writeFileSync(join(tmp, "host-inventory.json"), JSON.stringify(fixtureInventory()));
    const art = readHostInventory(tmp);
    assert.equal(art?.status, "ok");
  });

  it("broken artifact => the failed form, never a throw, never rows", () => {
    writeFileSync(join(tmp, "host-inventory.json"), "{not json");
    const art = readHostInventory(tmp);
    assert.equal(art?.status, "failed");
    if (art?.status !== "failed") return;
    assert.match(art.error, /unreadable/);
  });
});

describe("inventory sections", () => {
  it("no artifact renders nothing at all", () => {
    assert.equal(inventorySection(undefined), "");
  });

  it("failed collection renders the honest panel and no table", () => {
    const html = inventorySection({ status: "failed", hostname: "CHO-ZEN1", error: "bridge dropped" });
    assert.ok(html.includes("Host &amp; Security Posture Inventory"));
    assert.ok(html.includes("did not complete: bridge dropped"));
    assert.ok(html.includes("not a clean result"));
    assert.ok(!html.includes("<table"));
  });

  it("renders §§6–8 from the fixture with reconciling derived counts", () => {
    const html = inventorySection(okArtifact());
    assert.ok(html.includes("Host &amp; Security Posture Inventory"));
    assert.ok(html.includes("Filesystem Inventory"));
    assert.ok(html.includes("Sensitive Data &amp; Credential Exposure"));
    assert.ok(html.includes("3 volumes · 2 accounts · 2 hotfixes · 2 software entries · 150 files inventoried"));
    assert.ok(html.includes("KB5066133"));
    assert.ok(html.includes("Running processes"));
    assert.ok(html.includes("explorer.exe"));
    assert.ok(html.includes("Windows Credential Manager"));
    assert.ok(html.includes("Presence and counts only"));
    assert.ok(!html.includes("Count reconciliation"));
  });

  it("escapes collector-supplied text", () => {
    const html = inventorySection(okArtifact());
    assert.ok(!html.includes("<script>alert(1)</script> App"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("a recorded-vs-derived disagreement renders as a note, rows win", () => {
    const art = okArtifact({ totals: { volumes: 3, accounts: 2, patches: 2, software: 99, files: 150 } });
    const html = inventorySection(art);
    assert.ok(html.includes("Count reconciliation — software: collector recorded 99, inventory rows carry 2"));
    assert.ok(html.includes("2 software entries"));
  });

  it("optional blocks the collector did not carry render nothing", () => {
    const raw = fixtureInventory();
    const inv = raw["inventory"] as Record<string, unknown>;
    delete inv["filesystem"];
    delete inv["sensitive"];
    delete inv["defender"];
    delete inv["processes"];
    const html = inventorySection(parseHostInventory(raw));
    assert.ok(html.includes("Host &amp; Security Posture Inventory"));
    assert.ok(!html.includes("Filesystem Inventory"));
    assert.ok(!html.includes("Sensitive Data"));
    assert.ok(!html.includes("Microsoft Defender"));
    assert.ok(!html.includes("Running processes"));
  });

  it("A's v1 fallback artifact renders every empty required block as Not collected", () => {
    // The exact fallback shape A's mapper emits at e6b16a3a: real system
    // rows, the four un-enumerable blocks present-but-empty at totals 0,
    // the patchLevel not-collected line, optional blocks omitted.
    const raw = {
      status: "ok",
      inventory: {
        hostname: "CHO-ZEN1",
        collectedAt: "2026-10-31T21:22:00.000Z",
        collector: "local-host collector (pc-agent channel) v1",
        system: [
          { label: "OS", value: "Windows" },
          { label: "Hostname", value: "CHO-ZEN1" },
        ],
        volumes: [],
        accounts: [],
        patches: [],
        patchLevel: "Patch level not collected: the pc-agent channel has no patch-enumeration op (Q-RP-11 v1).",
        software: [],
        totals: { volumes: 0, accounts: 0, patches: 0, software: 0, files: 0 },
      },
    };
    const html = inventorySection(parseHostInventory(raw));
    assert.ok(html.includes("Volumes"));
    assert.ok(html.includes("Local accounts, groups and privilege"));
    assert.ok(html.includes("Patch level"));
    assert.ok(html.includes("Notable installed software"));
    assert.equal((html.match(/Not collected/g) ?? []).length, 4, "one Not collected state per empty required block");
    assert.ok(html.includes(
      "volumes not collected · accounts not collected · hotfixes not collected · " +
      "software not collected · files not collected",
    ));
    assert.ok(!html.includes("0 volumes"), "an unmeasured block is never a measured zero");
    assert.ok(!html.includes("<table"), "no empty tables are presented as collected data");
  });

  it("a present-but-empty processes block is Not collected; rows render when carried", () => {
    const empty = inventorySection(okArtifact({ processes: [] }));
    assert.ok(empty.includes("Running processes"));
    assert.ok(empty.includes("Not collected — the processes block"));
    const carried = inventorySection(okArtifact());
    assert.ok(carried.includes("<td>explorer.exe</td><td>900</td>"));
  });
});

const meta: ReportMeta = {
  engagementId: "eng-2026-10-31-local",
  target: "CHO-ZEN1",
  mode: "red",
  environment: "staging",
  tier: 1,
  operator: "Carlos",
  client: "SecScan",
  status: "complete",
  phase: "done",
  verified: true,
  objective: "Assess this workstation",
  startedAt: "2026-10-31T16:00:00.000Z",
  generatedAt: "2026-10-31T16:40:00.000Z",
  findings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  battery: { total: 0, confirmed: 0, executedClean: 0, killed: 0, blocked: 0, na: 0, pending: 0 },
};

function renderInput(over: Partial<EngagementReportInput> = {}): EngagementReportInput {
  return {
    meta,
    title: "Penetration Test Report",
    narrativeMd: "",
    posture: gradeFindings([]),
    banner: gradeBanner([]),
    findings: [],
    bundles: new Map(),
    noBundleReasons: new Map(),
    negativeProof: [],
    findingMeta: new Map(),
    coverage: {
      fullBattery: false, cells: [],
      totals: { total: 0, confirmed: 0, executedClean: 0, killed: 0, blocked: 0, na: 0, pending: 0 },
      probesUsed: 0, planOnly: [], notCovered: [],
    },
    activity: { eventCount: 0, rows: [], totalActions: 0, decisions: [], danglingCauses: [] },
    ...over,
  };
}

describe("full report wiring", () => {
  it("a local report carries the inventory sections after Findings", () => {
    const html = renderEngagementReportHtml(renderInput({ inventory: okArtifact() }));
    const findingsAt = html.indexOf(">Findings<");
    const inventoryAt = html.indexOf("Host &amp; Security Posture Inventory");
    assert.ok(inventoryAt > 0, "inventory section present");
    assert.ok(inventoryAt > findingsAt, "inventory renders after the findings block");
  });

  it("a report without the artifact is byte-identical in structure (no section)", () => {
    const html = renderEngagementReportHtml(renderInput());
    assert.ok(!html.includes("Posture Inventory"));
    assert.ok(!html.includes("Filesystem Inventory"));
  });
});
