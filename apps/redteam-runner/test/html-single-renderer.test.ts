/**
 * ONE HTML template renderer.
 *
 * There used to be two: the design-system renderer emitted its own document
 * head with its own stylesheet, and report/html.ts (the compliance pack, the
 * attestation letter, the safety manifest) emitted a second one with a second
 * design. Two designs shipped from one deliverable folder.
 *
 * report/html/shell.ts is now the only place a report document is wrapped.
 * This test fails the build if a second one appears.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** The one module allowed to wrap a report document. */
const SHELL = "report\\html\\shell.ts";

test("only the shell wraps a report HTML document", () => {
  const emitters = walk(SRC)
    .filter((f) => readFileSync(f, "utf8").includes("<!doctype html>"))
    // The console UI (login page, static shell) is chrome, not a deliverable
    // document — none of ui/ is a report artifact.
    .map((f) => relative(SRC, f))
    .filter((f) => !f.startsWith("ui\\"));

  assert.deepEqual(
    emitters,
    [SHELL],
    `a second HTML document renderer appeared: ${emitters.join(", ")} — route it through ${SHELL}`,
  );
});

test("the legacy second stylesheet is gone", () => {
  const html = readFileSync(join(SRC, "report\\html.ts"), "utf8");
  assert.ok(
    !/const STYLE = `/.test(html),
    "report/html.ts still defines its own stylesheet; it must use the design system's REPORT_CSS via the shell",
  );
});

test("every report artifact goes through the shell", () => {
  for (const rel of ["report\\html.ts", "report\\html\\render.ts"]) {
    const body = readFileSync(join(SRC, rel), "utf8");
    assert.match(body, /renderHtmlDocument/, `${rel} does not use the single document shell`);
  }
});

test("companion documents keep the design system's stylesheet", () => {
  const style = readFileSync(join(SRC, "report\\html\\style.ts"), "utf8");
  assert.match(
    style,
    /\$\{AUX_CSS\}/,
    "the companion document classes must be part of the one REPORT_CSS, not a separate stylesheet",
  );
});
