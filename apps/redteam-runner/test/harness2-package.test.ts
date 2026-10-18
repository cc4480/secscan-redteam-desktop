/**
 * Harness2 proposal package + response parser (H2-P2a).
 *
 * Pins the security-critical surface (pinned guardrails can never enter a
 * componentFiles list and a pasted-back YAML that touches them is rejected AND
 * flagged), the pair-selection rule, the paste-ready render, atomic writing, and
 * tolerance of missing EXPERIENCE.md / dist-only payloads.
 *
 * Every test uses a temp DSH_HARNESS2_ROOT and a temp fixture repo, so neither
 * E:\secscan-harness2 nor the real runner tree is touched.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EDITABLE_COMPONENTS, HARNESS_COMPONENTS, resolveHarness2Paths, type RunMetrics } from "../src/harness2/contract.js";
import { openHarness2Store, type Harness2Store } from "../src/harness2/store.js";
import {
  COMPONENT_FILE_MAP,
  buildProposalPackage,
  findPinnedTouch,
  parseExperience,
  parseProposalResponse,
  ProposalParseError,
  readComponentFiles,
  renderProposalPackage,
  sanitizeTargetClass,
  writeProposalPackage,
} from "../src/harness2/package.js";

let root: string;
let repo: string;
let previousRoot: string | undefined;
let store: Harness2Store;

const REPO_FILES: readonly (readonly [string, string])[] = [
  ["apps/redteam-runner/src/prompts.ts", "export const BASE_PROMPT = 'base';\n"],
  ["apps/redteam-runner/src/prompts/coordinator.ts", "export const COORDINATOR = 'coord';\n"],
  ["apps/redteam-runner/src/tools.ts", "export * from './tools/web.js';\n"],
  ["apps/redteam-runner/src/agents.ts", "export const AGENT_LOOP = 'loop';\n"],
  ["packages/redteam/harness-plugin/src/redteam-profile.ts", "export const PROFILE = 'profile';\n"],
  ["apps/redteam-runner/src/registry.ts", "export const REGISTRY = 'registry';\n"],
  ["apps/redteam-runner/src/targets/wordpress.ts", "export const WORDPRESS = 'wp';\n"],
  ["apps/redteam-runner/src/integrations/example.ts", "export const INTEGRATION = 'i';\n"],
  ["apps/redteam-runner/scripts/check.mjs", "export default 1;\n"],
  ["apps/redteam-runner/src/safety/kill.ts", "SECRET_GUARDRAIL\n"],
  ["apps/redteam-runner/src/policy/scope.ts", "SECRET_POLICY\n"],
  ["packages/redteam/harness-plugin/src/auth-gate.ts", "SECRET_AUTH_GATE\n"],
];

function writeAt(base: string, files: readonly (readonly [string, string])[]): void {
  for (const [path, body] of files) {
    const target = join(base, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
  }
}

function sampleMetrics(over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    runId: "run-pos-a",
    engagementId: "eng-pos-a",
    targetClass: "wordpress",
    outcome: "success",
    vulnsFound: 5,
    falsePositives: 0,
    exploitsSucceeded: 3,
    exploitsAttempted: 6,
    steps: 20,
    tokensIn: 1000,
    tokensOut: 500,
    durationMs: 60000,
    harness: { runnerVersion: "0.37.1", layerIds: ["base", "wp-a"], componentHashes: { memory: "aa" } },
    startedAt: "2026-10-18T10:00:00.000Z",
    finishedAt: "2026-10-18T10:05:00.000Z",
    ...over,
  };
}

/** Upsert a run with two tool-call events. */
function seed(over: Partial<RunMetrics> = {}): void {
  const metrics = sampleMetrics(over);
  store.upsertRun({
    metrics,
    events: [
      { ts: "2026-10-18T10:00:01.000Z", phase: "recon", actor: "recon", action: "http_probe", attackId: "T1046", result: "200 ok", isToolCall: true },
      { ts: "2026-10-18T10:00:02.000Z", phase: "exploit", actor: "exploiter", action: "record_finding", attackId: "T1190", result: "confirmed", isToolCall: false },
    ],
  });
}

