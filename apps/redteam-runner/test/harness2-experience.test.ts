/**
 * Harness2 EXPERIENCE.md section-7 schema + status transitions (H2-P3).
 *
 * Pins the exact spec-7 entry format, parse/render round-trip (ASCII and the
 * em-dash heading the spec also writes), tolerance of prose and malformed
 * records (skip + count, never throw), the append-only rule (a new record is
 * appended; the ONLY in-place edit is one record's `- Status:` line), and the
 * approval-gated adoption path: adoptVerdict is the only adoption path and
 * rollback flips + appends reverted records instead of rewriting history.
 *
 * The filename sanitizer is pinned against the package builder's mirror
 * (package-experience.ts), so both sides always resolve the same file.
 *
 * Every test works under a temp DSH_HARNESS2_ROOT, so the real
 * E:\secscan-harness2 tree is never touched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveHarness2Paths,
  type Harness2Paths,
  type PatchLayer,
  type ProbeVerdict,
  type Proposal,
} from "../src/harness2/contract.js";
import {
  AdoptRefusedError,
  adoptVerdict,
  appendExperience,
  appendRevertedExperience,
  listExperience,
  markExperienceStatus,
  parseExperience,
  readExperience,
  readExperienceFullText,
  readExperienceReport,
  renderExperience,
  renderFullText,
  resolveExperiencePath,
  rollbackLayer,
  sanitizeTargetClass,
  showExperience,
  supersedeExperience,
  type ExperienceRecord,
  type ExperienceStatus,
} from "../src/harness2/experience.js";
import {
  experiencePath as packageExperiencePath,
  sanitizeTargetClass as packageSanitizeTargetClass,
} from "../src/harness2/package-experience.js";
import { activeLayerIds } from "../src/harness2/layers.js";

const SAFE_YAML = "probeHints:\n  memory: |\n    Check /robots.txt before directory brute force.\n";
const LAYER_ID = "wp-robots-hint";
const CYCLE_ID = "cycle-2026-10-18";
const ACTIVE: ExperienceStatus = { kind: "active" };

let root: string;
let paths: Harness2Paths;

function sampleProposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    targetClass: "wordpress",
    component: "memory",
    yaml: SAFE_YAML,
    rationale: "High-yield runs checked robots.txt before brute forcing.",
    ...over,
  };
}

function sampleLayer(over: Partial<PatchLayer> = {}): PatchLayer {
  return {
    id: LAYER_ID,
    targetClass: "wordpress",
    yaml: SAFE_YAML,
    adoptedAt: "2026-10-18T09:30:00.000Z",
    evidenceRunId: "run-alpha",
    ...over,
  };
}

function sampleVerdict(over: Partial<ProbeVerdict> = {}): ProbeVerdict {
  return {
    proposalId: "prop-1",
    adopted: true,
    deltas: { vulnsFound: 2, falsePositives: -1, steps: -3, tokensIn: 1200, tokensOut: -500 },
    baseRuns: 4,
    candidateRuns: 4,
    reason: "candidate beats base on vulnsFound and steps",
    tokensSpent: 4321,
    ...over,
  };
}

function sampleRecord(over: Partial<ExperienceRecord> = {}): ExperienceRecord {
  return {
    date: "2026-10-18",
    targetClass: "wordpress",
    layerId: LAYER_ID,
    cycleId: CYCLE_ID,
    changed: "added a robots.txt hint to recon memory",
    why: "run-alpha, run-beta",
    measuredEffect: "vulnsFound +2, n=4 base / 4 candidate runs",
    status: ACTIVE,
    ...over,
  };
}

/** A record with no layer: the heading token is `general`. */
function generalRecord(over: Partial<ExperienceRecord> = {}): ExperienceRecord {
  return {
    date: "2026-10-19",
    targetClass: "wordpress",
    cycleId: "cycle-2026-10-19",
    changed: "general lesson with no layer",
    why: "run-alpha",
    measuredEffect: "steps -1, n=2",
    status: ACTIVE,
    ...over,
  };
}

