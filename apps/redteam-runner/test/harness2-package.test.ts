/**
 * Harness2 section-6 package schema + section-10 chunking/relay protocol (H2-P2).
 *
 * Pins the spec, not the implementation details:
 *  - seven sections in order, a versioned header, FULL editable component
 *    contents, guardrails as path + sha256 + PINNED marker (never contents),
 *    2-3 contrasted pairs with FULL step logs, aggregate metrics with N, the
 *    EXPERIENCE.md full text, the constraints and a machine-checkable checklist;
 *  - parsing re-derives completeness from the text and keeps old versions
 *    readable while rejecting an unknown/newer one;
 *  - chunking splits on line boundaries only, delimiters carry the exact body
 *    char count, a partial package is rejected, the relay re-sends one part;
 *  - the editor reply parser requires the complete @@...@@ block set, rejects
 *    diffs and auto-rejects + flags any pinned-guardrail touch.
 *
 * Every test uses a temp DSH_HARNESS2_ROOT and a temp fixture repo, so neither
 * E:\secscan-harness2 nor the real runner tree is touched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EDITABLE_COMPONENTS, HARNESS_COMPONENTS, resolveHarness2Paths } from "../src/harness2/contract.js";
import { openHarness2Store, type FailureMode, type Harness2Store, type RunBundle, type StepInput } from "../src/harness2/store.js";
import {
  DEFAULT_PROBE_TOKEN_BUDGET,
  EDITOR_REPLY_BLOCK_NAMES,
  InsufficientDataError,
  MIN_USABLE_RUNS,
  PACKAGE_FORMAT_VERSION,
  PACKAGE_MODES,
  PACKAGE_PART_LIMIT,
  PackageChunkError,
  PackageCompletenessError,
  PackageFormatError,
  PartialPackageError,
  REPLY_FORMAT_DOC,
  READABLE_FORMAT_VERSIONS,
  SECTION_NAMES,
  assemblePackage,
  assertPackageComplete,
  buildProposalPackage,
  createPackageRelay,
  findPinnedTouch,
  isDiffContent,
  parseEditorReply,
  parsePackageDocument,
  parsePart,
  readComponentFiles,
  readPinnedGuardrails,
  renderPackageDocument,
  sectionBegin,
  serializePackageParts,
  splitPackage,
  splitSections,
  writeProposalPackage,
  type BuildProposalPackageInput,
  type EditorReply,
  type ProposalPackageDocument,
} from "../src/harness2/package.js";

const COMMIT = "c6ac3aed";
const PACKAGE_DATE = "2026-10-18";

let root: string;
let repo: string;
let store: Harness2Store;
let previousRoot: string | undefined;

const REPO_FILES: readonly (readonly [string, string])[] = [
  ["apps/redteam-runner/package.json", '{"name":"@secscan/redteam-runner","version":"0.37.1"}'],
  ["apps/redteam-runner/src/prompts.ts", "export const BASE_PROMPT = 'base prompt';\n"],
  ["apps/redteam-runner/src/prompts/coordinator.ts", "export const COORDINATOR = 'coord';\n"],
  ["apps/redteam-runner/src/tools.ts", "export * from './tools/web.js';\n"],
  ["apps/redteam-runner/src/tools/web.ts", "export const WEB_TOOLS = 'web';\n"],
  ["apps/redteam-runner/src/agents.ts", "export const AGENT_LOOP = 'loop';\n"],
  ["packages/redteam/harness-plugin/src/redteam-profile.ts", "export const PROFILE = 'profile';\n"],
  ["apps/redteam-runner/src/registry.ts", "export const REGISTRY = 'registry';\n"],
  ["apps/redteam-runner/src/targets.ts", "export const TARGETS = 'targets';\n"],
  ["apps/redteam-runner/src/battery.ts", "export const BATTERY = 'battery';\n"],
  ["apps/redteam-runner/src/attack.ts", "export const ATTACK = 'attack';\n"],
  ["apps/redteam-runner/src/targets/wordpress.ts", "export const WORDPRESS = 'wp';\n"],
  ["apps/redteam-runner/scripts/check.mjs", "export default 1;\n"],
  ["apps/redteam-runner/src/mcp.ts", "export const MCP = 'mcp';\n"],
  ["apps/redteam-runner/src/integrations/example.ts", "export const INTEGRATION = 'i';\n"],
  ["apps/redteam-runner/src/safety/kill.ts", "SECRET_GUARDRAIL\n"],
  ["apps/redteam-runner/src/policy/scope.ts", "SECRET_POLICY\n"],
  ["apps/redteam-runner/src/gate.ts", "SECRET_GATE\n"],
  ["apps/redteam-runner/src/accountability/x.ts", "SECRET_ACCOUNTABILITY\n"],
  ["packages/redteam/auth-gate/src/index.ts", "SECRET_AUTH_GATE\n"],
  ["packages/redteam/harness-plugin/src/auth-gate.ts", "SECRET_AUTH_GATE2\n"],
];

const EXPERIENCE_TEXT = [
  "# EXPERIENCE - wordpress",
  "",
  "## 2026-10-18 - general",
  "- change: added a recon checklist before brute force",
  "- reason: recon missed the auth flows on the login page",
  "- measured effect: vulnsFound 1 -> 3 over 2 runs",
  "- tokens spent: 1200",
  "",
  "## 2026-10-17 - wp-cache",
  "- change: cache-busting note before every payload",
  "- reason: cached pages hid the injected payload",
  "- measured effect: exploits 0 -> 2 over 2 runs",
  "- tokens spent: 800",
  "",
].join("\n");

const LONG_STEP_CONTENT = [
  "STEP LOG: full prompt text for run-pos-a",
  "You are the coordinator. Target class: wordpress. Mode: REPAIR.",
  "Observations: robots.txt allowed /wp-admin; the login form has no rate limit on the second POST.",
  "Do not truncate anything: this line exists to prove the package carries the complete step text.",
].join("\n");

function writeAt(base: string, files: readonly (readonly [string, string])[]): void {
  for (const [path, body] of files) {
    const target = join(base, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
  }
}

function defaultSteps(runId: string): StepInput[] {
  return [
    { role: "prompt", content: `plan for ${runId}` },
    { role: "tool", toolName: "http_probe", content: `GET / target ${runId}` },
    { role: "observation", content: `200 OK for ${runId}` },
  ];
}

interface SeedRun {
  readonly runId: string;
  readonly outcome: "success" | "partial" | "failure" | "aborted";
  readonly vulns?: number;
  readonly falsePositives?: number;
  readonly claims?: number;
  readonly tokens?: number;
  readonly ts?: number;
  readonly subclass?: string;
  readonly failureMode?: FailureMode;
  readonly layerSet?: readonly string[];
  readonly harnessVersion?: string;
  readonly stepRows?: readonly StepInput[];
}

function seed(over: SeedRun): void {
  const outcome = over.outcome;
  const vulns = over.vulns ?? (outcome === "success" ? 3 : 0);
  const falsePositives = over.falsePositives ?? 0;
  const stepRows = over.stepRows ?? defaultSteps(over.runId);
  const bundle: RunBundle = {
    runId: over.runId,
    ts: over.ts ?? Date.parse("2026-10-18T10:00:00.000Z"),
    targetClass: "wordpress",
    ...(over.subclass !== undefined ? { targetSubclass: over.subclass } : {}),
    targetId: `eng-${over.runId}`,
    harnessVersion: over.harnessVersion ?? "0.37.1",
    layerSet: over.layerSet ?? ["base"],
    success: outcome === "success",
    vulnsFound: vulns,
    claimsTotal: over.claims ?? vulns + falsePositives,
    falsePositives,
    stepsCount: stepRows.length,
    tokensTotal: over.tokens ?? 1200,
    crashed: outcome === "aborted",
    failureMode: over.failureMode ?? (outcome === "failure" ? "missed-vuln" : "none"),
  };
  store.upsertRows(bundle, stepRows);
}

/** A REPAIR window: 3 successes and 3 failures/partials (6 usable runs). */
function seedRepairWindow(): void {
  seed({ runId: "run-pos-a", outcome: "success", vulns: 5, tokens: 900, subclass: "wordpress-core", ts: Date.parse("2026-10-18T10:06:00.000Z"), layerSet: ["base", "wp-a"], stepRows: [...defaultSteps("run-pos-a"), { role: "prompt", content: LONG_STEP_CONTENT }] });
  seed({ runId: "run-pos-b", outcome: "success", vulns: 3, tokens: 1500, ts: Date.parse("2026-10-18T10:05:00.000Z") });
  seed({ runId: "run-pos-c", outcome: "success", vulns: 2, tokens: 2000, ts: Date.parse("2026-10-18T10:04:00.000Z") });
  seed({ runId: "run-neg-a", outcome: "failure", vulns: 0, tokens: 3000, ts: Date.parse("2026-10-18T10:03:00.000Z") });
  seed({ runId: "run-neg-b", outcome: "failure", vulns: 1, tokens: 2500, falsePositives: 3, claims: 4, failureMode: "fp-blowup", ts: Date.parse("2026-10-18T10:02:00.000Z") });
  seed({ runId: "run-neg-c", outcome: "partial", vulns: 1, tokens: 2800, ts: Date.parse("2026-10-18T10:01:00.000Z") });
}