function build(over: Partial<Parameters<typeof buildProposalPackage>[0]> = {}) {
  return buildProposalPackage({
    store,
    targetClass: "wordpress",
    environment: process.env,
    repoRoot: repo,
    experienceDir: join(root, "experience"),
    ...over,
  });
}

function guardrailYaml(line: string): string {
  return `Proposal\n\n\`\`\`yaml\n# component: tool-guidance\n${line}\n- insert:\n    - id: bad\n      name: '@secscan/example'\n\`\`\`\n\nRationale: pair 1 suggests a tightening of the tool list.\n`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "harness2-package-"));
  repo = join(root, "repo");
  writeAt(repo, REPO_FILES);
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

describe("harness2 proposal package", () => {
  it("selects contrasted pairs ranked by yield and notes layer drift", () => {
    seed();
    seed({ runId: "run-pos-b", engagementId: "eng-pos-b", vulnsFound: 3, exploitsSucceeded: 2, steps: 30, finishedAt: "2026-10-18T10:04:00.000Z", harness: { runnerVersion: "0.37.1", layerIds: ["base"], componentHashes: {} } });
    seed({ runId: "run-neg-a", engagementId: "eng-neg-a", outcome: "failure", vulnsFound: 0, exploitsSucceeded: 0, steps: 12, finishedAt: "2026-10-18T10:03:00.000Z", harness: { runnerVersion: "0.37.1", layerIds: ["base"], componentHashes: {} } });
    seed({ runId: "run-neg-b", engagementId: "eng-neg-b", outcome: "partial", vulnsFound: 1, finishedAt: "2026-10-18T10:02:00.000Z" });
    seed({ runId: "run-aborted", engagementId: "eng-aborted", outcome: "aborted", vulnsFound: 0, steps: 5, finishedAt: "2026-10-18T10:01:00.000Z" });
    seed({ runId: "run-blocked", engagementId: "eng-blocked", outcome: "failure", vulnsFound: 0, steps: 0, finishedAt: "2026-10-18T10:00:00.000Z" });
    const pkg = build();
    assert.equal(pkg.pairs.length, 2, "default is two pairs");
    assert.equal(pkg.pairs[0]?.positive.metrics.runId, "run-pos-a", "highest yield heads the positive pool");
    assert.equal(pkg.pairs[0]?.negative.metrics.runId, "run-neg-a", "lowest-yield failure is the first negative");
    assert.equal(pkg.pairs[1]?.positive.metrics.runId, "run-pos-b");
    assert.equal(pkg.pairs[1]?.negative.metrics.runId, "run-neg-b", "a run is not reused across pairs");
    assert.deepEqual([...pkg.baseLayerSet], ["base", "wp-a"], "newest run is the current base layer set");
    assert.match(pkg.instructions, /aborted run\(s\) ignored/);
    assert.match(pkg.instructions, /zero-step failure\(s\) ignored/);
    assert.match(pkg.instructions, /layer sets differ/);
    assert.match(pkg.instructions, /not layer-controlled/);
    assert.equal(pkg.metrics["runs"], 6);
    assert.equal(pkg.metrics["successRate"], 0.33);
    assert.equal(pkg.metrics["positiveVulnsMean"], 4);
    assert.equal(pkg.metrics["negativeVulnsMean"], 0.5);
  });

  it("returns no pair when the class has no comparable negative", () => {
    seed();
    const pkg = build();
    assert.equal(pkg.pairs.length, 0);
    assert.match(pkg.instructions, /no comparable negative run/);
  });

  it("excludes pinned guardrails from componentFiles and never reads them", () => {
    assert.equal(COMPONENT_FILE_MAP[HARNESS_COMPONENTS.guardrails], undefined, "guardrails are not in the map");
    const files = readComponentFiles(repo);
    assert.ok(files.length > 0, "fixture repo files were read");
    assert.ok(files.some((entry) => entry.path === "apps/redteam-runner/src/prompts.ts"));
    assert.ok(files.some((entry) => entry.path === "apps/redteam-runner/src/prompts/coordinator.ts"), "dir is expanded");
    const targetsIndex = files.find((entry) => entry.path === "apps/redteam-runner/src/targets");
    assert.ok(targetsIndex, "broad dir is an index entry");
    assert.match(targetsIndex.body, /^# Directory index:/);
    for (const entry of files) {
      assert.ok(EDITABLE_COMPONENTS.includes(entry.component), `component ${entry.component} is editable`);
      assert.equal(findPinnedTouch(entry.path).length, 0, `pinned path leaked: ${entry.path}`);
      assert.ok(!entry.body.includes("SECRET_GUARDRAIL") && !entry.body.includes("SECRET_POLICY") && !entry.body.includes("SECRET_AUTH_GATE"), "guardrail sources are never read");
    }
    assert.ok(findPinnedTouch("apps\\redteam-runner\\SRC\\SAFETY\\kill.ts").includes("src/safety"), "backslash/case bypass is caught");
  });

  it("renders instructions verbatim plus component fences, pair tables and metrics", () => {
    seed();
    seed({ runId: "run-neg", engagementId: "eng-neg", outcome: "failure", vulnsFound: 0, steps: 9, finishedAt: "2026-10-18T10:01:00.000Z" });
    const pkg = build();
    const markdown = renderProposalPackage(pkg);
    assert.ok(markdown.includes(pkg.instructions), "instructions appear verbatim");
    assert.match(markdown, /# Harness2 proposal package: wordpress/);
    for (const component of EDITABLE_COMPONENTS) assert.ok(markdown.includes(component), `instructions name ${component}`);
    assert.match(markdown, /PINNED/);
    assert.match(markdown, /AUTO-REJECTED and FLAGGED/);
    assert.match(markdown, /cordis patch-layer/);
    assert.match(markdown, /Token budget/);
    assert.match(markdown, /EXPERIENCE\.md format/);
    assert.match(markdown, /### Pair 1/);
    assert.match(markdown, /```ts/);
    assert.match(markdown, /\| metric \| value \|/);
    assert.match(markdown, /vulnsFoundMean/);
  });

  it("parses a valid pasted-back answer", () => {
    const text = "My proposal.\n\n```yaml\n# component: tool-guidance\n# target-class: wordpress\n- insert:\n    - id: wp-tools\n      name: '@secscan/example'\n      config: {}\n```\n\nRationale: pair 1 needs a tighter tool list.\n";
    const proposal = parseProposalResponse(text);
    assert.equal(proposal.component, "tool-guidance");
    assert.equal(proposal.targetClass, "wordpress", "target class comes from the YAML header");
    assert.match(proposal.yaml, /- insert:/);
    assert.match(proposal.rationale, /Rationale: pair 1/);
    assert.match(proposal.id, /^prop-[0-9a-f]{12}$/, "id is a content hash, so it is reproducible");
    assert.equal(parseProposalResponse(text, { targetClass: "nginx" }).targetClass, "nginx", "context wins over the header");
  });

  it("rejects a missing or empty YAML block", () => {
    assert.throws(
      () => parseProposalResponse("just prose, no fence"),
      (error: unknown) => error instanceof ProposalParseError && error.flagged === false && /yaml/i.test(error.message),
    );
    assert.throws(() => parseProposalResponse("```yaml\n\n```\nprose"), (error: unknown) => error instanceof ProposalParseError && /missing a fenced/i.test(error.message));
    assert.throws(() => parseProposalResponse("   "), (error: unknown) => error instanceof ProposalParseError && /empty/i.test(error.message));
  });

  it("auto-rejects and flags any proposal touching a pinned guardrail", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["src/safety", "# edit apps/redteam-runner/src/safety/kill.ts"],
      ["src/policy", "config: { path: 'apps/redteam-runner/src/policy/scope.ts' }"],
      ["auth-gate", "config: { path: 'packages/redteam/harness-plugin/src/auth-gate.ts' }"],
      ["src/safety", "config: { path: 'APPS\\REDTEAM-RUNNER\\SRC\\SAFETY\\kill.ts' }"],
    ];
    for (const [label, line] of cases) {
      assert.throws(
        () => parseProposalResponse(guardrailYaml(line)),
        (error: unknown) => {
          assert.ok(error instanceof ProposalParseError, `${label}: parse error class`);
          assert.equal(error.flagged, true, `${label}: flagged`);
          assert.ok(error.pinnedPaths.includes(label), `${label}: pinned paths ${error.pinnedPaths.join(",")}`);
          assert.match(error.message, /PINNED guardrail/);
          return true;
        },
      );
    }
    const header = "```yaml\n# component: guardrails\n- insert:\n    - id: x\n      name: '@secscan/example'\n```\nrationale: none\n";
    assert.throws(
      () => parseProposalResponse(header),
      (error: unknown) => error instanceof ProposalParseError && error.flagged && error.pinnedPaths.includes("guardrails"),
    );
  });

  it("parses EXPERIENCE.md entries and tolerates absence and malformed entries", () => {
    const text = [
      "# EXPERIENCE - wordpress",
      "",
      "## 2026-10-18 - general",
      "- change: added a recon checklist",
      "- reason: recon missed auth flows",
      "- measured effect: vulnsFound 1 -> 3 over 2 runs",
      "- tokens spent: 1200",
      "",
      "free prose is ignored",
      "## 2026-10-17 - wp-cache",
      "- change: cache-busting note",
      "- reason: cached pages hid the payload",
      "- measured effect: exploits 0 -> 2",
      "- tokens spent: 800",
      "",
      "## 2026-10-16 - broken",
      "- change: incomplete entry is dropped",
      "",
    ].join("\n");
    const entries = parseExperience(text, "wordpress");
    assert.equal(entries.length, 2, "incomplete entry is dropped, not guessed");
    assert.equal(entries[0]?.layerId, undefined, "general means no layer id");
    assert.equal(entries[0]?.tokensSpent, 1200);
    assert.equal(entries[1]?.layerId, "wp-cache");
    assert.equal(sanitizeTargetClass("Windows AD"), "windows-ad", "H2-P3 filename sanitizer is mirrored");
    mkdirSync(join(root, "experience"), { recursive: true });
    writeFileSync(join(root, "experience", "wordpress.md"), text);
    assert.equal(build().experience.length, 2, "flat <class>.md location is read");
    assert.equal(build({ experienceDir: join(root, "no-experience") }).experience.length, 0, "absence is tolerated");
  });

  it("writes package.md and package.json atomically", () => {
    seed();
    const pkg = build();
    const paths = resolveHarness2Paths({ ...process.env, DSH_HARNESS2_ROOT: join(root, "packets") });
    const written = writeProposalPackage(paths, pkg);
    assert.ok(existsSync(written.markdownPath));
    assert.ok(existsSync(written.jsonPath));
    assert.equal(JSON.parse(readFileSync(written.jsonPath, "utf8")).targetClass, "wordpress");
    assert.match(readFileSync(written.markdownPath, "utf8"), /# Harness2 proposal package: wordpress/);
    assert.deepEqual(readdirSync(written.dir).sort(), ["package.json", "package.md"], "no temp file is left behind");
    assert.match(written.dir, /-wordpress$/);
  });

  it("builds with a dist-only payload where no component sources exist", () => {
    seed();
    const pkg = build({ repoRoot: join(root, "missing-payload") });
    assert.equal(pkg.componentFiles.length, 0);
    assert.match(renderProposalPackage(pkg), /no component sources found/);
    assert.match(pkg.instructions, /one editable component id/);
  });
});