/** Write a raw EXPERIENCE.md body for one class. */
function writeExperienceBody(targetClass: string, body: string): string {
  mkdirSync(paths.experience, { recursive: true });
  const path = resolveExperiencePath(paths, targetClass);
  writeFileSync(path, body);
  return path;
}

function experienceFile(targetClass = "wordpress"): string {
  return readFileSync(resolveExperiencePath(paths, targetClass), "utf8");
}

/** Only content lines that are exactly `- Status: ...`. */
function statusLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.startsWith("- Status:"));
}

function noLayerInstalled(layerId = LAYER_ID): void {
  assert.equal(existsSync(join(paths.layers, layerId)), false, "no layer directory may be written");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "harness2-experience-"));
  paths = resolveHarness2Paths({ DSH_HARNESS2_ROOT: root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("section 7 entry format", () => {
  it("pins the sanitizer to the package builder's mirror and keeps paths safe", () => {
    assert.equal(resolveExperiencePath(paths, "wordpress"), join(paths.experience, "wordpress.md"));
    assert.equal(sanitizeTargetClass("Windows AD / .."), "windows-ad");
    assert.equal(resolveExperiencePath(paths, "../../etc/passwd"), join(paths.experience, "etc-passwd.md"));
    assert.equal(sanitizeTargetClass(""), "general");
    for (const targetClass of ["wordpress", "Windows AD / ..", "", "  A  b  ", "x".repeat(80), "\u00dcn\u00efcode T\u00e2rget"]) {
      assert.equal(sanitizeTargetClass(targetClass), packageSanitizeTargetClass(targetClass), `sanitizer parity for ${JSON.stringify(targetClass)}`);
      assert.equal(resolveExperiencePath(paths, targetClass), packageExperiencePath(paths.experience, targetClass), `path parity for ${JSON.stringify(targetClass)}`);
    }
  });

  it("renders the exact spec-7 entry format", () => {
    assert.equal(
      renderFullText([sampleRecord()], "wordpress"),
      [
        "# EXPERIENCE - wordpress",
        "",
        `## 2026-10-18 - ${LAYER_ID} - ${CYCLE_ID}`,
        "- Target class: wordpress",
        "- Changed (layer/file): added a robots.txt hint to recon memory",
        "- Why (motivating run_ids): run-alpha, run-beta",
        "- Measured effect (metric deltas + sample size): vulnsFound +2, n=4 base / 4 candidate runs",
        "- Status: active",
        "",
      ].join("\n"),
    );
    assert.equal(renderFullText([], "nginx"), "# EXPERIENCE - nginx\n", "empty class is header-only, never empty");
    assert.equal(renderExperience, renderFullText, "renderExperience stays an alias of the full-text renderer");
  });

  it("round-trips every status form through render and parse", () => {
    const records: ExperienceRecord[] = [
      sampleRecord(),
      generalRecord({ date: "2026-10-19", status: { kind: "superseded", by: "wp-new" } }),
      sampleRecord({ date: "2026-10-20", status: { kind: "reverted", reason: "steps regressed, FPs flat", date: "2026-10-21" } }),
    ];
    const text = renderFullText(records, "wordpress");
    const parsed = parseExperience(text, "wordpress");
    assert.equal(parsed.skipped, 0);
    assert.deepEqual(parsed.entries, records);
    assert.match(text, /^- Status: superseded \(-> wp-new\)$/m);
    assert.match(text, /^- Status: reverted \(steps regressed, FPs flat, 2026-10-21\)$/m);
    assert.equal(parsed.entries[1]?.layerId, undefined, "`general` heading token means no layer");
  });

  it("accepts the em-dash heading form the spec also writes", () => {
    const ascii = renderFullText([sampleRecord()], "wordpress");
    const emDash = ascii.replace(` - ${LAYER_ID} - `, ` \u2014 ${LAYER_ID} \u2014 `);
    assert.notEqual(emDash, ascii);
    assert.deepEqual(parseExperience(emDash, "wordpress").entries, [sampleRecord()]);
  });

  it("tolerates prose, skips malformed records and never throws", () => {
    writeExperienceBody(
      "wordpress",
      [
        "# EXPERIENCE - wordpress",
        "free prose before any record is tolerated",
        "## 2026-10-18 - wp-hint - cycle-1",
        "- Target class: wordpress",
        "- Changed (layer/file): added hint",
        "- Why (motivating run_ids): run-alpha, run-beta",
        "- Measured effect (metric deltas + sample size): vulnsFound +2, n=4",
        "- Status: active",
        "prose inside a record block is tolerated",
        "## not-a-date - bad-date - cycle-2",
        "- Target class: wordpress",
        "## 2026-10-19 - wp-hint - cycle-3",
        "- Target class: wordpress",
        "- Changed (layer/file): missing status",
        "- Why (motivating run_ids): run-a",
        "- Measured effect (metric deltas + sample size): none",
        "## 2026-10-20 - wp-hint - cycle-4",
        "- Target class: wordpress",
        "- Changed (layer/file): bad status",
        "- Why (motivating run_ids): run-a",
        "- Measured effect (metric deltas + sample size): none",
        "- Status: maybe",
        "## 2026-10-21 - wp-hint - cycle-5",
        "- Target class: wordpress",
        "- Changed (layer/file): missing changed is impossible, missing why",
        "- Measured effect (metric deltas + sample size): none",
        "- Status: active",
        "## 2026-10-22 - wp-hint",
        "- Target class: wordpress",
      ].join("\n"),
    );
    const report = readExperienceReport(paths, "wordpress");
    assert.equal(report.exists, true);
    assert.equal(report.entries.length, 1, "the one complete record parses");
    assert.equal(Object.prototype.hasOwnProperty.call(report.entries[0], "tokensSpent"), false, "tokens are not a section-7 field");
    assert.equal(report.skipped, 5, "bad date, missing status, bad status, missing why, 2-part heading");
    writeExperienceBody("nginx", "\u0000 not markdown at all {{[ ##");
    assert.deepEqual(readExperience(paths, "nginx"), []);
    assert.deepEqual(readExperience(paths, "never-written"), []);
  });
});

describe("append-only writers", () => {
  it("appends atomically, dedupes on (date, layerId, cycleId, changed) and preserves earlier bytes", () => {
    const path = writeExperienceBody(
      "wordpress",
      ["# EXPERIENCE - wordpress", "", "hand-written prose the tuner must never rewrite", "", "## 2026-10-17 - gp - cycle-0", "- Target class: wordpress", "- Changed (layer/file): seed", "- Why (motivating run_ids): run-0", "- Measured effect (metric deltas + sample size): none, n=1", "- Status: active", ""].join("\n"),
    );
    const before = readFileSync(path, "utf8");
    const first = appendExperience(paths, sampleRecord());
    assert.deepEqual([first.appended, first.total], [true, 2], "the seed record counts, the new one appends");
    const after = readFileSync(path, "utf8");
    assert.ok(after.startsWith(before.replace(/\s+$/, "")), "every pre-existing byte is preserved verbatim");
    assert.match(after, /hand-written prose the tuner must never rewrite/);
    const duplicate = appendExperience(paths, sampleRecord());
    assert.deepEqual([duplicate.appended, duplicate.total], [false, 2], "same key must not be stored twice");
    const changed = appendExperience(paths, sampleRecord({ changed: "a different change" }));
    assert.deepEqual([changed.appended, changed.total], [true, 3]);
    assert.equal(readExperience(paths, "wordpress").length, 3);
    assert.match(experienceFile(), /^# EXPERIENCE - wordpress\n/, "canonical header");
  });

  it("flips only ONE record's Status line and refuses an ambiguous or missing match", () => {
    writeExperienceBody("wordpress", `${renderFullText([sampleRecord()], "wordpress")}trailing prose stays\n`);
    const before = experienceFile().split(/\r?\n/);
    const flipped = markExperienceStatus(paths, "wordpress", { layerId: LAYER_ID, status: "active" }, { kind: "superseded", by: "wp-next" });
    assert.equal(flipped.marked, true);
    assert.deepEqual(flipped.record?.status, { kind: "superseded", by: "wp-next" });
    const after = experienceFile().split(/\r?\n/);
    assert.equal(after.length, before.length, "a status flip never adds or removes a line");
    const changedLines = after.map((line, index) => (line === before[index] ? undefined : line)).filter((line): line is string => line !== undefined);
    assert.deepEqual(changedLines, ["- Status: superseded (-> wp-next)"], "exactly one line changed, and it is the Status line");
    assert.match(experienceFile(), /trailing prose stays/, "surrounding prose is untouched");
    assert.deepEqual(readExperience(paths, "wordpress")[0]?.status, { kind: "superseded", by: "wp-next" });

    const idempotent = markExperienceStatus(paths, "wordpress", { layerId: LAYER_ID }, { kind: "superseded", by: "wp-next" });
    assert.equal(idempotent.marked, false, "marking the same status twice is a no-op");

    const beforeRefusal = experienceFile();
    assert.throws(() => markExperienceStatus(paths, "wordpress", { layerId: "no-such-layer" }, { kind: "superseded", by: "x" }), AdoptRefusedError);
    assert.equal(experienceFile(), beforeRefusal, "a refused flip writes nothing");

    appendExperience(paths, sampleRecord({ date: "2026-10-22", changed: "same layer again" }));
    const beforeAmbiguous = experienceFile();
    assert.throws(() => markExperienceStatus(paths, "wordpress", { layerId: LAYER_ID }, { kind: "reverted", reason: "x", date: "2026-10-23" }), AdoptRefusedError, "two matches must be refused");
    assert.equal(experienceFile(), beforeAmbiguous, "an ambiguous flip writes nothing");
    assert.throws(() => markExperienceStatus(paths, "nginx", { layerId: LAYER_ID }, { kind: "active" }), AdoptRefusedError, "no file must be refused");
  });

  it("marks an active record superseded by a newer layer (consolidation seam)", () => {
    appendExperience(paths, sampleRecord());
    const result = supersedeExperience(paths, { targetClass: "wordpress", layerId: LAYER_ID, by: "wp-merged" });
    assert.equal(result.marked, true);
    assert.deepEqual(readExperience(paths, "wordpress")[0]?.status, { kind: "superseded", by: "wp-merged" });
    assert.throws(() => supersedeExperience(paths, { targetClass: "wordpress", layerId: LAYER_ID, by: "bad id!" }), AdoptRefusedError);
  });
});

describe("adoptVerdict", () => {
  it("refuses without explicit operator approval and writes nothing", () => {
    assert.throws(() => adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer(), verdict: sampleVerdict(), approve: false }), AdoptRefusedError);
    noLayerInstalled();
    assert.equal(existsSync(resolveExperiencePath(paths, "wordpress")), false);
    assert.deepEqual(activeLayerIds(paths), []);
  });

  it("refuses without an adopting verdict and writes nothing", () => {
    assert.throws(
      () => adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer(), verdict: sampleVerdict({ adopted: false, reason: "worse on steps" }), approve: true }),
      (error: unknown) => error instanceof AdoptRefusedError && /not adopted/.test(error.message),
    );
    noLayerInstalled();
    assert.equal(existsSync(resolveExperiencePath(paths, "wordpress")), false);
  });

  it("refuses a verdict that belongs to another proposal", () => {
    assert.throws(
      () => adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer(), verdict: sampleVerdict({ proposalId: "prop-other" }), approve: true }),
      AdoptRefusedError,
    );
    noLayerInstalled();
  });

  it("refuses layer YAML that touches pinned guardrails, however it is spelled", () => {
    const guardrailYamls = [
      "patches:\n  src/policy/rules.ts:\n    allow: false\n",
      "patches:\n  src\\safety\\rotation.ts: {}\n",
      "component: guardrails\n",
      "targets: [auth-gate]\n",
      "patches:\n  src / gate.ts: {}\n",
    ];
    for (const yaml of guardrailYamls) {
      assert.throws(
        () => adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer({ yaml }), verdict: sampleVerdict(), approve: true }),
        (error: unknown) => error instanceof AdoptRefusedError && /pinned guardrail/.test(error.message),
        `must refuse YAML: ${JSON.stringify(yaml)}`,
      );
      noLayerInstalled();
    }
    assert.equal(existsSync(resolveExperiencePath(paths, "wordpress")), false);
  });

  it("refuses a guardrail reference hiding in the proposal YAML too", () => {
    assert.throws(
      () => adoptVerdict({ paths, proposal: sampleProposal({ yaml: "component: guardrails\n" }), layer: sampleLayer(), verdict: sampleVerdict(), approve: true }),
      AdoptRefusedError,
    );
    noLayerInstalled();
  });

  it("installs + activates the layer and appends one active section-7 record", () => {
    const proposal = sampleProposal();
    const layer = sampleLayer();
    const adopted = adoptVerdict({ paths, proposal, layer, verdict: sampleVerdict(), approve: true });
    assert.equal(adopted.layerId, LAYER_ID);
    assert.equal(adopted.experiencePath, resolveExperiencePath(paths, "wordpress"));
    const layerYamlPath = join(paths.layers, LAYER_ID, "layer.yml");
    assert.ok(existsSync(layerYamlPath), "layer YAML is installed");
    assert.match(readFileSync(layerYamlPath, "utf8"), /robots\.txt/);
    assert.deepEqual(activeLayerIds(paths), [LAYER_ID], "adoption activates the layer");
    const records = readExperience(paths, "wordpress");
    assert.equal(records.length, 1);
    const lesson = records[0]!;
    assert.equal(lesson.layerId, LAYER_ID);
    assert.equal(lesson.cycleId, `cycle-2026-10-18`, "default cycle id is the adoption date");
    assert.equal(lesson.date, "2026-10-18", "record date is the layer's adoption date");
    assert.deepEqual(lesson.status, { kind: "active" });
    assert.match(lesson.changed, /memory/);
    assert.match(lesson.why, /run-alpha/, "the motivating run id is recorded");
    assert.match(lesson.why, /robots\.txt/, "the proposal rationale is recorded");
    assert.match(lesson.measuredEffect, /vulnsFound \+2/);
    assert.match(lesson.measuredEffect, /\(n=4 base \/ 4 candidate runs\)/, "sample size is stated");
    assert.match(experienceFile(), /^\- Status: active$/m);
  });

  it("honours an explicit tuning cycle id", () => {
    adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer(), verdict: sampleVerdict(), approve: true, cycleId: "cycle-7" });
    assert.equal(readExperience(paths, "wordpress")[0]?.cycleId, "cycle-7");
    assert.match(experienceFile(), new RegExp(`^## 2026-10-18 - ${LAYER_ID} - cycle-7$`, "m"));
  });
});

