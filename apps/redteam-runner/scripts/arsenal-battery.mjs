#!/usr/bin/env node
/**
 * ARS-9 acceptance battery — scripted checks for brief §6.1 items 1, 2, 8
 * plus the spec T12 import-surface scan (supports §6.1.4 / §6.1.6).
 *
 * Usage: node scripts/arsenal-battery.mjs [--base <git-ref>] [--log <crew-log-path>]
 * Defaults: base 9359b8de (the brief's build base); log = the crew build log
 * in the goal hidden_files (override with ARSENAL_BUILD_LOG or --log).
 *
 * Prints one line per §6.1 item with PASS / FAIL / PENDING and exits 1
 * unless every item is PASS. PENDING means the receipt is not yet
 * satisfiable on the current tree (owning slice not landed) — it is a
 * failing grade for acceptance, reported distinctly so the owner is named.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const runnerRoot = resolve(scriptDir, "..");
const repoRoot = resolve(runnerRoot, "..", "..");

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const BASE = argValue("--base") ?? process.env.ARSENAL_DIFF_BASE ?? "9359b8de";
const LOG_PATH =
  argValue("--log") ??
  process.env.ARSENAL_BUILD_LOG ??
  join(homedir(), "workspace/goals/secscan-redteam-pentest-agents/hidden_files/arsenal-build-log-2026-10-31.md");

const results = [];
function report(item, status, detail) {
  results.push({ item, status, detail });
  console.log(`§6.1.${item}  ${status.padEnd(7)}  ${detail}`);
}
function git(gitArgs) {
  return execFileSync("git", ["-C", repoRoot, ...gitArgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/* ------------------------------------------------------------------ *
 * §6.1.1 — Absence citations inverted: git grep -i arsenal resolves  *
 * only to the arsenal surface, and nowhere forbidden.                *
 * ------------------------------------------------------------------ */
const ALLOWED = [
  /^apps\/redteam-runner\/src\/arsenal\//,
  /^apps\/redteam-runner\/src\/ui\/mcp-endpoint\.ts$/,
  /^apps\/redteam-runner\/src\/cli\//,
  /^apps\/redteam-runner\/src\/tools\/readiness\.ts$/,
  /^apps\/redteam-runner\/test\/arsenal-/,
  /^apps\/redteam-runner\/test\/fixtures\/arsenal\//,
  /^apps\/redteam-runner\/scripts\/arsenal-battery\.mjs$/,
  /^apps\/redteam-runner\/test\/readiness\.test\.ts$/,
];
const FORBIDDEN = [
  /^packages\/redteam\/.*\/cordis\.patch\.yml$/,
  /^apps\/desktop\//,
  /^apps\/redteam-runner\/src\/report\//,
  /^apps\/redteam-runner\/src\/phases\//,
  /^apps\/redteam-runner\/src\/dispatch\//,
  /^apps\/redteam-runner\/src\/workgraph\//,
  /^apps\/redteam-runner\/src\/continuous\//,
];

