/**
 * File budget enforcement (v0.20.0) — the v0.19.0 hard rule, mechanical.
 *
 * No file under runner/src may exceed 300 lines. This test walks the
 * compiled tree's source directory and fails the suite on any violation,
 * so the rule can't silently rot.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** runner/src — resolved from the compiled test location (dist-test/test). */
function srcDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("file budget", () => {
  it("no runner-owned src file exceeds 300 lines (wc -l semantics)", () => {
    // Vendored exemption: src/secscan/ is a byte-frozen copy of the SecScan
    // scan engine — AS-IS-MANIFEST.json pins every file's sha256, and
    // splitting those files to fit this budget would void the as-is
    // guarantee the copy exists to provide. The budget governs the code
    // this repo owns and edits, so the vendored tree is walked past.
    const files = walkTs(srcDir()).filter((f) => !f.split("/").includes("secscan") && !f.split("\\").includes("secscan"));
    assert.ok(files.length > 100, `expected the full source tree, found ${files.length} files`);
    const over = files
      .map((f) => ({ file: f, lines: (readFileSync(f, "utf8").match(/\n/g) || []).length }))
      .filter(({ lines }) => lines > 300);
    assert.deepEqual(
      over.map(({ file }) => file),
      [],
      `files over the 300-line budget:\n${over.map(({ file, lines }) => `  ${lines}  ${file}`).join("\n")}`,
    );
  });
});
