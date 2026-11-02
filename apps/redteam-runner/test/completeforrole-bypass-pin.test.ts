/**
 * Fleet audit L3 — pin the latent charter bypass shut.
 *
 * RunnerDeps.completeForRole (context.ts) is a test seam: when a caller
 * injects it, every seat's completion uses the injected function and the
 * charter + fleet assembly are bypassed entirely (agents.ts and the other
 * `ctx.deps.completeForRole ?? createCharteredComplete(...)` read sites).
 * The audit verified no in-tree production caller injects it, but desktop /
 * vendored callers were unverified. Verified 2026-11-02 (this slice): grep
 * of apps/redteam-runner/src, apps/desktop/src, and the vendored runner
 * payload in apps/desktop/resources/redteam-runner/dist found ZERO
 * injections — every production occurrence is the type declaration, a
 * read-with-chartered-fallback, an import, a comment, or campaign/cli.ts's
 * direct router call (not a deps object). Desktop launches the runner as a
 * child process (apps/desktop/src/redteam-runner.ts spawns dist/cli.js),
 * so it cannot inject deps in-process at all.
 *
 * This test PINS that state, default-deny: it scans the same production
 * trees and fails on ANY occurrence of the identifier that is not one of
 * the classified-benign shapes below. A future production injection —
 * `deps: { completeForRole: … }`, `completeForRole: …` in any object
 * literal, `deps.completeForRole = …`, or a shorthand — matches no benign
 * shape and fails CI. Test files are deliberately NOT scanned: injecting
 * the seam is exactly what tests are for.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Compiled test location is apps/redteam-runner/dist-test/test/. */
const RUNNER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = join(RUNNER_ROOT, "..", "..");

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

/**
 * The benign shapes a production occurrence may take. Anything else is an
 * injection (or a new shape a human must classify before it lands).
 */
function benignShape(line: string): string | null {
  const t = line.trim();
  if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/**")) return "comment";
  if (/completeForRole\?\s*:/.test(line)) return "RunnerDeps type declaration";
  if (/deps\.completeForRole\s*\?\?/.test(line)) return "read with chartered fallback";
  if (/^\s*import\b.*\bcompleteForRole\b/.test(line)) return "router import";
  if (/\bawait completeForRole\(/.test(line)) return "campaign cli direct router call";
  return null;
}

function scan(files: string[]): { violations: string[]; benign: number } {
  const violations: string[] = [];
  let benign = 0;
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("completeForRole")) return;
      if (benignShape(line)) benign++;
      else violations.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  return { violations, benign };
}

describe("L3 pin: no production caller injects deps.completeForRole", () => {
  it("runner production src contains only benign completeForRole occurrences", () => {
    const files = walk(join(RUNNER_ROOT, "src"), [".ts"]).filter((f) => {
      const seg = f.split(/[\\/]/);
      return !seg.includes("secscan") && !seg.includes("seclayer");
    });
    assert.ok(files.length > 100, `expected the full runner source tree, found ${files.length} files`);
    const { violations, benign } = scan(files);
    assert.ok(benign >= 10, `expected the known benign occurrences to be found, found ${benign} — scan is not vacuous`);
    assert.deepEqual(violations, [], `unclassified completeForRole occurrences (injection shapes fail the pin):\n${violations.join("\n")}`);
  });

  it("desktop production src never mentions completeForRole at all", () => {
    const dir = join(REPO_ROOT, "apps", "desktop", "src");
    assert.ok(existsSync(dir), "apps/desktop/src must exist for this pin to mean anything");
    const files = walk(dir, [".ts", ".mts", ".js", ".mjs"]);
    assert.ok(files.length > 0, "expected desktop source files to scan");
    const { violations, benign } = scan(files);
    assert.equal(benign, 0, "desktop src baseline is zero occurrences — any occurrence needs audit review");
    assert.deepEqual(violations, [], `completeForRole appeared in desktop src:\n${violations.join("\n")}`);
  });

  it("the vendored runner payload in desktop resources contains only benign occurrences", () => {
    const dir = join(REPO_ROOT, "apps", "desktop", "resources", "redteam-runner", "dist");
    assert.ok(existsSync(dir), "the vendored runner payload must exist for this pin to mean anything");
    const files = walk(dir, [".js", ".d.ts"]);
    assert.ok(files.length > 50, `expected the vendored payload tree, found ${files.length} files`);
    const { violations, benign } = scan(files);
    assert.ok(benign >= 5, `expected the vendored benign occurrences to be found, found ${benign} — scan is not vacuous`);
    assert.deepEqual(violations, [], `unclassified completeForRole occurrences in the vendored payload:\n${violations.join("\n")}`);
  });
});