describe("rollback", () => {
  it("flips the adoption record and appends a reverted record instead of rewriting history", () => {
    adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer(), verdict: sampleVerdict(), approve: true });
    const before = readExperience(paths, "wordpress");
    assert.equal(before.length, 1);
    rollbackLayer({ paths, layerId: LAYER_ID });
    assert.equal(existsSync(join(paths.layers, LAYER_ID)), false, "layer directory is gone");
    assert.deepEqual(activeLayerIds(paths), [], "layer is no longer active");
    const after = readExperience(paths, "wordpress");
    assert.equal(after.length, 2, "rollback appends a record, it does not replace the adoption record");
    assert.deepEqual(after[0], { ...before[0]!, status: { kind: "reverted", reason: "operator rollback: the layer is no longer installed", date: after[1]!.date } }, "only the adoption record's status changed");
    assert.deepEqual(after[1]?.status, { kind: "reverted", reason: "operator rollback: the layer is no longer installed", date: after[1]!.date });
    assert.equal(after[1]?.layerId, LAYER_ID);
    assert.equal(after[1]?.cycleId, before[0]?.cycleId, "the rollback record stays in the layer's cycle");
    assert.match(experienceFile(), /Measured effect \(metric deltas \+ sample size\): vulnsFound \+2/, "the earlier measurement is still in the file");
    assert.equal(statusLines(experienceFile()).length, 2, "both records carry an explicit status");
  });

  it("records a custom rollback reason and refuses a layer that is not installed", () => {
    adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer(), verdict: sampleVerdict(), approve: true });
    const rolled = rollbackLayer({ paths, layerId: LAYER_ID, reason: "monitor: 10-run S fell by 0.09" });
    assert.match(experienceFile(), /- Status: reverted \(monitor: 10-run S fell by 0\.09, \d{4}-\d{2}-\d{2}\)$/m);
    assert.match(rolled.lesson.why, /run-alpha/);
    const frozen = experienceFile();
    assert.throws(() => rollbackLayer({ paths, layerId: LAYER_ID }), AdoptRefusedError);
    assert.equal(experienceFile(), frozen, "a refused rollback writes nothing");
  });

  it("appendRevertedExperience appends even when no active adoption record exists", () => {
    const appended = appendRevertedExperience(paths, {
      targetClass: "wordpress",
      layerId: "wp-imported",
      cycleId: "cycle-9",
      date: "2026-10-22",
      reason: "imported layer failed review",
      changed: "rolled back layer \"wp-imported\"",
      why: "run-z",
      measuredEffect: "vulnsFound -1.2, n=6",
    });
    assert.equal(appended.marked, 0, "nothing to flip when there is no active adoption record");
    assert.deepEqual(appended.entry.status, { kind: "reverted", reason: "imported layer failed review", date: "2026-10-22" });
    assert.deepEqual(readExperience(paths, "wordpress"), [appended.entry]);
  });
});

