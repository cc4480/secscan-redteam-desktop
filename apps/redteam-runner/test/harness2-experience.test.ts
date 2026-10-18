/**
 * Harness2 EXPERIENCE.md library + approval-gated adopt/rollback (H2-P3).
 *
 * Pins the two security-critical properties: adoptVerdict is the only adoption
 * path and refuses without BOTH verdict.adopted and approve === true; it also
 * re-checks layer/proposal YAML for pinned guardrails as defense in depth. A
 * rollback removes the layer but only ever APPENDS history, never rewrites it.
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
  type ExperienceEntry,
  type Harness2Paths,
  type PatchLayer,
  type ProbeVerdict,
  type Proposal,
} from "../src/harness2/contract.js";
import {
  AdoptRefusedError,
  adoptVerdict,
  appendExperience,
  listExperience,
  parseExperience,
  readExperience,
  readExperienceReport,
  renderExperience,
  resolveExperiencePath,
  rollbackLayer,
  sanitizeTargetClass,
  showExperience,
} from "../src/harness2/experience.js";
import { activeLayerIds } from "../src/harness2/layers.js";

const SAFE_YAML = "probeHints:\n  memory: |\n    Check /robots.txt before directory brute force.\n";
const LAYER_ID = "wp-robots-hint";

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

function sampleEntry(over: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    date: "2026-10-18",
    targetClass: "wordpress",
    layerId: LAYER_ID,
    change: "added a robots.txt hint to recon memory",
    reason: "contrast pair showed high-yield runs checked it first",
    measuredEffect: "vulnsFound +2 over 4 base / 4 candidate runs",
    tokensSpent: 1200,
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

function noLayerInstalled(): void {
  assert.equal(existsSync(join(paths.layers, LAYER_ID)), false, "no layer directory may be written");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "harness2-experience-"));
  paths = resolveHarness2Paths({ DSH_HARNESS2_ROOT: root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("experience format", () => {
  it("sanitizes the target class into a safe filename under the experience root", () => {
    assert.equal(resolveExperiencePath(paths, "wordpress"), join(paths.experience, "wordpress.md"));
    assert.equal(sanitizeTargetClass("Windows AD / .."), "windows-ad");
    assert.equal(resolveExperiencePath(paths, "../../etc/passwd"), join(paths.experience, "etc-passwd.md"));
    assert.equal(sanitizeTargetClass(""), "general");
  });

  it("round-trips entries through render and parse, tokens included", () => {
    const general: ExperienceEntry = {
      date: "2026-10-19",
      targetClass: "wordpress",
      change: "general lesson with no layer",
      reason: "observed in every run",
      measuredEffect: "steps -1",
      tokensSpent: 0,
    };
    const entries = [sampleEntry(), sampleEntry({ date: "2026-10-20", tokensSpent: 2_000_000_000 }), general];
    const parsed = parseExperience(renderExperience(entries), "wordpress");
    assert.equal(parsed.skipped, 0);
    assert.deepEqual(parsed.entries, entries);
    assert.equal(parsed.entries[2]?.layerId, undefined, "`general` means no layer, not a layer named general");
  });

  it("skips malformed entries, counts them, and never throws", () => {
    writeExperienceBody(
      "wordpress",
      [
        "# EXPERIENCE - wordpress",
        "free prose before any entry is tolerated",
        "## 2026-10-18 - wp-hint",
        "- change: added hint",
        "- reason: contrast pair",
        "- measured effect: vulnsFound +2",
        "- tokens spent: 1200",
        "prose inside an entry block is tolerated",
        "## not-a-date - bad-date",
        "- change: x",
        "- reason: y",
        "- measured effect: z",
        "- tokens spent: 1",
        "## 2026-10-19 - missing-field",
        "- change: only a change",
        "## 2026-10-20 - bad-tokens",
        "- change: a",
        "- reason: b",
        "- measured effect: c",
        "- tokens spent: lots",
      ].join("\n"),
    );
    const report = readExperienceReport(paths, "wordpress");
    assert.equal(report.exists, true);
    assert.equal(report.entries.length, 1);
    assert.equal(report.skipped, 3);
    assert.equal(report.entries[0]?.tokensSpent, 1200);
    writeExperienceBody("nginx", "\u0000 not markdown at all {{[ ##");
    assert.deepEqual(readExperience(paths, "nginx"), []);
    assert.deepEqual(readExperience(paths, "never-written"), []);
  });

  it("appends atomically and dedupes on (date, layerId, change)", () => {
    const first = appendExperience(paths, sampleEntry());
    assert.deepEqual([first.appended, first.total], [true, 1]);
    const duplicate = appendExperience(paths, sampleEntry());
    assert.deepEqual([duplicate.appended, duplicate.total], [false, 1], "same key must not be stored twice");
    const changed = appendExperience(paths, sampleEntry({ change: "a different change" }));
    assert.deepEqual([changed.appended, changed.total], [true, 2]);
    const report = readExperienceReport(paths, "wordpress");
    assert.equal(report.entries.length, 2);
    assert.match(readFileSync(first.path, "utf8"), /^# EXPERIENCE - wordpress\n/, "canonical header");
  });

  it("keeps distinct days and layers distinct and preserves token counts", () => {
    appendExperience(paths, sampleEntry({ date: "2026-10-18", tokensSpent: 0 }));
    appendExperience(paths, sampleEntry({ date: "2026-10-19", tokensSpent: 999_999 }));
    appendExperience(paths, sampleEntry({ date: "2026-10-19", layerId: "other-layer", tokensSpent: 7 }));
    assert.deepEqual(readExperience(paths, "wordpress").map((entry) => entry.tokensSpent), [0, 999_999, 7]);
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

  it("installs and activates the layer and appends the measured lesson", () => {
    const proposal = sampleProposal();
    const layer = sampleLayer();
    const verdict = sampleVerdict();
    const adopted = adoptVerdict({ paths, proposal, layer, verdict, approve: true });
    assert.equal(adopted.layerId, LAYER_ID);
    assert.equal(adopted.experiencePath, resolveExperiencePath(paths, "wordpress"));
    const layerYamlPath = join(paths.layers, LAYER_ID, "layer.yml");
    assert.ok(existsSync(layerYamlPath), "layer YAML is installed");
    assert.match(readFileSync(layerYamlPath, "utf8"), /robots\.txt/);
    assert.deepEqual(activeLayerIds(paths), [LAYER_ID], "adoption activates the layer");
    const entries = readExperience(paths, "wordpress");
    assert.equal(entries.length, 1);
    const lesson = entries[0]!;
    assert.equal(lesson.layerId, LAYER_ID);
    assert.equal(lesson.date, "2026-10-18", "lesson date is the layer's adoption date");
    assert.equal(lesson.tokensSpent, verdict.tokensSpent, "token accounting is preserved verbatim");
    assert.match(lesson.change, /memory/);
    assert.equal(lesson.reason, proposal.rationale);
    assert.match(lesson.measuredEffect, /vulnsFound \+2/);
    assert.match(lesson.measuredEffect, /4 base \/ 4 candidate runs/);
  });
});

describe("rollbackLayer", () => {
  it("removes the layer and appends history instead of rewriting it", () => {
    adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer(), verdict: sampleVerdict(), approve: true });
    const before = readExperience(paths, "wordpress");
    assert.equal(before.length, 1);
    const result = rollbackLayer({ paths, layerId: LAYER_ID });
    assert.equal(existsSync(join(paths.layers, LAYER_ID)), false, "layer directory is gone");
    assert.deepEqual(activeLayerIds(paths), [], "layer is no longer active");
    const after = readExperience(paths, "wordpress");
    assert.equal(after.length, 2, "rollback appends a lesson, it does not replace the adopt lesson");
    assert.deepEqual(after[0], before[0], "the adopt lesson is byte-for-byte preserved");
    const rollbackLesson = after[1]!;
    assert.match(rollbackLesson.change, /rolled back/);
    assert.equal(rollbackLesson.layerId, LAYER_ID);
    assert.equal(rollbackLesson.tokensSpent, 0);
    assert.match(rollbackLesson.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(readFileSync(result.experiencePath, "utf8"), /measured effect: vulnsFound \+2/, "earlier measurement is still in the file");
  });

  it("refuses to roll back a layer that is not installed and appends no history", () => {
    assert.throws(() => rollbackLayer({ paths, layerId: LAYER_ID }), AdoptRefusedError);
    assert.equal(existsSync(resolveExperiencePath(paths, "wordpress")), false);
  });
});

describe("experience listing", () => {
  it("lists per-class files with counts and shows canonical markdown", () => {
    adoptVerdict({ paths, proposal: sampleProposal(), layer: sampleLayer(), verdict: sampleVerdict(), approve: true });
    appendExperience(paths, sampleEntry({ date: "2026-10-19", change: "second lesson", tokensSpent: 7 }));
    const listed = listExperience(paths);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.targetClass, "wordpress");
    assert.equal(listed[0]?.entries, 2);
    assert.equal(listed[0]?.skipped, 0);
    const view = showExperience(paths, "wordpress");
    assert.equal(view.entries.length, 2);
    assert.match(view.markdown, /^# EXPERIENCE - wordpress\n/);
    assert.match(view.markdown, /^## 2026-10-18 - wp-robots-hint$/m);
    const missing = showExperience(paths, "nginx");
    assert.deepEqual([missing.entries.length, missing.exists], [0, false]);
    assert.equal(missing.markdown, "# EXPERIENCE - nginx\n");
  });
});