function build(over: Partial<BuildProposalPackageInput> = {}): ProposalPackageDocument {
  return buildProposalPackage({
    store,
    targetClass: "wordpress",
    environment: { ...process.env, DSH_HARNESS2_COMMIT: COMMIT },
    repoRoot: repo,
    experienceDir: join(root, "experience"),
    now: "2026-10-18T12:00:00.000Z",
    ...over,
  });
}

function replyText(over: { component?: string; proposal?: string; rationale?: string; effect?: string; evidence?: readonly string[]; files?: readonly (readonly [string, string])[] } = {}): string {
  const evidence = over.evidence ?? ["pair 1: run-pos-a vs run-neg-a"];
  const files = over.files ?? [["apps/redteam-runner/src/tools.ts", "export const TOOLS = 'new';\n"]];
  return [
    "Here is my proposal, with the full files it changes.",
    "",
    `@@PROPOSAL ${over.component ?? "tool-guidance"}@@`,
    over.proposal ?? "- insert:\n    - id: wp-tools\n      name: '@secscan/example'\n      config: {}",
    "@@END-PROPOSAL@@",
    "@@RATIONALE@@",
    over.rationale ?? "Pair 1 shows the high-yield run probed robots.txt before brute forcing.",
    "@@END-RATIONALE@@",
    "@@EXPECTED-EFFECT@@",
    over.effect ?? "vulnsFound: +1 or more; steps: no increase",
    "@@END-EXPECTED-EFFECT@@",
    ...evidence.flatMap((entry) => ["@@SUPPORTING-EVIDENCE@@", entry, "@@END-SUPPORTING-EVIDENCE@@"]),
    ...files.flatMap(([path, content]) => [`@@FILE ${path}@@`, content, "@@END-FILE@@"]),
  ].join("\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "harness2-package-"));
  repo = join(root, "repo");
  writeAt(repo, REPO_FILES);
  writeAt(join(root, "experience"), [["wordpress.md", EXPERIENCE_TEXT]]);
  previousRoot = process.env.DSH_HARNESS2_ROOT;
  process.env.DSH_HARNESS2_ROOT = root;
  store = openHarness2Store(resolveHarness2Paths());
});