function checkSurface() {
  let grepOut = "";
  try {
    grepOut = git(["grep", "-i", "-l", "arsenal", "--", "."]);
  } catch {
    grepOut = ""; // git grep exits 1 on zero matches
  }
  const paths = grepOut.split("\n").map((s) => s.trim()).filter(Boolean);
  const forbiddenHits = paths.filter((p) => FORBIDDEN.some((re) => re.test(p)));
  const unexpectedHits = paths.filter(
    (p) => !FORBIDDEN.some((re) => re.test(p)) && !ALLOWED.some((re) => re.test(p)),
  );
  // Untracked files in forbidden places count too (parallel slices pre-commit).
  let untracked = "";
  try {
    untracked = git(["ls-files", "--others", "--exclude-standard"]);
  } catch {
    untracked = "";
  }
  const untrackedForbidden = untracked
    .split("\n")
    .map((s) => s.trim())
    .filter((p) => p && /arsenal/i.test(p) && FORBIDDEN.some((re) => re.test(p)));

  const presence = {
    "src/arsenal/": paths.some((p) => p.startsWith("apps/redteam-runner/src/arsenal/")),
    "mcp-endpoint registration": paths.includes("apps/redteam-runner/src/ui/mcp-endpoint.ts"),
    "test/arsenal-*": paths.some((p) => /^apps\/redteam-runner\/test\/arsenal-/.test(p)),
    "cli branch (ARS-8)": paths.some((p) => p.startsWith("apps/redteam-runner/src/cli/")),
    "readiness item (ARS-8)": paths.includes("apps/redteam-runner/src/tools/readiness.ts"),
  };
  const missingCore = Object.entries(presence)
    .filter(([k, v]) => !v && !k.includes("ARS-8"))
    .map(([k]) => k);
  const missingStep7 = Object.entries(presence)
    .filter(([k, v]) => !v && k.includes("ARS-8"))
    .map(([k]) => k);

  if (forbiddenHits.length || untrackedForbidden.length) {
    report(1, "FAIL", `arsenal leaked into forbidden paths: ${[...forbiddenHits, ...untrackedForbidden].join(", ")}`);
  } else if (unexpectedHits.length) {
    report(1, "FAIL", `arsenal mentions outside the allowed surface: ${unexpectedHits.join(", ")}`);
  } else if (missingCore.length) {
    report(1, "FAIL", `expected arsenal surface missing: ${missingCore.join(", ")}`);
  } else if (missingStep7.length) {
    report(1, "PENDING", `core surface clean; Step 7 surface not yet landed: ${missingStep7.join(", ")} (owner ARS-8)`);
  } else {
    report(1, "PASS", `git grep -i arsenal resolves only to the allowed surface (${paths.length} files)`);
  }
}

/* ------------------------------------------------------------------ *
 * §6.1.2 — Baseline discipline: the Step 0 record exists in the      *
 * crew log (ARS-1's section) with all four elements on record.       *
 * ------------------------------------------------------------------ */
function checkBaselineRecord() {
  if (!existsSync(LOG_PATH)) {
    report(2, "FAIL", `crew log not found at ${LOG_PATH}`);
    return;
  }
  const log = readFileSync(LOG_PATH, "utf8");
  // Heading-anchored: a bare indexOf("## ARS-1") matches the pair-partner
  // mention inside ARS-10's section heading and slices the wrong section.
  const heading = /^## ARS-1 /m.exec(log);
  const ars1Start = heading ? heading.index : -1;
  const ars1End = ars1Start >= 0 ? log.indexOf("\n## ", ars1Start + 1) : -1;
  const section = ars1Start >= 0 ? log.slice(ars1Start, ars1End > ars1Start ? ars1End : undefined) : "";
  if (!section) {
    report(2, "FAIL", "no ARS-1 section in the crew log — the Step 0 record has no home yet");
    return;
  }
  const checks = {
    "node >= 22.13": /v(22\.(1[3-9]|[2-9]\d)|2[4-9]\.\d+|[3-9]\d\.\d+)/.test(section),
    "sqlite spike PASS": /spike/i.test(section) && /pass/i.test(section),
    "typecheck verdict": /typecheck/i.test(section) && /(green|pass|ok|exit 0|0 errors)/i.test(section),
    // ARS-1's record carries the suite as "attempted, NOT certified" with a
    // clean rerun still owed — a tally quoted inside that limitation is not
    // a green verdict, so the element stays missing until the record is
    // superseded by a certified one.
    "full-suite verdict":
      /(full (runner )?suite|suite result)/i.test(section) &&
      /(green|pass|\d+\/\d+|fail.*0|0 fail)/i.test(section) &&
      !/not certified/i.test(section),
  };
  const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    report(2, "PENDING", `Step 0 record incomplete in ARS-1's section — missing: ${missing.join(", ")} (owner ARS-1)`);
  } else {
    report(2, "PASS", "Step 0 record complete in ARS-1's crew-log section (node, typecheck, suite, spike)");
  }
}

/* ------------------------------------------------------------------ *
 * §6.1.8 — No-new-plumbing diff check (arsenal-scoped, vs base).     *
 * ------------------------------------------------------------------ */
function addedLinesMentioningArsenal(diffArgs) {
  let diff = "";
  try {
    diff = git(["diff", `${BASE}..HEAD`, ...diffArgs]);
  } catch {
    return null; // base ref missing etc. — caller reports
  }
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++") && /arsenal/i.test(l));
}