describe("experience reads", () => {
  it("lists per-class files with counts and shows the full text verbatim", () => {
    writeExperienceBody("wordpress", ["# EXPERIENCE - wordpress", "", "free prose is part of the full text", ""].join("\n"));
    appendExperience(paths, sampleRecord());
    appendExperience(paths, generalRecord({ date: "2026-10-19", changed: "second lesson" }));
    const listed = listExperience(paths);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.targetClass, "wordpress");
    assert.equal(listed[0]?.entries, 2);
    assert.equal(listed[0]?.skipped, 0);
    const full = readExperienceFullText(paths, "wordpress");
    assert.match(full, /free prose is part of the full text/, "full text keeps prose");
    const view = showExperience(paths, "wordpress");
    assert.equal(view.entries.length, 2);
    assert.equal(view.markdown, full);
    assert.match(view.markdown, new RegExp(`^## 2026-10-18 - ${LAYER_ID} - ${CYCLE_ID}$`, "m"));
    assert.match(view.markdown, /^- Status: active$/m);
    const missing = showExperience(paths, "nginx");
    assert.deepEqual([missing.entries.length, missing.exists], [0, false]);
    assert.equal(missing.markdown, "# EXPERIENCE - nginx\n");
    assert.equal(readExperienceFullText(paths, "never-written"), "# EXPERIENCE - never-written\n");
  });

  it("reports status transitions on a full file without losing history", () => {
    appendExperience(paths, sampleRecord());
    appendExperience(paths, generalRecord({ date: "2026-10-19", changed: "second lesson" }));
    markExperienceStatus(paths, "wordpress", { status: "active", date: "2026-10-19" }, { kind: "superseded", by: "wp-next" });
    const records = readExperience(paths, "wordpress");
    assert.deepEqual(records.map((record) => record.status.kind), ["active", "superseded"]);
    assert.equal(records.length, 2, "status changes never create or destroy records");
    assert.throws(() => markExperienceStatus(paths, "wordpress", { status: "active", date: "2026-10-19" }, { kind: "active" }), AdoptRefusedError, "no active match left");
  });
});