afterEach(() => {
  store.close();
  if (previousRoot === undefined) delete process.env.DSH_HARNESS2_ROOT;
  else process.env.DSH_HARNESS2_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

describe("section 6 package document", () => {
  it("builds all seven sections with the full payloads and a complete checklist", () => {
    seedRepairWindow();
    const doc = build();

    assert.equal(doc.formatVersion, PACKAGE_FORMAT_VERSION);
    assert.equal(doc.header.formatVersion, "6.0");
    assert.equal(doc.header.targetClass, "wordpress");
    assert.equal(doc.header.mode, "REPAIR");
    assert.equal(doc.header.date, PACKAGE_DATE);
    assert.equal(doc.header.baseHarnessVersion, COMMIT, "dsh repo sha comes from the harness stamp seam");
    assert.equal(doc.header.tunerVersion, "0.37.1");
    assert.match(doc.header.packageId, /^pkg-2026-10-18-wordpress-[0-9a-f]{8}$/);
    assert.deepEqual([...doc.header.activeLayerSet], ["base", "wp-a"], "newest run's ordered layer set");

    const markdown = renderPackageDocument(doc);
    for (let index = 0; index < SECTION_NAMES.length; index++) {
      const begin = sectionBegin(index + 1, SECTION_NAMES[index]!);
      const position = markdown.indexOf(begin);
      assert.ok(position >= 0, `section ${index + 1} (${SECTION_NAMES[index]}) is rendered`);
      if (index > 0) {
        const previous = markdown.indexOf(sectionBegin(index, SECTION_NAMES[index - 1]!), 0);
        assert.ok(position > previous, `section ${index + 1} comes after section ${index}`);
      }
    }
    assert.ok(markdown.includes("format_version: 6.0"));

    const parsed = parsePackageDocument(markdown);
    assert.equal(parsed.complete, true, parsed.problems.join("; "));
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.formatVersion, "6.0");
    assert.equal(parsed.header["package_id"], doc.header.packageId);
    assert.ok(parsed.checklist !== null && parsed.checklist.complete);
    assert.deepEqual(splitSections(markdown).order, [1, 2, 3, 4, 5, 6, 7]);

    const components = new Set(doc.components.map((entry) => entry.component));
    assert.equal(components.size, EDITABLE_COMPONENTS.length, "all seven editable components are shipped");
    for (const component of EDITABLE_COMPONENTS) assert.ok(components.has(component), `${component} present`);
    for (const entry of doc.components) {
      assert.ok(entry.body.length > 0, `${entry.path} has a verbatim body`);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.ok(markdown.includes(entry.body.replace(/\s+$/, "")), `${entry.path} appears verbatim in the package`);
    }

    assert.ok(doc.guardrails.length >= 1);
    for (const entry of doc.guardrails) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.equal(entry.marker, "PINNED - DO NOT PROPOSE CHANGES");
      assert.ok(markdown.includes(entry.path), `${entry.path} is listed`);
    }
    assert.ok(markdown.includes("PINNED - DO NOT PROPOSE CHANGES"));
    for (const secret of ["SECRET_GUARDRAIL", "SECRET_POLICY", "SECRET_GATE", "SECRET_AUTH_GATE", "SECRET_ACCOUNTABILITY"]) {
      assert.ok(!markdown.includes(secret), `guardrail contents (${secret}) are never shipped`);
    }

    assert.ok(doc.pairs.length >= 2 && doc.pairs.length <= 3, `${doc.pairs.length} contrasted pairs`);
    for (const pair of doc.pairs) {
      assert.notEqual(pair.runIdHigh, pair.runIdLow);
      assert.ok(pair.high.steps.length > 0 && pair.low.steps.length > 0, "FULL step logs are attached");
    }
    assert.ok(markdown.includes(LONG_STEP_CONTENT), "the complete multi-line step text is carried, not truncated");
    assert.ok(markdown.includes("selection_window_size: 6"));
    assert.match(doc.selection.quartileMethod, /quartile/);
    assert.ok(doc.selection.failureModeCoverage.length > 0);
    assert.ok(doc.selection.failureModeCoverage.every((mode) => ["missed-vuln", "fp-blowup", "tool-error", "step-exhaustion", "timeout", "none"].includes(mode)));
    assert.ok(doc.selection.modeReason.length > 0);
    assert.ok(markdown.includes("@@STEP 1 BEGIN@@"));

    assert.equal(doc.metrics.windowN, 6);
    assert.equal(doc.metrics.window.targetClass, "wordpress");
    assert.equal(doc.metrics.window.n, 6);
    assert.ok(doc.metrics.byTargetClass.some((entry) => entry.targetClass === "wordpress"));
    assert.match(markdown, /^window_n: 6$/m);
    assert.ok(markdown.includes("| target_class | n | success_rate | mean_vulns | fp_rate | mean_steps | mean_tokens | crash_rate |"));

    assert.equal(doc.experience.hasFile, true);
    assert.equal(doc.experience.entries.length, 2);
    assert.ok(doc.experience.text.includes("- measured effect: vulnsFound 1 -> 3 over 2 runs"));
    assert.ok(markdown.includes(doc.experience.text.replace(/\s+$/, "")), "EXPERIENCE.md full text is verbatim");

    assert.equal(doc.constraints.guardrailsPinned, true);
    assert.equal(doc.constraints.k, 1);
    assert.equal(doc.constraints.proposeOnly, true);
    assert.equal(doc.constraints.probeTokenBudget, DEFAULT_PROBE_TOKEN_BUDGET);
    for (const line of ["guardrails_pinned: true", "k: 1", "propose_only: true", `probe_token_budget: ${DEFAULT_PROBE_TOKEN_BUDGET}`]) {
      assert.ok(markdown.includes(line), `section 6 restates ${line}`);
    }

    assert.equal(doc.checklist.complete, true);
    assert.equal(doc.checklist.delimitersBalanced, true);
    assert.ok(doc.checklist.beginCount > 0 && doc.checklist.beginCount === doc.checklist.endCount);
    const ids = doc.checklist.items.map((entry) => entry.id);
    for (const required of ["header.package_id", "header.mode", "section2.guardrails", "section3.pairs", "section4.metrics", "section5.experience", "section6.constraints", "delimiters.balanced"]) {
      assert.ok(ids.includes(required), `checklist has ${required}`);
    }
    for (const component of EDITABLE_COMPONENTS) assert.ok(ids.includes(`section2.component.${component}`), `checklist has ${component}`);
  });

  it("states every section-10 reply block in the package constraints", () => {
    seedRepairWindow();
    const markdown = renderPackageDocument(build());
    for (const name of EDITOR_REPLY_BLOCK_NAMES) assert.ok(markdown.includes(`@@${name}`), `reply format documents @@${name}@@`);
    assert.ok(markdown.includes("RESEND") === false, "the reply format is about replies, not relay control");
    assert.ok(REPLY_FORMAT_DOC.includes("never a diff"));
  });

  it("respects the probe token budget override and clamps nonsense back to the default", () => {
    seedRepairWindow();
    const budgeted = build({ environment: { ...process.env, DSH_HARNESS2_COMMIT: COMMIT, DSH_HARNESS2_PROBE_TOKEN_BUDGET: "5000" } });
    assert.equal(budgeted.constraints.probeTokenBudget, 5000);
    const invalid = build({ environment: { ...process.env, DSH_HARNESS2_COMMIT: COMMIT, DSH_HARNESS2_PROBE_TOKEN_BUDGET: "lots" } });
    assert.equal(invalid.constraints.probeTokenBudget, DEFAULT_PROBE_TOKEN_BUDGET);
  });

  it("refuses a cold start below four usable runs", () => {
    seed({ runId: "run-a", outcome: "success" });
    seed({ runId: "run-b", outcome: "success" });
    seed({ runId: "run-c", outcome: "failure" });
    assert.throws(
      () => build(),
      (error: unknown) => {
        assert.ok(error instanceof InsufficientDataError, "typed cold-start error");
        assert.equal(error.usableRuns, MIN_USABLE_RUNS - 1);
        assert.match(error.message, /INSUFFICIENT_DATA/);
        return true;
      },
    );
  });

  it("selects HARDEN when every usable run succeeded and cites three successful runs", () => {
    seed({ runId: "run-1", outcome: "success", tokens: 500 });
    seed({ runId: "run-2", outcome: "success", tokens: 1000 });
    seed({ runId: "run-3", outcome: "success", tokens: 1500 });
    seed({ runId: "run-4", outcome: "success", tokens: 2000 });
    const doc = build();
    assert.equal(doc.header.mode, "HARDEN");
    assert.equal(doc.selection.mode, "HARDEN");
    assert.match(doc.selection.modeReason, /all 4 usable runs succeeded/);
    assert.equal(doc.selection.representativeRunIds.length, 3);
    assert.match(renderPackageDocument(doc), /mode: HARDEN/);
  });

  it("selects REPAIR-FOUNDATION when nothing succeeded and covers distinct failure modes", () => {
    seed({ runId: "run-f1", outcome: "failure", failureMode: "missed-vuln", tokens: 500 });
    seed({ runId: "run-f2", outcome: "failure", failureMode: "fp-blowup", falsePositives: 2, claims: 2, tokens: 1000 });
    seed({ runId: "run-f3", outcome: "failure", failureMode: "tool-error", tokens: 1500 });
    seed({ runId: "run-f4", outcome: "failure", failureMode: "step-exhaustion", tokens: 2000 });
    const doc = build();
    assert.equal(doc.header.mode, "REPAIR-FOUNDATION");
    assert.equal(doc.selection.representativeRunIds.length, 3);
    assert.ok(doc.selection.failureModeCoverage.length >= 3);
    assert.match(doc.selection.modeReason, /failure modes/);
  });

  it("never reads guardrail sources into the editable component list", () => {
    for (const entry of readComponentFiles(repo)) {
      assert.ok(EDITABLE_COMPONENTS.includes(entry.component), `${entry.component} is editable`);
      assert.equal(findPinnedTouch(entry.path).length, 0, `pinned path leaked: ${entry.path}`);
      assert.ok(!entry.body.includes("SECRET_"), `guardrail content leaked via ${entry.path}`);
    }
    const guardrails = readPinnedGuardrails(repo);
    assert.ok(guardrails.some((entry) => entry.path.includes("src/safety")));
    assert.ok(guardrails.some((entry) => entry.path.includes("src/policy")));
    assert.ok(guardrails.some((entry) => entry.path.includes("auth-gate")));
    assert.ok(guardrails.every((entry) => !("body" in entry)), "guardrails are path + hash only");
    assert.ok(findPinnedTouch("APPS\\REDTEAM-RUNNER\\SRC\\SAFETY\\kill.ts").includes("src/safety"), "backslash/case bypass is caught");
    assert.ok(findPinnedTouch("packages/redteam/harness-plugin/src/auth-gate.ts").includes("auth-gate"));
  });

  it("keeps an older readable format readable and rejects an unknown one", () => {
    const legacy = ["@@SECTION 1 header BEGIN@@", "package_id: pkg-old", "format_version: 5.0", "target_class: wordpress", "@@SECTION 1 header END@@", ""].join("\n");
    const parsed = parsePackageDocument(legacy);
    assert.equal(parsed.legacy, true);
    assert.equal(parsed.formatVersion, "5.0");
    assert.equal(parsed.complete, false, "legacy documents are readable but not checklist-verified");
    assert.deepEqual(READABLE_FORMAT_VERSIONS, ["6.0", "5.0", "5", "1"]);
    assert.throws(() => parsePackageDocument("format_version: 9.9\n"), (error: unknown) => error instanceof PackageFormatError && /unsupported format_version 9\.9/.test(error.message));
    assert.throws(() => parsePackageDocument("no version here"), (error: unknown) => error instanceof PackageFormatError && /missing format_version/.test(error.message));
  });

  it("rejects a truncated package through the completeness assertion", () => {
    seedRepairWindow();
    const markdown = renderPackageDocument(build());
    const truncated = markdown.slice(0, markdown.indexOf(sectionBegin(3, "contrasts")));
    const parsed = parsePackageDocument(truncated);
    assert.equal(parsed.complete, false);
    assert.ok(parsed.problems.some((problem) => problem.includes("section 3")));
    assert.throws(() => assertPackageComplete(parsed), (error: unknown) => error instanceof PackageCompletenessError);
  });

  it("writes package.md and package.json atomically with the full document", () => {
    seedRepairWindow();
    const doc = build();
    const paths = resolveHarness2Paths({ ...process.env, DSH_HARNESS2_ROOT: join(root, "packets") });
    const written = writeProposalPackage(paths, doc);
    assert.ok(existsSync(written.markdownPath));
    assert.ok(existsSync(written.jsonPath));
    assert.deepEqual(readdirSync(written.dir).sort(), ["package.json", "package.md"], "no temp file is left behind");
    assert.match(written.dir, /-wordpress$/);
    const json = JSON.parse(readFileSync(written.jsonPath, "utf8")) as { header: { packageId: string }; checklist: { complete: boolean } };
    assert.equal(json.header.packageId, doc.header.packageId);
    assert.equal(json.checklist.complete, true);
    assert.match(readFileSync(written.markdownPath, "utf8"), /@@SECTION 7 checklist BEGIN@@/);
  });

  it("builds honestly (incomplete checklist) for a dist-only payload with no sources", () => {
    seedRepairWindow();
    const doc = build({ repoRoot: join(root, "missing-payload") });
    assert.equal(doc.components.length, 0);
    assert.equal(doc.guardrails.length, 0);
    assert.equal(doc.checklist.complete, false, "an empty payload cannot claim a complete package");
    const markdown = renderPackageDocument(doc);
    assert.match(markdown, /Guardrails: PINNED/);
    assert.match(markdown, /delimiters_balanced: true/);
  });
});