function checkDiff() {
  const problems = [];
  const scopes = [
    ["packages/redteam/desktop-bundle/cordis.patch.yml", "desktop-bundle cordis row"],
    ["packages/redteam/harness-plugin/cordis.patch.yml", "harness-plugin cordis row"],
    ["apps/desktop", "apps/desktop"],
    ["apps/redteam-runner/src/report", "src/report (proven-tier stream)"],
    ["apps/redteam-runner/src/phases", "src/phases (runner-corrections stream)"],
    ["apps/redteam-runner/src/dispatch", "src/dispatch (runner-corrections stream)"],
    ["apps/redteam-runner/src/workgraph", "src/workgraph (runner-corrections stream)"],
    ["apps/redteam-runner/src/continuous", "src/continuous (monitoring stream)"],
  ];
  for (const [path, label] of scopes) {
    const hits = addedLinesMentioningArsenal(["--", path]);
    if (hits === null) {
      report(8, "FAIL", `cannot diff against base ${BASE} — is the ref present?`);
      return;
    }
    if (hits.length) problems.push(`${label}: ${hits.length} added arsenal line(s)`);
  }
  // Readiness: arsenal_index must be the ONLY arsenal-related readiness id.
  const readinessHits = addedLinesMentioningArsenal(["--", "apps/redteam-runner/src/tools/readiness.ts"]) ?? [];
  const badIds = readinessHits.filter((l) => /arsenal/i.test(l) && !/arsenal_index/.test(l) && /id\s*:/.test(l));
  if (badIds.length) problems.push(`readiness carries an arsenal id other than arsenal_index: ${badIds[0].trim()}`);
  if (problems.length) {
    report(8, "FAIL", problems.join("; "));
  } else if (readinessHits.length === 0) {
    report(8, "PENDING", "diff is clean of new plumbing, but the arsenal_index readiness item has not landed (owner ARS-8)");
  } else {
    report(8, "PASS", "no cordis row, no apps/desktop change, no sibling-stream contamination; arsenal_index is the only arsenal readiness id");
  }
}

/* ------------------------------------------------------------------ *
 * T12 import surface — supports §6.1.4 (zero network on read path)   *
 * and §6.1.6 (fetch-guard is the only network code).                 *
 * ------------------------------------------------------------------ */
function checkImportSurface() {
  const dir = join(runnerRoot, "src", "arsenal");
  if (!existsSync(dir)) {
    console.log(`T12      PENDING  src/arsenal/ not landed yet — import-surface scan has nothing to scan`);
    return "PENDING";
  }
  const problems = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    if (file !== "fetch-guard.ts") {
      if (/from\s+["']node:(http|https|net|dns)["']/.test(text) || /require\(["']node:/.test(text)) {
        problems.push(`${file}: network module import outside fetch-guard.ts`);
      }
      if (/\bfetch\s*\(/.test(text)) problems.push(`${file}: bare fetch() outside fetch-guard.ts`);
    }
    if (file === "tools.ts") {
      if (/child_process/.test(text)) problems.push("tools.ts references child_process");
      if (/from\s+["']\.\/ingest/.test(text)) problems.push("tools.ts imports the ingest module");
      if (/writeFile|createWriteStream|renameSync|rmSync|mkdirSync/.test(text)) {
        problems.push("tools.ts references fs write APIs");
      }
    }
  }
  if (problems.length) {
    console.log(`T12      FAIL     ${problems.join("; ")}`);
    return "FAIL";
  }
  console.log(`T12      PASS     no network imports outside fetch-guard.ts; tools.ts free of child_process / fs-write / ingest`);
  return "PASS";
}

checkSurface();
checkBaselineRecord();
checkDiff();
const t12 = checkImportSurface();

console.log("");
const failing = results.filter((r) => r.status !== "PASS");
if (failing.length || t12 !== "PASS") {
  console.log(
    `ARSENAL BATTERY (scripted): NOT GREEN — ${results.map((r) => `§6.1.${r.item}=${r.status}`).join(" · ")} · T12=${t12}`,
  );
  process.exit(1);
}
console.log("ARSENAL BATTERY (scripted): ALL SCRIPTED ITEMS PASS");