describe("section 10 chunking, delimiters and relay", () => {
  it("serializes a package into delimited parts that reassemble byte-for-byte", () => {
    seedRepairWindow();
    const doc = build();
    const markdown = renderPackageDocument(doc);
    const parts = serializePackageParts(doc);
    assert.ok(parts.length >= 1);
    assert.equal(parts.map((part) => part.body).join(""), markdown);
    for (const part of parts) {
      assert.equal(part.packageId, doc.header.packageId);
      assert.ok(part.chars <= PACKAGE_PART_LIMIT);
      assert.equal(part.chars, part.body.length);
      assert.match(part.text, /^@@PKG \S+ PART \d+ OF \d+ CHARS \d+ BEGIN@@\n/);
      const parsedPart = parsePart(part.text);
      assert.equal(parsedPart.body, part.body);
      assert.equal(parsedPart.index, part.index);
    }
    const assembled = assemblePackage(parts.map((part) => part.text));
    assert.equal(assembled.text, markdown);
    assert.equal(assembled.packageId, doc.header.packageId);
    assert.equal(parsePackageDocument(assembled.text).complete, true);
  });

  it("splits a large document on line boundaries only and counts every body exactly", () => {
    const lines: string[] = [];
    for (let index = 0; index < 500; index++) lines.push(`line ${String(index).padStart(3, "0")}: ${"x".repeat(90)}`);
    const text = lines.join("\n");
    assert.ok(text.length > PACKAGE_PART_LIMIT);
    const parts = splitPackage(text, "pkg-large-test");
    assert.ok(parts.length >= 2);
    assert.equal(parts.map((part) => part.body).join(""), text, "no character is lost or duplicated");
    for (const part of parts) {
      assert.ok(part.body.length <= PACKAGE_PART_LIMIT);
      assert.equal(part.chars, part.body.length);
      assert.ok(part.text.includes(`CHARS ${part.body.length} BEGIN@@`), "the delimiter states the exact char count");
      assert.equal(parsePart(part.text).body, part.body);
    }
    for (const part of parts.slice(0, -1)) assert.ok(part.body.endsWith("\n"), "parts end on a whole line");
    assert.ok(!parts.some((part) => part.body.slice(0, -1).includes("\n") && part.body.endsWith("\r")));
    assert.equal(assemblePackage(parts).text, text);
  });

  it("refuses to split a single line longer than the part limit", () => {
    assert.throws(
      () => splitPackage("a".repeat(PACKAGE_PART_LIMIT + 1), "pkg-line"),
      (error: unknown) => error instanceof PackageChunkError && error.code === "oversized-line" && /never split/.test(error.message),
    );
  });

  it("rejects a partial package and any inconsistent char count", () => {
    const text = `${"y".repeat(400)}\n`;
    const parts = splitPackage(text.repeat(40), "pkg-partial");
    assert.ok(parts.length >= 2);
    const withoutSecond = [parts[0]!.text, ...parts.slice(2).map((part) => part.text)];
    assert.throws(
      () => assemblePackage(withoutSecond),
      (error: unknown) => {
        assert.ok(error instanceof PartialPackageError);
        assert.deepEqual(error.missing, [2]);
        assert.match(error.message, /incomplete/);
        return true;
      },
    );
    assert.throws(() => assemblePackage([parts[0]!.text, parts[0]!.text, ...parts.slice(2).map((part) => part.text)]), (error: unknown) => error instanceof PartialPackageError && error.duplicates.length > 0);
    const tampered = parts[0]!.text.replace(/CHARS (\d+)/g, (_match, count: string) => `CHARS ${Number(count) + 1}`);
    assert.throws(() => parsePart(tampered), (error: unknown) => error instanceof PackageChunkError && error.code === "bad-char-count");
    assert.throws(() => assemblePackage([]), (error: unknown) => error instanceof PartialPackageError);
  });

  it("relays parts in order and re-sends only the requested part", () => {
    const parts = splitPackage(`${"z".repeat(300)}\n`.repeat(60), "pkg-relay");
    assert.ok(parts.length >= 2);
    const relay = createPackageRelay(parts);
    assert.equal(relay.packageId, "pkg-relay");
    assert.deepEqual(relay.emitAll().map((part) => part.index), parts.map((part) => part.index));
    const resent = relay.handle("RESEND PKG pkg-relay PART 2");
    assert.equal(resent.kind, "resend");
    assert.equal(resent.parts.length, 1, "only the requested part is re-sent");
    assert.equal(resent.parts[0]!.index, 2);
    assert.equal(resent.parts[0]!.text, parts[1]!.text);
    assert.equal(relay.handle("RESEND PKG other-package PART 1").kind, "ignored");
    assert.match(relay.handle("RESEND PKG pkg-relay PART 99").reason, /outside 1\.\./);
    assert.equal(relay.handle("hello there").kind, "ignored");
    assert.equal(assemblePackage(relay.emitAll()).text.length, `${"z".repeat(300)}\n`.repeat(60).length);
  });
});

describe("section 10 editor reply parser", () => {
  it("parses a complete reply with full file contents", () => {
    const text = replyText({
      evidence: ["pair 1: run-pos-a vs run-neg-a", "pair 2: run-pos-b vs run-neg-b"],
      files: [
        ["apps/redteam-runner/src/tools.ts", "export const TOOLS = 'new';\n"],
        ["apps/redteam-runner/src/prompts.ts", "export const BASE_PROMPT = 'tuned';\n"],
      ],
    });
    const reply: EditorReply = parseEditorReply(text);
    assert.match(reply.proposal, /- insert:/);
    assert.equal(reply.component, "tool-guidance");
    assert.match(reply.rationale, /robots\.txt/);
    assert.match(reply.expectedEffect, /vulnsFound/);
    assert.equal(reply.evidence.length, 2);
    assert.equal(reply.files.length, 2);
    assert.equal(reply.files[0]!.path, "apps/redteam-runner/src/tools.ts");
    assert.equal(reply.files[0]!.content, "export const TOOLS = 'new';");
  });

  it("rejects a partial or malformed reply", () => {
    assert.throws(() => parseEditorReply("   "), (error: unknown) => error instanceof Error && /empty/.test(error.message));
    const missingEffect = replyText().split("\n").filter((line) => !line.startsWith("@@EXPECTED-EFFECT") && line !== "@@END-EXPECTED-EFFECT@@" && !line.startsWith("vulnsFound:")).join("\n");
    assert.throws(() => parseEditorReply(missingEffect), (error: unknown) => error instanceof Error && /partial reply: .*EXPECTED-EFFECT/.test(error.message));
    const unclosed = replyText().replace("@@END-RATIONALE@@\n", "");
    assert.throws(() => parseEditorReply(unclosed), (error: unknown) => error instanceof Error && /not closed before the next block|never closed/.test(error.message));
    const noFiles = replyText().split("\n").filter((line) => !line.startsWith("@@FILE") && line !== "@@END-FILE@@").join("\n");
    assert.throws(() => parseEditorReply(noFiles), (error: unknown) => error instanceof Error && /FILE/.test(error.message));
    const emptyFile = replyText({ files: [["apps/redteam-runner/src/tools.ts", ""]] });
    assert.throws(() => parseEditorReply(emptyFile), (error: unknown) => error instanceof Error && /empty/.test(error.message));
  });

  it("rejects diffs instead of full file contents", () => {
    const diff = ["diff --git a/x.ts b/x.ts", "--- a/apps/redteam-runner/src/tools.ts", "+++ b/apps/redteam-runner/src/tools.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    assert.equal(isDiffContent(diff), true);
    assert.equal(isDiffContent("export const TOOLS = 'ok';\n"), false);
    assert.throws(
      () => parseEditorReply(replyText({ files: [["apps/redteam-runner/src/tools.ts", diff]] })),
      (error: unknown) => error instanceof Error && /contains a diff/.test(error.message),
    );
  });

  it("auto-rejects and flags any reply touching a pinned guardrail", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["src/safety", replyText({ files: [["apps/redteam-runner/src/safety/kill.ts", "x"]] })],
      ["src/policy", replyText({ proposal: "# edit apps/redteam-runner/src/policy/scope.ts" })],
      ["auth-gate", replyText({ files: [["packages/redteam/auth-gate/src/index.ts", "x"]] })],
      ["src/safety", replyText({ files: [["APPS\\REDTEAM-RUNNER\\SRC\\SAFETY\\kill.ts", "x"]] })],
      ["guardrails", replyText({ proposal: "# component: guardrails\n- insert: []" })],
    ];
    for (const [label, text] of cases) {
      assert.throws(
        () => parseEditorReply(text),
        (error: unknown) => {
          assert.ok(error instanceof Error, `${label}: typed error`);
          const flagged = (error as Error & { flagged?: boolean }).flagged;
          const pinnedPaths = (error as Error & { pinnedPaths?: readonly string[] }).pinnedPaths ?? [];
          assert.equal(flagged, true, `${label}: flagged`);
          assert.ok(pinnedPaths.includes(label), `${label}: pinned paths ${pinnedPaths.join(",")}`);
          assert.match(error.message, /AUTO-REJECTED/);
          return true;
        },
      );
    }
  });

  it("reports the pinned component list and mode vocabulary used by section 6", () => {
    assert.ok((PACKAGE_MODES as readonly string[]).includes("REPAIR-FOUNDATION"));
    assert.equal(HARNESS_COMPONENTS.guardrails, "guardrails");
    assert.ok(!EDITABLE_COMPONENTS.includes("guardrails" as (typeof EDITABLE_COMPONENTS)[number]));
  });
});
